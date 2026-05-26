import { afterEach, describe, expect, it } from 'bun:test'
import { getSessionDebugId } from '@hopi/protocol'
import type { Session, SyncEvent } from '@hopi/protocol/types'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { TaskAutomation } from './taskAutomation'
import type { SyncEngine } from './syncEngine'
import { autoMergeAcceptedTask } from './taskAutoMerge'

const createdPaths: string[] = []
const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'
const VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (path) {
            rmSync(path, { recursive: true, force: true })
        }
    }
})

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-task-automation-'))
    createdPaths.push(path)
    return path
}

function createLinkedSession(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    thinking: boolean
    worktree?: boolean
}): { sessionId: string; session: Session } {
    const metadata = {
        path: options.worktree ? '/tmp/worktree' : '/tmp',
        host: 'test',
        projectId: options.projectId,
        taskId: options.taskId,
        ...(options.worktree
            ? {
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch',
                    worktreePath: '/tmp/worktree',
                    baseCommit: MERGE_BASE
                }
            }
            : {})
    }
    const stored = store.sessions.getOrCreateSession(
        'test-session',
        metadata,
        null,
        options.namespace
    )

    const now = Date.now()
    const session: Session = {
        id: stored.id,
        debugId: getSessionDebugId(stored.id),
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: options.thinking,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

function markSessionAsEvaluator(session: Session): void {
    session.metadata = {
        ...(session.metadata ?? { path: '/tmp', host: 'test' }),
        hopiTaskRole: 'evaluator'
    }
}

function createUnlinkedSession(store: Store, options: {
    namespace: string
    thinking: boolean
}): { sessionId: string; session: Session } {
    const stored = store.sessions.getOrCreateSession(
        'test-session',
        { path: '/tmp', host: 'test' },
        null,
        options.namespace
    )

    const now = Date.now()
    const session: Session = {
        id: stored.id,
        debugId: getSessionDebugId(stored.id),
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: '/tmp',
            host: 'test'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: options.thinking,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

function toMessageReceivedEvent(sessionId: string, msg: {
    id: string
    seq: number
    localId: string | null
    content: unknown
    createdAt: number
}): SyncEvent {
    return {
        type: 'message-received',
        sessionId,
        message: {
            id: msg.id,
            seq: msg.seq,
            localId: msg.localId,
            content: msg.content,
            createdAt: msg.createdAt
        }
    }
}

async function waitForTask(options: {
    store: Store
    namespace: string
    taskId: string
    predicate: (task: ReturnType<Store['tasks']['getTaskByNamespace']>) => boolean
    timeoutMs?: number
}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 2_000
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
        if (options.predicate(task)) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Timed out waiting for task update')
}

describe('TaskAutomation', () => {
    it('applies goal action packets from assistant output on ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions'
        const goalId = 'goal-1'
        const taskId = 'planner-task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'planning'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal and plan first iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Planning complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_goal_task',
                                title: 'Implement JSON action packet parser',
                                description: 'Replace goal MCP task creation with a structured packet.',
                                priority: 'high',
                                contract: '## Objective\nCreate and apply action packets.'
                            },
                            {
                                type: 'update_goal',
                                status: 'active',
                                currentFocus: 'Action packet migration'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Created first executable task.',
                                evidence: 'Goal docs and todo were reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const tasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
        const created = tasks.find((task) => task.id !== taskId)
        expect(created?.title).toBe('Implement JSON action packet parser')
        expect(created?.status).toBe('planning')
        expect(created?.goalId).toBe(goalId)
        expect(created?.source).toBe('manual')
        expect(created?.agentFlavor).toBeNull()
        expect(created?.model).toBeNull()
        expect(created?.permissionMode).toBe('safe-yolo')

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('Created first executable task.')
        expect(planner?.evidence).toBe('Goal docs and todo were reviewed.')

        const goal = store.goals.getGoalByNamespace(goalId, namespace)
        expect(goal?.status).toBe('active')
        expect(goal?.currentFocus).toBe('Action packet migration')
        expect(realtimeEvents.some((event) => event.type === 'task-added')).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('applies radar goal action packets when the session becomes inactive before ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar-actions'
        const goalId = 'goal-radar-actions'
        const taskId = 'radar-task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal radar project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep docs in sync',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Run radar scan',
            status: 'running',
            activeSessionId: sessionId,
            source: 'radar'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Radar scan complete.',
                    '',
                    '## HOPI_ACTIONS',
                    '',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Radar scan complete. No follow-up tasks required.',
                                evidence: 'Docs coherent; todo status accurate; no new tech debt.'
                            }
                        ]
                    }, null, 2),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const radarTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(radarTask?.status).toBe('done')
        expect(radarTask?.handoff).toBe('Radar scan complete. No follow-up tasks required.')
        expect(radarTask?.evidence).toBe('Docs coherent; todo status accurate; no new tech debt.')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })).toHaveLength(1)
        expect(realtimeEvents.filter((event) => event.type === 'task-updated')).toHaveLength(1)
    })

    it('blocks radar tasks when the session becomes inactive without a final status update', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar-inactive'
        const goalId = 'goal-radar-inactive'
        const taskId = 'radar-task-inactive'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Inactive radar project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Watch for drift',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Run periodic radar',
            status: 'running',
            activeSessionId: sessionId,
            source: 'radar'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: 'Radar notes captured, but the final action packet was never emitted.'
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const radarTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(radarTask?.status).toBe('blocked')
        expect(radarTask?.blockedReason).toBe('Agent session became inactive before applying its final HOPI_ACTIONS packet.')
        expect(radarTask?.blockedSource).toBe('agent')
        expect(radarTask?.blockedSessionId).toBe(sessionId)
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)

        const messages = store.messages.getMessages(sessionId)
        expect(messages.some((message) => {
            const content = message.content as { content?: { text?: unknown } }
            return content.content?.text === 'Task blocked: Agent session became inactive before applying its final HOPI_ACTIONS packet.'
        })).toBe(true)
    })

    it('applies radar goal action packets embedded in an ExitPlanMode tool input when the session becomes inactive', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar-tool-plan'
        const goalId = 'goal-radar-tool-plan'
        const taskId = 'radar-task-tool-plan'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Radar tool plan project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Watch for drift',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Run periodic radar',
            status: 'running',
            activeSessionId: sessionId,
            source: 'radar'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'call_exit_plan_mode',
                                name: 'ExitPlanMode',
                                input: {
                                    plan: [
                                        '# Radar Scan Plan',
                                        '',
                                        '## HOPI_ACTIONS',
                                        '',
                                        '```json',
                                        JSON.stringify({
                                            actions: [
                                                {
                                                    type: 'update_current_task',
                                                    status: 'done',
                                                    handoff: 'Radar scan complete. No follow-up tasks required.',
                                                    evidence: 'Docs coherent; no new tech debt.'
                                                }
                                            ]
                                        }, null, 2),
                                        '```'
                                    ].join('\n')
                                }
                            }
                        ]
                    }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const radarTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(radarTask?.status).toBe('done')
        expect(radarTask?.handoff).toBe('Radar scan complete. No follow-up tasks required.')
        expect(radarTask?.evidence).toBe('Docs coherent; no new tech debt.')
    })

    it('reconciles inactive goal sessions on session-added after a restart', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-session-added-reconcile'
        const goalId = 'goal-session-added-reconcile'
        const taskId = 'planner-task-session-added-reconcile'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Restart reconcile project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Recover stale planner sessions',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Recovered on startup.',
                                evidence: 'Packet replayed from stored messages.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        session.active = false
        session.thinking = false

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const plannerTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(plannerTask?.status).toBe('done')
        expect(plannerTask?.handoff).toBe('Recovered on startup.')
        expect(plannerTask?.evidence).toBe('Packet replayed from stored messages.')
    })

    it('blocks a goal when a packet creates a goal-level blocking decision topic', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-checkpoint-actions'
        const goalId = 'goal-checkpoint-actions'
        const taskId = 'planner-task-checkpoint-actions'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal checkpoint project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build architecture spine',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: [
                        'HOPI_ACTIONS:',
                        '```json',
                        JSON.stringify({
                            actions: [
                                {
                                    type: 'create_decision_topic',
                                    taskId: null,
                                    title: 'Milestone review',
                                    body: 'Is this architecture stage sufficient before adding real content?',
                                    blocking: true
                                },
                                {
                                    type: 'update_current_task',
                                    status: 'done',
                                    handoff: 'Stopped for milestone review.',
                                    evidence: 'Remaining work needs human priority review.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const topics = store.goalDecisionTopics.listByGoalAndNamespace(goalId, namespace)
        expect(topics).toHaveLength(1)
        expect(topics[0]?.taskId).toBeNull()
        expect(topics[0]?.blocking).toBe(true)
        expect(store.goals.getGoalByNamespace(goalId, namespace)?.status).toBe('blocked')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('done')
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('accepts planner decision topics that use description instead of body', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-checkpoint-description'
        const goalId = 'goal-checkpoint-description'
        const taskId = 'planner-task-checkpoint-description'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal checkpoint project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build architecture spine',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_decision_topic',
                                taskId: null,
                                title: 'Milestone review',
                                description: 'Should we stop after the architecture pass or continue directly into the content spike?',
                                blocking: true
                            },
                            {
                                type: 'update_goal',
                                status: 'blocked',
                                currentFocus: 'Awaiting milestone review.'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Stopped for milestone review.',
                                evidence: 'Architecture pass is complete.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const topics = store.goalDecisionTopics.listByGoalAndNamespace(goalId, namespace)
        expect(topics).toHaveLength(1)
        expect(topics[0]?.body).toBe('Should we stop after the architecture pass or continue directly into the content spike?')
        expect(store.goals.getGoalByNamespace(goalId, namespace)?.status).toBe('blocked')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('done')
    })

    it('skips duplicate goal task creation when a non-archived task with the same title already exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-duplicate-actions'
        const goalId = 'goal-duplicate-actions'
        const taskId = 'planner-task-duplicate-actions'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal duplicate action project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep board unique',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })
        store.tasks.createTask({
            id: 'existing-finished-task',
            projectId,
            goalId,
            title: 'Restore archive docs through storage adapter',
            status: 'done',
            source: 'manual'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Planning complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_goal_task',
                                title: 'Restore archive docs through storage adapter',
                                description: 'This task already finished and should not be recreated.'
                            },
                            {
                                type: 'create_goal_task',
                                title: 'Create a genuinely new task',
                                description: 'This task is new.'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Promoted only new work.',
                                evidence: 'Skipped already completed work.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const tasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
        expect(tasks.filter((task) => task.title === 'Restore archive docs through storage adapter')).toHaveLength(1)
        expect(tasks.some((task) => task.title === 'Create a genuinely new task')).toBe(true)
        expect(realtimeEvents.filter((event) => event.type === 'task-added')).toHaveLength(1)
    })

    it('links planner-created goal tasks to todo refs and closes them when evaluator accepts', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-todo-ref-actions'
        const goalId = 'goal-todo-ref-actions'
        const plannerTaskId = 'planner-task-todo-ref-actions'
        const workspacePath = createTempWorkspace()
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: todo-ref-goal',
            `    goalId: ${goalId}`,
            '    title: Todo ref goal',
            '    items:',
            '      - ref: Restore archive docs through storage adapter',
            '        status: ready',
            '        title: Restore archive docs through storage adapter',
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal todo ref action project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Todo ref goal',
            goalKey: 'todo-ref-goal',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: plannerTaskId,
            thinking: false
        })

        store.tasks.createTask({
            id: plannerTaskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId: 'workspace-1',
            source: 'planner'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Planning complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_goal_task',
                                title: 'ref: Restore archive docs through storage adapter - Wrong generated title',
                                todoRef: 'Restore archive docs through storage adapter'
                            },
                            {
                                type: 'create_goal_task',
                                title: 'Restore archive docs through adapter layer',
                                todoRef: 'Restore archive docs through storage adapter'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Promoted linked work.',
                                evidence: 'Todo entry was promoted.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))
        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const created = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.title === 'Restore archive docs through storage adapter')
        expect(created?.goalTodoRef).toBe('Restore archive docs through storage adapter')
        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .filter((task) => task.goalTodoRef === 'Restore archive docs through storage adapter')).toHaveLength(1)
        const promotedTodo = readFileSync(join(docsRoot, 'goals', 'todo-ref-goal', 'todo.yml'), 'utf8')
        expect(promotedTodo).toContain('status: planning')
        expect(promotedTodo).toContain('tag: ready')
        expect(promotedTodo).not.toContain('taskId:')

        const evaluatorSession = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: created?.id ?? 'missing-created-task',
            thinking: false
        })
        const evaluator = {
            getSession(id: string) {
                return id === evaluatorSession.sessionId ? evaluatorSession.session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine
        const evaluatorAutomation = new TaskAutomation(store, evaluator)
        store.tasks.updateTaskByNamespace(created?.id ?? 'missing-created-task', namespace, {
            status: 'review',
            activeSessionId: evaluatorSession.sessionId
        })
        evaluatorAutomation.handleEvent({ type: 'session-added', sessionId: evaluatorSession.sessionId })
        const evaluatorMsg = store.messages.addMessage(evaluatorSession.sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted linked task.',
                                evidence: 'Validated implementation.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        evaluatorAutomation.handleEvent(toMessageReceivedEvent(evaluatorSession.sessionId, evaluatorMsg))
        const evaluatorReady = store.messages.addMessage(evaluatorSession.sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        evaluatorAutomation.handleEvent(toMessageReceivedEvent(evaluatorSession.sessionId, evaluatorReady))

        const doneTodo = readFileSync(join(docsRoot, 'goals', 'todo-ref-goal', 'todo.yml'), 'utf8')
        expect(doneTodo).toContain('status: done')
        expect(doneTodo).not.toContain('taskId:')
    })

    it('moves generator finished action packets to review instead of finished', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-finished'
        const goalId = 'goal-generator-finished'
        const taskId = 'generator-task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal generator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Implementation complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Implemented map traversal.',
                                evidence: 'bun test passed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const generator = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(generator?.status).toBe('review')
        expect(generator?.finishedAt).toBeNull()
        expect(generator?.handoff).toBe('Implemented map traversal.')
        expect(generator?.evidence).toBe('bun test passed.')
    })

    it('syncs linked goal todo status when generator work enters review', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-todo-runtime-status'
        const goalId = 'goal-todo-runtime-status'
        const reviewTaskId = 'generator-task-review-sync'
        const workspacePath = createTempWorkspace()
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: runtime-status-goal',
            `    goalId: ${goalId}`,
            '    title: Runtime status goal',
            '    items:',
            '      - ref: review-ref',
            '        status: promoted',
            '        title: Review sync task',
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal todo runtime status project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Runtime status goal',
            goalKey: 'runtime-status-goal',
            status: 'active'
        })

        const reviewSession = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: reviewTaskId,
            thinking: false
        })
        store.tasks.createTask({
            id: reviewTaskId,
            projectId,
            goalId,
            title: 'Review sync task',
            status: 'running',
            activeSessionId: reviewSession.sessionId,
            workspaceId: 'workspace-1',
            source: 'manual',
            goalTodoRef: 'review-ref'
        })

        const engine = {
            getSession(id: string) {
                if (id === reviewSession.sessionId) return reviewSession.session
                return undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId: reviewSession.sessionId })

        const reviewMsg = store.messages.addMessage(reviewSession.sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Ready for review.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Review me.',
                                evidence: 'Focused checks passed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(reviewSession.sessionId, reviewMsg))
        const reviewReady = store.messages.addMessage(reviewSession.sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(reviewSession.sessionId, reviewReady))

        const todo = readFileSync(join(docsRoot, 'goals', 'runtime-status-goal', 'todo.yml'), 'utf8')
        expect(todo).toContain('id: review-ref')
        expect(todo).toContain('status: review')
        expect(todo).toContain('tag: in_review')
        expect(todo).not.toContain('taskId:')
    })

    it('syncs linked goal todo status when an automation transition blocks a task', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-todo-block-sync'
        const goalId = 'goal-todo-block-sync'
        const taskId = 'generator-task-block-sync'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'block-sync-goal')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: block-sync-goal',
            `    goalId: ${goalId}`,
            '    title: Block sync goal',
            '    items:',
            '      - id: block-ref',
            '        status: running',
            '        tag: promoted',
            '        title: Block sync task',
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal todo block sync project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Block sync goal',
            goalKey: 'block-sync-goal',
            status: 'active'
        })

        const linkedSession = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Block sync task',
            status: 'running',
            activeSessionId: linkedSession.sessionId,
            workspaceId: 'workspace-1',
            source: 'manual',
            goalTodoRef: 'block-ref'
        })
        const controllerMetadata = {
            path: workspacePath,
            host: 'test',
            projectId,
            goalId,
            hopiController: true
        }
        const controllerStored = store.sessions.getOrCreateSession(
            'controller-session-block-sync',
            controllerMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
            debugId: getSessionDebugId(controllerStored.id),
            namespace,
            seq: 0,
            createdAt: now,
            updatedAt: now,
            active: true,
            activeAt: now,
            metadata: controllerMetadata,
            metadataVersion: controllerStored.metadataVersion,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: now
        }
        const controllerMessages: Array<{ sessionId: string; text: string }> = []

        const engine = {
            getSession(id: string) {
                if (id === linkedSession.sessionId) return linkedSession.session
                return undefined
            },
            getSessionByNamespace(id: string, requestedNamespace: string) {
                if (requestedNamespace === namespace && id === controllerSession.id) return controllerSession
                return undefined
            },
            async sendMessage(sessionId: string, message: { text: string }) {
                controllerMessages.push({ sessionId, text: message.text })
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId: linkedSession.sessionId })

        const errorMsg = store.messages.addMessage(linkedSession.sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'error',
                    message: 'Agent session exited unexpectedly'
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(linkedSession.sessionId, errorMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('id: block-ref')
        expect(todo).toContain('status: blocked')
        expect(todo).toContain('tag: unknown')
        expect(todo).toContain('summary: Agent session exited unexpectedly')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Block sync task」被阻塞了。')
        expect(controllerMessages[0]?.text).not.toContain('Controller event:')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Block sync task')
        expect(controllerMessages[0]?.text).toContain('用户可读原因：执行中的 agent 异常退出了，当前任务没有自然完成。')
        expect(controllerMessages[0]?.text).toContain('原始阻塞原因：Agent session exited unexpectedly')
    })

    it('applies fenced goal action packet JSON from manual goal tasks on ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-bare-json'
        const goalId = 'goal-generator-bare-json'
        const taskId = 'generator-task-bare-json'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal generator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build localized UI',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Localize visible copy',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Completed the implementation.',
                    '',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'review',
                                handoff: 'Localized runtime copy.',
                                evidence: 'bun test and npm run build-nolog passed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Localized runtime copy.')
        expect(task?.evidence).toBe('bun test and npm run build-nolog passed.')
    })

    it('applies goal action packets when the marker is inside a fenced json block', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-marker-inside-json-fence'
        const goalId = 'goal-marker-inside-json-fence'
        const taskId = 'generator-task-marker-inside-json-fence'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal generator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build localized UI',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Localize visible copy',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Completed the implementation.',
                    '',
                    '```json',
                    'HOPI_ACTIONS:',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'review',
                                handoff: 'Localized runtime copy.',
                                evidence: 'bun test and npm run build-nolog passed.'
                            }
                        ]
                    }, null, 2),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Localized runtime copy.')
        expect(task?.evidence).toBe('bun test and npm run build-nolog passed.')
    })

    it('applies goal action packets when codex token count events follow the action output', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-codex-token-count'
        const goalId = 'goal-codex-token-count'
        const taskId = 'generator-task-codex-token-count'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal generator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build localized UI',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Localize visible copy',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: [
                        'HOPI_ACTIONS:',
                        '```json',
                        JSON.stringify({
                            actions: [
                                {
                                    type: 'update_current_task',
                                    status: 'review',
                                    handoff: 'Localized runtime copy.',
                                    evidence: 'bun test and npm run build-nolog passed.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const tokenCountMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {
                        total: { totalTokens: 100 },
                        last: { totalTokens: 10 }
                    }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, tokenCountMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Localized runtime copy.')
        expect(task?.evidence).toBe('bun test and npm run build-nolog passed.')
    })

    it('does not use default ready transitions for goal tasks without action packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-ready-without-actions'
        const goalId = 'goal-ready-without-actions'
        const taskId = 'generator-task-without-actions'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal generator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: 'Still checking the implementation; no action packet yet.'
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const generator = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(generator?.status).toBe('running')
        expect(generator?.handoff).toBeNull()
        expect(generator?.evidence).toBeNull()
    })

    it('applies evaluator action packets while the goal task is in review', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-finished'
        const goalId = 'goal-evaluator-finished'
        const taskId = 'generator-task-accepted'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.finishedAt).toBeNumber()
        expect(accepted?.handoff).toBe('Accepted map traversal.')
        expect(accepted?.evidence).toBe('Tests and diff reviewed.')
    })

    it('auto-merges an accepted goal worktree task before finishing and cleanup runs only after success', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge'
        const goalId = 'goal-evaluator-auto-merge'
        const taskId = 'generator-task-auto-merge'
        const workspacePath = createTempWorkspace()
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: auto-merge-goal',
            `    goalId: ${goalId}`,
            '    title: Auto merge goal',
            '    items:',
            '      - ref: map-traversal',
            '        status: promoted',
            '        title: Implement map traversal',
            '        taskId: generator-task-auto-merge',
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultWorkspaceId: 'workspace-1',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeCleanupAfterMerge: true
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            goalKey: 'auto-merge-goal',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            workspaceId: 'workspace-1',
            goalTodoRef: 'map-traversal',
            source: 'evaluator'
        })

        let mergeCalls = 0
        let cleanupCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async gitRemoveWorktree() {
                cleanupCalls += 1
                return { success: true }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergedAt).toBeNumber()
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(accepted?.mergedDiffSnapshot).toMatchObject({
            files: [
                {
                    fileName: 'map.ts',
                    filePath: 'src',
                    fullPath: 'src/map.ts',
                    status: 'modified',
                    isStaged: true,
                    linesAdded: 1,
                    linesRemoved: 0
                }
            ],
            baseCommit: MERGE_BASE
        })
        expect(accepted?.finishedAt).toBeNumber()
        expect(mergeCalls).toBe(1)
        expect(cleanupCalls).toBe(1)
        expect(archiveCalls).toBe(1)
        const doneTodo = readFileSync(join(docsRoot, 'goals', 'auto-merge-goal', 'todo.yml'), 'utf8')
        expect(doneTodo).toContain('id: map-traversal')
        expect(doneTodo).toContain('status: done')
        expect(doneTodo).not.toContain('taskId:')
    })

    it('blocks accepted auto-merge when the source branch has no committed changes', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge-no-commits'
        const goalId = 'goal-evaluator-auto-merge-no-commits'
        const taskId = 'generator-task-auto-merge-no-commits'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeCleanupAfterMerge: true
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        let mergeCalls = 0
        let cleanupCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0,
                    mergeable: false
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitRemoveWorktree() {
                cleanupCalls += 1
                return { success: true }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('blocked')
        expect(accepted?.finishedAt).toBeNull()
        expect(accepted?.worktreeMergedAt).toBeNull()
        expect(accepted?.worktreeMergeCommit).toBeNull()
        expect(accepted?.mergeRuntime?.blockedReason).toContain('No committed changes are waiting to merge')
        expect(mergeCalls).toBe(0)
        expect(cleanupCalls).toBe(0)
        expect(archiveCalls).toBe(0)
    })

    it('auto-merges evaluator acceptance through the evaluator session when the generator session is stale', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-stale-generator'
        const goalId = 'goal-evaluator-stale-generator'
        const taskId = 'generator-task-stale-generator'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const oldGeneratorMetadata: NonNullable<Session['metadata']> = {
            path: '/tmp/worktree',
            host: 'test',
            projectId,
            taskId,
            hopiTaskRole: 'generator',
            worktree: {
                basePath: '/tmp/base',
                branch: 'task-branch',
                name: 'task-branch',
                worktreePath: '/tmp/worktree',
                baseCommit: MERGE_BASE
            }
        }
        const oldGeneratorStored = store.sessions.getOrCreateSession(
            'stale-generator-session',
            oldGeneratorMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const oldGeneratorSession: Session = {
            id: oldGeneratorStored.id,
            debugId: getSessionDebugId(oldGeneratorStored.id),
            namespace,
            seq: 0,
            createdAt: now - 1_000,
            updatedAt: now - 1_000,
            active: false,
            activeAt: now - 1_000,
            metadata: oldGeneratorMetadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: now - 1_000
        }

        const { sessionId: evaluatorSessionId, session: evaluatorSession } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })
        markSessionAsEvaluator(evaluatorSession)

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: oldGeneratorStored.id,
            source: 'evaluator'
        })

        let mergeStateSessionId = ''
        const engine = {
            getSession(id: string) {
                if (id === evaluatorSessionId) return evaluatorSession
                if (id === oldGeneratorStored.id) return oldGeneratorSession
                return undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                if (ns !== namespace) return undefined
                if (id === evaluatorSessionId) return evaluatorSession
                if (id === oldGeneratorStored.id) return oldGeneratorSession
                return undefined
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'ENOENT: no such file or directory'
                }
            },
            async gitMergeWorktreeState(sessionId: string) {
                mergeStateSessionId = sessionId
                if (sessionId !== evaluatorSessionId) {
                    throw new Error(`RPC handler not registered: ${sessionId}:git-merge-worktree-state`)
                }
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async archiveSession() {
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId: evaluatorSessionId })

        const assistantMsg = store.messages.addMessage(evaluatorSessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(evaluatorSessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(evaluatorSessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(evaluatorSessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked' || task?.mergeRuntime?.status === 'succeeded',
            timeoutMs: 500
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(mergeStateSessionId).toBe(evaluatorSessionId)
        expect(accepted?.mergeRuntime?.sessionId).toBe(evaluatorSessionId)
        expect(accepted?.status).toBe('done')
        expect(accepted?.mergeRuntime?.status).toBe('succeeded')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
    })

    it('does not auto-merge through an inactive linked worktree session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-inactive-merge-session'
        const goalId = 'goal-inactive-merge-session'
        const taskId = 'generator-task-inactive-merge-session'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const inactiveMetadata: NonNullable<Session['metadata']> = {
            path: '/tmp/worktree',
            host: 'test',
            projectId,
            taskId,
            hopiTaskRole: 'generator',
            worktree: {
                basePath: '/tmp/base',
                branch: 'task-branch',
                name: 'task-branch',
                worktreePath: '/tmp/worktree',
                baseCommit: MERGE_BASE
            }
        }
        const storedSession = store.sessions.getOrCreateSession(
            'inactive-worktree-session',
            inactiveMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const inactiveSession: Session = {
            id: storedSession.id,
            debugId: getSessionDebugId(storedSession.id),
            namespace,
            seq: 0,
            createdAt: now - 1_000,
            updatedAt: now - 1_000,
            active: false,
            activeAt: now - 1_000,
            metadata: inactiveMetadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: now - 1_000
        }

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: storedSession.id,
            source: 'evaluator'
        })

        let readCalls = 0
        const engine = {
            getSessionByNamespace(id: string, ns: string) {
                return id === storedSession.id && ns === namespace ? inactiveSession : undefined
            },
            async readSessionFile() {
                readCalls += 1
                throw new Error('readSessionFile should not be called for inactive sessions')
            },
            async gitMergeWorktreeState() {
                throw new Error('gitMergeWorktreeState should not be called for inactive sessions')
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const result = await autoMergeAcceptedTask({
            store,
            engine,
            namespace,
            taskId
        })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(result).toBe('not_applicable')
        expect(readCalls).toBe(0)
        expect(task?.status).toBe('review')
        expect(task?.mergeRuntime).toBeNull()
    })

    it('lets the agent repair auto-merge conflicts before retrying the accepted task merge', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge-conflict'
        const goalId = 'goal-evaluator-auto-merge-conflict'
        const taskId = 'generator-task-auto-merge-conflict'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeCleanupAfterMerge: true
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        let mergeCalls = 0
        let sendMessageCalls = 0
        let cleanupCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                if (mergeCalls === 1) {
                    return {
                        success: false,
                        error: 'Merge conflicts detected; manual resolution required',
                        conflictFiles: ['src/map.ts']
                    }
                }
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text },
                    meta: { sentFrom: 'webapp' }
                }, payload.localId)
                store.messages.addMessage(sessionId, {
                    role: 'agent',
                    content: { type: 'text', text: 'Resolved the merge conflict and updated the task branch.' }
                })
            },
            async gitRemoveWorktree() {
                cleanupCalls += 1
                return { success: true }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(2)
        expect(sendMessageCalls).toBe(1)
        expect(cleanupCalls).toBe(1)
        expect(archiveCalls).toBe(1)
    })

    it('resumes a retrying auto-merge when a merge repair ready event arrives after the monitor was lost', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge-resume'
        const goalId = 'goal-evaluator-auto-merge-resume'
        const taskId = 'generator-task-auto-merge-resume'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        const now = Date.now()
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator',
            mergeRuntime: {
                status: 'retrying',
                sessionId,
                requestedAt: now - 2_000,
                startedAt: now - 1_500,
                updatedAt: now - 1_000,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Auto-merge found conflicts; asked the linked agent to repair them (1/2).',
                blockedReason: null,
                failure: null
            }
        })

        let mergeCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Resolved the merge conflict.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'review',
                                handoff: 'Resolved merge conflicts and staged the combined result.',
                                evidence: 'Tests passed after conflict resolution.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const promptLocalId = `auto:merge_runtime:${taskId}:1:${now - 500}`
        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptLocalId,
                    hasAssistantReply: true
                }
            }
        }, `ready:${promptLocalId}`)
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(1)
        expect(archiveCalls).toBe(1)
    })

    it('resumes a retrying auto-merge when merge repair finishes without HOPI_ACTIONS', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge-no-actions'
        const goalId = 'goal-evaluator-auto-merge-no-actions'
        const taskId = 'generator-task-auto-merge-no-actions'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        const now = Date.now()
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator',
            mergeRuntime: {
                status: 'retrying',
                sessionId,
                requestedAt: now - 2_000,
                startedAt: now - 1_500,
                updatedAt: now - 1_000,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Auto-merge found conflicts; asked the linked agent to repair them (1/2).',
                blockedReason: null,
                failure: null
            }
        })

        let mergeCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async archiveSession() {
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: 'Resolved the merge conflicts by rebasing the source branch onto main.'
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const promptLocalId = `auto:merge_runtime:${taskId}:1:${now - 500}`
        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptLocalId,
                    hasAssistantReply: true
                }
            }
        }, `ready:${promptLocalId}`)
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(1)
    })

    it('resumes evaluator merge repair ready events before treating them as missing HOPI_ACTIONS', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-merge-ready-priority'
        const goalId = 'goal-evaluator-merge-ready-priority'
        const taskId = 'generator-task-evaluator-merge-ready-priority'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })
        markSessionAsEvaluator(session)

        const now = Date.now()
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator',
            mergeRuntime: {
                status: 'retrying',
                sessionId,
                requestedAt: now - 2_000,
                startedAt: now - 1_500,
                updatedAt: now - 1_000,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Auto-merge found conflicts; asked the linked agent to repair them (1/2).',
                blockedReason: null,
                failure: null
            }
        })

        let mergeCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/map.ts\n' }
            },
            async archiveSession() {
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: 'Resolved the merge conflicts by rebasing the source branch onto main.'
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const promptLocalId = `auto:merge_runtime:${taskId}:1:${now - 500}`
        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptLocalId,
                    hasAssistantReply: true
                }
            }
        }, `ready:${promptLocalId}`)
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(1)
        expect(accepted?.initRuntime?.status).not.toBe('blocked')
    })

    it('auto-merges an accepted goal worktree task with a default merge workflow when actions manifest is missing', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-default-merge'
        const goalId = 'goal-evaluator-default-merge'
        const taskId = 'generator-task-default-merge'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeCleanupAfterMerge: true
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Translate game UI copy',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        let mergeCalls = 0
        let cleanupCalls = 0
        let observedTargetBranch = ''
        let observedMergeStrategy = ''
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'ENOENT: no such file or directory'
                }
            },
            async gitMergeWorktreeState(_sessionId: string, params: { targetBranch: string }) {
                observedTargetBranch = params.targetBranch
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    targetBranch: params.targetBranch,
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot(_sessionId: string, params: { targetBranch: string }) {
                return {
                    success: true,
                    targetBranch: params.targetBranch,
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree(_sessionId: string, params: { strategy?: string }) {
                mergeCalls += 1
                observedMergeStrategy = params.strategy ?? ''
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/ui.ts\n' }
            },
            async gitRemoveWorktree() {
                cleanupCalls += 1
                return { success: true }
            },
            async archiveSession() {
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted UI localization.',
                                evidence: 'Tests and build passed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('done')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(observedTargetBranch).toBe('main')
        expect(observedMergeStrategy).toBe('squash')
        expect(mergeCalls).toBe(1)
        expect(cleanupCalls).toBe(1)
    })

    it('keeps the worktree when accepted goal task merge fails', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-merge-fails'
        const goalId = 'goal-evaluator-merge-fails'
        const taskId = 'generator-task-merge-fails'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeCleanupAfterMerge: true
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false,
            worktree: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        let cleanupCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                return id === sessionId && ns === namespace ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                return {
                    success: false,
                    error: 'Platform merge failed',
                    conflictFiles: ['src/map.ts']
                }
            },
            async gitRemoveWorktree() {
                cleanupCalls += 1
                return { success: true }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Accepted.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Accepted map traversal.',
                                evidence: 'Tests and diff reviewed.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        await waitForTask({
            store,
            namespace,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked'
        })

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted?.status).toBe('blocked')
        expect(accepted?.finishedAt).toBeNull()
        expect(accepted?.worktreeMergedAt).toBeNull()
        expect(accepted?.worktreeMergeCommit).toBeNull()
        expect(accepted?.mergeRuntime?.blockedReason).toContain('Platform merge failed')
        expect(cleanupCalls).toBe(0)
        expect(archiveCalls).toBe(0)
    })

    it('keeps goal review tasks in review when evaluator kickoff is received', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-kickoff'
        const goalId = 'goal-evaluator-kickoff'
        const taskId = 'generator-task-under-review'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review localized copy',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const kickoffMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'Task: Review localized copy\n\nRole: Evaluator' },
            meta: { sentFrom: 'webapp' }
        }, `auto:kickoff:${taskId}:1`)
        automation.handleEvent(toMessageReceivedEvent(sessionId, kickoffMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.source).toBe('evaluator')
    })

    it('requeues evaluator review when the evaluator finishes without HOPI_ACTIONS', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-actions'
        const goalId = 'goal-evaluator-missing-actions'
        const taskId = 'generator-task-missing-actions'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })
        markSessionAsEvaluator(session)

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review localized copy',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator',
            initRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now(),
                startedAt: Date.now(),
                completedAt: Date.now()
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'text', text: 'Review notes, but no action packet.' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.source).toBe('manual')
        expect(task?.initRuntime?.status).toBe('retrying')
        expect(task?.initRuntime?.sessionId).toBe(sessionId)
        expect(task?.initRuntime?.retryCount).toBe(1)
        expect(task?.initRuntime?.latestNote).toContain('Evaluator finished without a HOPI_ACTIONS packet')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('blocks evaluator review after repeated missing HOPI_ACTIONS packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-actions-block'
        const goalId = 'goal-evaluator-missing-actions-block'
        const taskId = 'generator-task-missing-actions-block'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })
        markSessionAsEvaluator(session)

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review localized copy',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator',
            initRuntime: {
                status: 'retrying',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now(),
                startedAt: Date.now(),
                completedAt: null,
                retryCount: 1,
                latestNote: 'Evaluator finished without a HOPI_ACTIONS packet; retrying review.'
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'text', text: 'Review notes, but still no action packet.' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('blocked')
        expect(task?.source).toBe('manual')
        expect(task?.initRuntime?.status).toBe('blocked')
        expect(task?.initRuntime?.sessionId).toBe(sessionId)
        expect(task?.initRuntime?.retryCount).toBe(1)
        expect(task?.initRuntime?.blockedReason).toContain('Evaluator finished without a HOPI_ACTIONS packet')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('moves evaluator rejected tasks back to generator ownership', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-reject'
        const goalId = 'goal-evaluator-reject'
        const taskId = 'generator-task-rejected'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement map traversal',
            status: 'running',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Rejected.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'planning',
                                handoff: 'Traversal helper is missing.',
                                evidence: 'Expected file was not present.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const rejected = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(rejected?.status).toBe('planning')
        expect(rejected?.source).toBe('manual')
        expect(rejected?.handoff).toBe('Traversal helper is missing.')
        expect(rejected?.evidence).toBe('Expected file was not present.')
    })

    it('moves evaluator review requeues back to generator ownership', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-requeue-review'
        const goalId = 'goal-evaluator-requeue-review'
        const taskId = 'generator-task-requeue-review'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build autopilot',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review map traversal',
            status: 'running',
            activeSessionId: sessionId,
            source: 'evaluator'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Needs another review pass.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'review',
                                handoff: 'Requeue this review with updated evidence.',
                                evidence: 'The evaluator did not accept or reject.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const requeued = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(requeued?.status).toBe('review')
        expect(requeued?.source).toBe('manual')
        expect(requeued?.handoff).toBe('Requeue this review with updated evidence.')
        expect(requeued?.evidence).toBe('The evaluator did not accept or reject.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('accepts planner-friendly snake_case goal action packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-snake-actions'
        const goalId = 'goal-snake-1'
        const taskId = 'planner-task-snake-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal snake action project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build secret realm',
            status: 'planning'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal and plan first iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Planning complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_goal',
                                goal_id: goalId,
                                status: 'active',
                                current_focus: 'First playable expedition loop',
                                success_criteria: [
                                    'Map traversal works.',
                                    'Terminal run resolution works.'
                                ]
                            },
                            {
                                type: 'create_goal_task',
                                goal_id: goalId,
                                status: 'ready',
                                title: 'Implement map traversal',
                                description: 'Make reachable map nodes selectable.',
                                acceptance: [
                                    'Reachable nodes can be selected.',
                                    'Unreachable nodes are ignored.'
                                ],
                                suggested_checks: ['bun test'],
                                non_goals: ['No battle handoff.']
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Created first execution batch.',
                                evidence: 'Reviewed repo docs and current implementation.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const created = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.id !== taskId)
        expect(created?.title).toBe('Implement map traversal')
        expect(created?.status).toBe('planning')
        expect(created?.source).toBe('manual')
        expect(created?.contract).toContain('## Acceptance')
        expect(created?.contract).toContain('- Reachable nodes can be selected.')
        expect(created?.contract).toContain('## Suggested Checks')
        expect(created?.contract).toContain('## Non-goals / Constraints')

        const goal = store.goals.getGoalByNamespace(goalId, namespace)
        expect(goal?.status).toBe('active')
        expect(goal?.currentFocus).toBe('First playable expedition loop')
        expect(goal?.successCriteria).toContain('- Map traversal works.')

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(realtimeEvents.some((event) => event.type === 'task-added')).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('accepts planner-friendly decision topic question and context fields', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-decision-actions'
        const goalId = 'goal-decision-1'
        const taskId = 'planner-task-decision-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal decision action project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build story system',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: [
                        'HOPI_ACTIONS:',
                        '```json',
                        JSON.stringify({
                            actions: [
                                {
                                    type: 'update_goal',
                                    goalId,
                                    status: 'blocked',
                                    currentFocus: 'Awaiting human confirmation.'
                                },
                                {
                                    type: 'create_decision_topic',
                                    goalId,
                                    title: 'Choose final story navigation entry',
                                    question: 'Should story content enter from MainMenu, Expedition exit, or a debug-only button?',
                                    context: 'The next implementation task needs a stable entry point before UI wiring continues.',
                                    blocking: true
                                },
                                {
                                    type: 'update_current_task',
                                    status: 'done',
                                    handoff: 'No new implementation tasks promoted.',
                                    evidence: 'Verified current goal state.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const topics = store.goalDecisionTopics.listByGoalAndNamespace(goalId, namespace)
        expect(topics).toHaveLength(1)
        expect(topics[0]?.title).toBe('Choose final story navigation entry')
        expect(topics[0]?.body).toContain('Should story content enter from MainMenu, Expedition exit, or a debug-only button?')
        expect(topics[0]?.body).toContain('The next implementation task needs a stable entry point before UI wiring continues.')
        expect(topics[0]?.blocking).toBe(true)

        const goal = store.goals.getGoalByNamespace(goalId, namespace)
        expect(goal?.status).toBe('blocked')
        expect(goal?.currentFocus).toBe('Awaiting human confirmation.')

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('No new implementation tasks promoted.')
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('flips task to in_review on ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('blocks linked task when the agent reports process-exited', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const errorMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'error',
                    message: 'Process exited unexpectedly',
                    reason: 'process-exited'
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, errorMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('blocked')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('blocks linked task when a launcher emits legacy process-exited message events', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-legacy'
        const taskId = 'task-legacy'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const errorMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'message',
                    message: 'Process exited unexpectedly: Codex app-server exited (code=1, signal=null)'
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, errorMsg))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('blocked')
    })

    it('blocks linked task when Codex reports a structured task failure before ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-codex-error'
        const taskId = 'task-codex-error'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const errorMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'error',
                    message: 'Task failed: {"detail":"Instructions are required"}',
                    reason: 'task-failed',
                    id: 'codex-error-1'
                }
            },
            meta: { sentFrom: 'cli' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, errorMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: `auto:kickoff:${taskId}:1`,
                    hasAssistantReply: false
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('blocked')
        expect(updated?.blockedReason).toBe('Task failed: {"detail":"Instructions are required"}')
        expect(updated?.blockedSource).toBe('agent')
        expect(updated?.blockedSessionId).toBe(sessionId)

        const messages = store.messages.getMessages(sessionId)
        expect(messages.some((message) => {
            const content = message.content as { content?: { text?: unknown } }
            return content.content?.text === 'Task blocked: Task failed: {"detail":"Instructions are required"}'
        })).toBe(true)
    })

    it('converts bootstrap init success into blocked when the agent exits before continuing', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap'
        const taskId = 'task-bootstrap'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'running',
            activeSessionId: sessionId,
            source: 'project_init',
            initRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Bootstrap task skipped setup preflight so it can create or repair `.hopi/actions.yaml`. Starter scaffold written.',
                blockedReason: null
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const errorMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'error',
                    message: 'Process exited unexpectedly',
                    reason: 'process-exited'
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, errorMsg))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('blocked')
        expect(updated?.initRuntime?.status).toBe('blocked')
        expect(updated?.initRuntime?.latestNote).toContain('Starter scaffold was written')
        expect(updated?.initRuntime?.blockedReason).toBe('Process exited unexpectedly')
    })

    it('asks the agent to continue repairing bootstrap contract when ready arrives with invalid actions.yaml', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-invalid-ready'
        const taskId = 'task-bootstrap-invalid-ready'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/bootstrap-invalid-ready'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId,
            source: 'project_init',
            initRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Bootstrap task skipped setup preflight so it can create or repair `.hopi/actions.yaml`. Starter scaffold written.',
                blockedReason: null
            }
        })

        const sentMessages: Array<{ text: string; localId?: string | null }> = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from([
                        'version: 1',
                        'setup:',
                        '  steps: []',
                        'preview:',
                        '  services: []',
                        'merge:',
                        '  targetBranch: "main"',
                        '  strategy: merge_commit',
                        '  conflictResolution:',
                        '    mode: ai',
                        '    maxAttempts: 2'
                    ].join('\n'), 'utf8').toString('base64')
                }
            },
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string | null }) {
                sentMessages.push(payload)
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))
        await new Promise((resolve) => setTimeout(resolve, 0))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('running')
        expect(updated?.initRuntime?.status).toBe('retrying')
        expect(updated?.initRuntime?.retryCount).toBe(1)
        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.text).toContain('Current validation errors:')
        expect(sentMessages[0]?.text).toContain('setup.steps')
    })

    it('blocks bootstrap task after repair attempts are exhausted and actions.yaml is still invalid', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-invalid-exhausted'
        const taskId = 'task-bootstrap-invalid-exhausted'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/bootstrap-invalid-exhausted'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId,
            source: 'project_init',
            initRuntime: {
                status: 'retrying',
                sessionId,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 2,
                failureFingerprint: null,
                latestNote: 'Bootstrap contract still invalid after ready; asked the agent to continue repairing it (2/2).',
                blockedReason: null
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from([
                        'version: 1',
                        'setup:',
                        '  steps: []',
                        'preview:',
                        '  services: []',
                        'merge:',
                        '  targetBranch: "main"',
                        '  strategy: merge_commit',
                        '  conflictResolution:',
                        '    mode: ai',
                        '    maxAttempts: 2'
                    ].join('\n'), 'utf8').toString('base64')
                }
            },
            async sendMessage() {
                throw new Error('should not send another repair prompt')
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))
        await new Promise((resolve) => setTimeout(resolve, 0))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('blocked')
        expect(updated?.initRuntime?.status).toBe('blocked')
        expect(updated?.initRuntime?.blockedReason).toContain('Invalid .hopi/actions.yaml')
    })

    it('moves bootstrap task to in_review only after preview becomes ready', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-preview-ready'
        const taskId = 'task-bootstrap-preview-ready'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/bootstrap-preview-ready'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId,
            source: 'project_init',
            initRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Starter scaffold written.',
                blockedReason: null
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? {
                    ...session,
                    metadata: {
                        ...session.metadata,
                        worktree: {
                            basePath: '/tmp/base',
                            worktreePath: '/tmp/bootstrap-preview-ready'
                        }
                    }
                } : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from([
                        'version: 1',
                        'setup:',
                        '  steps:',
                        '    - id: install',
                        '      type: run',
                        '      cwd: "."',
                        '      run: ["bun", "install"]',
                        'preview:',
                        '  services:',
                        '    - id: web',
                        '      type: run',
                        '      cwd: "."',
                        '      run: ["bun", "run", "dev:web"]',
                        '      ready:',
                        '        type: process_alive',
                        '      expose: primary',
                        '  success:',
                        '    require: ["web"]',
                        'merge:',
                        '  targetBranch: "main"',
                        '  strategy: merge_commit'
                    ].join('\n'), 'utf8').toString('base64')
                }
            },
            async previewStartForSession() {
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'worktree' as const,
                    rootPath: '/tmp/bootstrap-preview-ready',
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))
        await new Promise((resolve) => setTimeout(resolve, 0))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('review')
        expect(updated?.previewRuntime?.status).toBe('ready')
        expect(updated?.initRuntime?.latestNote).toContain('preview readiness')
    })

    it('keeps bootstrap task in progress and sends preview repair prompt when preview probe fails', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-preview-failed'
        const taskId = 'task-bootstrap-preview-failed'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/bootstrap-preview-failed'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId,
            source: 'project_init',
            initRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Starter scaffold written.',
                blockedReason: null
            }
        })

        const sentMessages: Array<{ text: string }> = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from([
                        'version: 1',
                        'setup:',
                        '  steps:',
                        '    - id: install',
                        '      type: run',
                        '      cwd: "."',
                        '      run: ["bun", "install"]',
                        'preview:',
                        '  services:',
                        '    - id: web',
                        '      type: run',
                        '      cwd: "."',
                        '      run: ["bun", "run", "dev:web"]',
                        '      ready:',
                        '        type: process_alive',
                        '      expose: primary',
                        '  success:',
                        '    require: ["web"]',
                        'merge:',
                        '  targetBranch: "main"',
                        '  strategy: merge_commit'
                    ].join('\n'), 'utf8').toString('base64')
                }
            },
            async previewStartForSession() {
                return {
                    active: true,
                    status: 'error',
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/bootstrap-preview-failed',
                    command: 'bun run dev:web',
                    updatedAt: Date.now(),
                    error: 'Preview process exited with code 1',
                    logTail: ['Error: missing env']
                }
            },
            async previewStopForSession() {
                return {
                    active: false,
                    status: 'stopped',
                    taskId,
                    sessionId,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                sentMessages.push(payload)
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))
        await new Promise((resolve) => setTimeout(resolve, 0))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('running')
        expect(updated?.previewRuntime?.status).toBe('retrying')
        expect(updated?.previewRuntime?.retryCount).toBe(1)
        expect(updated?.initRuntime?.status).toBe('retrying')
        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.text).toContain('bootstrap preview probe failed')
        expect(sentMessages[0]?.text).toContain('Preview process exited with code 1')
    })

    it('flips to in_review even when only codex tool-call messages exist before ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = 'prompt-1'
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const toolCallMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'CodexBash',
                    callId: 'call-1',
                    input: { command: 'ls' }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, toolCallMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
    })

    it('keeps task running when ready explicitly has no assistant reply', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-ready-no-reply'
        const taskId = 'task-ready-no-reply'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    hasAssistantReply: false
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
    })

    it('flips to in_review even if ready arrives before thinking=false session update', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
    })

    it('flips task to in_review when session is linked only via activeSessionId', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createUnlinkedSession(store, {
            namespace,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
    })

    it('treats permission pending as in_review (session-updated)', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        session.agentState = {
            requests: {
                'req-1': {
                    tool: 'filesystem',
                    arguments: { title: 'allow read' },
                    createdAt: Date.now()
                }
            }
        }
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('moves in_review back to in_progress when session starts thinking again', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'review',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        session.thinking = true
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
    })

    it('does not miss in_review -> in_progress when thinking=true arrives before agentState clears pending requests', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'review',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        // Simulate a transient state where the agent has resumed (thinking=true)
        // but the pending request envelope hasn't been cleared yet.
        session.agentState = {
            requests: {
                'req-1': {
                    tool: 'filesystem',
                    arguments: { title: 'allow read' },
                    createdAt: Date.now()
                }
            }
        }
        session.thinking = true
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
    })

    it('ignores merge-conflict auto-resolution prompts for task progress state', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'done',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            finishedAt: mergedAt,
            mergedDiffSnapshot: {
                files: [{ fullPath: 'src/app.ts', linesAdded: 5, linesRemoved: 1 }],
                capturedAt: mergedAt,
                baseCommit: 'deadbeef'
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:merge_conflict_resolve:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'resolve merge conflicts' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('done')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('done')
        expect(afterReady?.worktreeMergedAt).toBe(mergedAt)
        expect(afterReady?.worktreeMergeCommit).toBe('abc123')
    })

    it('ignores merge runtime repair prompts for task progress state', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'done',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            finishedAt: mergedAt,
            mergedDiffSnapshot: {
                files: [{ fullPath: 'src/app.ts', linesAdded: 5, linesRemoved: 1 }],
                capturedAt: mergedAt,
                baseCommit: 'deadbeef'
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:merge_runtime:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'repair merge verification failure' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('done')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('done')
        expect(afterReady?.worktreeMergedAt).toBe(mergedAt)
        expect(afterReady?.worktreeMergeCommit).toBe('abc123')
    })

    it('ignores preview setup automation prompts for task progress state', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'done',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:preview_setup:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'setup preview script' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('done')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('done')
        expect(afterReady?.worktreeMergedAt).toBe(mergedAt)
        expect(afterReady?.worktreeMergeCommit).toBe('abc123')
    })

    it('moves finished task back to in_progress on follow-up prompt and clears merge markers', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'done',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'continue this task' },
            meta: { sentFrom: 'cli' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('running')
        expect(afterPrompt?.worktreeMergedAt).toBeNull()
        expect(afterPrompt?.worktreeMergeCommit).toBeNull()
        expect(afterPrompt?.mergedDiffSnapshot).toBeNull()
        expect(afterPrompt?.finishedAt).toBeNull()

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('clears stale merged diff snapshot on follow-up prompt while already in_progress', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'running',
            activeSessionId: sessionId
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            mergedDiffSnapshot: {
                files: [{ fullPath: 'src/app.ts', linesAdded: 2, linesRemoved: 0 }],
                capturedAt: Date.now(),
                baseCommit: 'abc1234'
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'continue this task' },
            meta: { sentFrom: 'cli' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('running')
        expect(updated?.mergedDiffSnapshot).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('keeps gsd discuss tasks in discuss while the user chats', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd-discuss'
        const taskId = 'task-gsd-discuss'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'GSD project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'GSD task',
            status: 'planning',
            workflowProfile: 'gsd',
            workflowPhase: 'discuss',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'let us discuss before acting' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('planning')
        expect(afterPrompt?.workflowPhase).toBe('discuss')
    })

    it('applies gsd workflow phase transitions on prompt and ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd'
        const taskId = 'task-gsd'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'GSD project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'GSD task',
            status: 'planning',
            workflowProfile: 'gsd',
            workflowPhase: 'execute_ready',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'run implementation now' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('running')
        expect(afterPrompt?.workflowPhase).toBe('execute')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('review')
        expect(afterReady?.workflowPhase).toBe('verify')
    })

    it('keeps gsd discuss phase while discussing in session', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd-discuss'
        const taskId = 'task-gsd-discuss'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'GSD discuss project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'GSD discuss task',
            status: 'planning',
            workflowProfile: 'gsd',
            workflowPhase: 'discuss',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'Let us clarify scope before planning.' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('planning')
        expect(afterPrompt?.workflowPhase).toBe('discuss')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('planning')
        expect(afterReady?.workflowPhase).toBe('discuss')
    })

    it('ignores workflow automation prompts for task progress state', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'done',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:workflow:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'workflow-driven helper prompt' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('done')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')
    })
})
