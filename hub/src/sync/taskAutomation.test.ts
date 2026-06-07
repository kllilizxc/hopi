import { afterEach, describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '@hopi/protocol/types'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { TaskAutomation } from './taskAutomation'
import type { SyncEngine } from './syncEngine'
import { autoMergeAcceptedTask } from './taskAutoMerge'
import { applyGoalActionPacketFromSession } from './goals/goalActionPacket'
import { listGoalDecisionTopicsFromDocs } from './goals/goalDecisionStore'
import { materializeGoalTodoTaskOverlayForWrite } from './goals/goalTodoProjection'

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

function seedCanonicalGoalTodo(workspacePath: string, options: {
    goalKey: string
    goalId: string
    todoRef: string
    title: string
    status?: string
    blockedBy?: Array<{ kind: string; summary?: string }>
}): string {
    const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', options.goalKey)
    mkdirSync(goalDir, { recursive: true })
    writeFileSync(join(goalDir, 'todo.yml'), [
        'version: 1',
        'goal:',
        `  goalKey: ${options.goalKey}`,
        `  goalId: ${options.goalId}`,
        `  title: ${options.title}`,
        'items:',
        `  - ref: ${options.todoRef}`,
        '    kind: engineering',
        `    status: ${options.status ?? 'in_progress'}`,
        `    title: ${options.title}`,
        '    description: Seeded from test.',
        '    acceptanceCriteria: []',
        ...(options.blockedBy && options.blockedBy.length > 0
            ? [
                '    blockedBy:',
                ...options.blockedBy.flatMap((blocked) => [
                    '      - kind: ' + blocked.kind,
                    ...(blocked.summary ? ['        summary: ' + blocked.summary] : [])
                ])
            ]
            : ['    blockedBy: []'])
    ].join('\n'), 'utf8')
    return goalDir
}

function parseEventLog(raw: string): Array<Record<string, unknown>> {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
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
        const goalKey = 'build-autopilot'
        const taskId = 'planner-task-1'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Build autopilot',
            status: 'planning'
        })
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey), { recursive: true })
        writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'goal.md'), [
            '---',
            `goalKey: ${goalKey}`,
            'title: "Docs Before Action Packet"',
            'status: blocked',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Docs Before Action Packet',
            '',
            '## Objective',
            '',
            'Manual docs state before the planner packet lands.',
            '',
            '## Current Focus',
            '',
            'Docs focus before action packet.',
            ''
        ].join('\n'))

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
        const goalDoc = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'goal.md'), 'utf8')
        expect(goalDoc).toContain('status: active')
        expect(goalDoc).toContain('Action packet migration')
        const todoDoc = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain('title: Implement JSON action packet parser')
        expect(todoDoc).toContain('status: planned')
        expect(todoDoc).toContain('ref: planner-task-1')
        expect(todoDoc).toContain('status: done')
        const eventsLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_created_from_action_packet')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
        expect(eventsLog).toContain('goal_updated_from_action_packet')
        expect(eventsLog).toContain('todo_item_created')
        const goalUpdatedEvent = [...parseEventLog(eventsLog)]
            .reverse()
            .find((event: Record<string, unknown>) => event.action === 'goal_updated_from_action_packet')
        expect(goalUpdatedEvent?.before).toMatchObject({
            status: 'blocked',
            title: 'Docs Before Action Packet',
            currentFocus: 'Docs focus before action packet.'
        })
        expect(goalUpdatedEvent?.after).toMatchObject({
            status: 'active',
            title: 'Build autopilot',
            currentFocus: 'Action packet migration'
        })
        expect(realtimeEvents.some((event) => event.type === 'task-added')).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('applies goal action packets from ready when the goal overlay status is stale but docs still show in_progress', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-stale-overlay-ready'
        const goalId = 'goal-actions-stale-overlay-ready'
        const goalKey = 'goal-actions-stale-overlay-ready'
        const taskId = 'planner-task-stale-overlay-ready'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Docs-backed planner task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action stale overlay project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Docs-backed planner task goal',
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
            goalTodoRef: taskId,
            title: 'Stale overlay planner task',
            status: 'planning',
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
                    'Planner packet with stale overlay status.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Planner packet still applied from docs-backed execution lane.',
                                evidence: 'Canonical todo item remained in_progress.'
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('done')
        expect(task?.handoff).toBe('Planner packet still applied from docs-backed execution lane.')
        expect(task?.evidence).toBe('Canonical todo item remained in_progress.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain(`ref: ${taskId}`)
        expect(todoDoc).toContain('status: done')
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
    })

    it('materializes a docs-only current goal task from canonical session metadata before applying final action packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-docs-only-current'
        const goalId = 'goal-actions-docs-only-current'
        const goalKey = 'goal-actions-docs-only-current'
        const taskRef = 'goal-actions-docs-only-current-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskRef,
            title: 'Docs-only current task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Docs-only current project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Docs-only current goal',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: taskRef,
            thinking: false
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        expect(store.tasks.getTaskByNamespace(taskRef, namespace)).toBeNull()

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Task complete from docs-only current task.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Completed docs-only current task.',
                                evidence: 'Verified by the linked session.'
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

        const task = store.tasks.getTaskByNamespace(taskRef, namespace)
        expect(task).toMatchObject({
            id: taskRef,
            goalTodoRef: taskRef,
            status: 'review',
            goalId
        })
        expect(task?.handoff).toBe('Completed docs-only current task.')
        expect(task?.evidence).toBe('Verified by the linked session.')

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain(`ref: ${taskRef}`)
        expect(todoDoc).toContain('status: in_review')
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
    })

    it('accepts a canonical goal todo ref when applying a final action packet directly', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-direct-canonical-ref'
        const goalId = 'goal-actions-direct-canonical-ref'
        const goalKey = 'goal-actions-direct-canonical-ref'
        const taskRef = 'goal-actions-direct-canonical-ref-task'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskRef,
            title: 'Direct canonical action packet task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Direct canonical action packet project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Direct canonical action packet goal',
            status: 'active'
        })
        const { sessionId } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: taskRef,
            thinking: false
        })

        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Direct helper action packet.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Applied from the low-level helper through a canonical ref.',
                                evidence: 'No pre-existing writable overlay row was required.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent(event: SyncEvent) {
                    realtimeEvents.push(event)
                }
            } as SyncEngine,
            namespace,
            projectId,
            taskId: taskRef,
            sessionId
        })

        expect(applied).toBe(true)

        const task = store.tasks.getTaskByNamespace(taskRef, namespace)
        expect(task).toMatchObject({
            id: taskRef,
            goalTodoRef: taskRef,
            status: 'review',
            goalId
        })
        expect(task?.handoff).toBe('Applied from the low-level helper through a canonical ref.')
        expect(task?.evidence).toBe('No pre-existing writable overlay row was required.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskRef)).toBe(true)

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain(`ref: ${taskRef}`)
        expect(todoDoc).toContain('status: in_review')
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
    })

    it('rejects a stale DB-only manual goal row when applying a final action packet directly', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-direct-stale-row'
        const goalId = 'goal-actions-direct-stale-row'
        const goalKey = 'goal-actions-direct-stale-row'
        const taskId = 'goal-actions-direct-stale-row-task'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Direct stale action packet project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Direct stale action packet goal',
            status: 'active'
        })
        const { sessionId } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Direct stale action packet task',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Stale helper action packet.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Should be ignored for stale DB-only manual residue.',
                                evidence: 'No canonical todo item exists.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent(event: SyncEvent) {
                    realtimeEvents.push(event)
                }
            } as SyncEngine,
            namespace,
            projectId,
            taskId,
            sessionId
        })

        expect(applied).toBe(false)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            id: taskId,
            status: 'running',
            goalId,
            goalTodoRef: null,
            handoff: null,
            evidence: null
        })
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(false)
    })

    it('does not recreate a removed goal todo item when applying update_current_task directly after the canonical board item disappears', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-direct-docs-missing'
        const goalId = 'goal-actions-direct-docs-missing'
        const goalKey = 'goal-actions-direct-docs-missing'
        const taskId = 'goal-actions-direct-docs-missing-task'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Canonical action packet task'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Direct docs-missing action packet project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Direct docs-missing action packet goal',
            status: 'active'
        })
        const { sessionId } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay action packet title',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Canonical action packet task',
            'items: []'
        ].join('\n'), 'utf8')

        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Docs missing helper action packet.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Applied without recreating the removed board item.',
                                evidence: 'Overlay update only.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent(event: SyncEvent) {
                    realtimeEvents.push(event)
                }
            } as SyncEngine,
            namespace,
            projectId,
            taskId,
            sessionId
        })

        expect(applied).toBe(true)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            id: taskId,
            goalId,
            goalTodoRef: taskId,
            status: 'review',
            handoff: 'Applied without recreating the removed board item.',
            evidence: 'Overlay update only.'
        })
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain('items: []')
        expect(todoDoc).not.toContain(`ref: ${taskId}`)
        expect(todoDoc).not.toContain('Stale overlay action packet title')

        const eventsPath = join(goalDir, 'events.jsonl')
        if (existsSync(eventsPath)) {
            const eventsLog = readFileSync(eventsPath, 'utf8')
            expect(eventsLog).not.toContain('todo_item_updated_from_action_packet')
        }
    })

    it('rejects a stale DB-only non-manual goal row when applying a final action packet directly', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-direct-stale-bootstrap-row'
        const goalId = 'goal-actions-direct-stale-bootstrap-row'
        const goalKey = 'goal-actions-direct-stale-bootstrap-row'
        const taskId = 'goal-actions-direct-stale-bootstrap-row-task'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Direct stale bootstrap action packet project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Direct stale bootstrap action packet goal',
            status: 'active'
        })
        const { sessionId } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Direct stale bootstrap action packet task',
            status: 'running',
            activeSessionId: sessionId,
            source: 'project_init',
            workspaceId: 'workspace-1'
        })

        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Stale bootstrap helper action packet.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Should be ignored for stale DB-only bootstrap residue.',
                                evidence: 'No canonical todo item exists.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent(event: SyncEvent) {
                    realtimeEvents.push(event)
                }
            } as SyncEngine,
            namespace,
            projectId,
            taskId,
            sessionId
        })

        expect(applied).toBe(false)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            id: taskId,
            status: 'running',
            goalId,
            goalTodoRef: null,
            handoff: null,
            evidence: null
        })
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(false)
    })

    it('uses the docs-backed goal task title for per-conversation worktree auto-commit after applying a final action packet', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-action-auto-commit-title'
        const goalId = 'goal-action-auto-commit-title'
        const goalKey = 'goal-action-auto-commit-title'
        const taskId = 'goal-task-action-auto-commit-title'
        const docsTitle = 'Docs-backed auto-commit title'
        const overlayTitle = 'Stale overlay auto-commit title'
        const workspacePath = createTempWorkspace()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: docsTitle,
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal auto-commit title project',
            defaultWorkspaceId: 'workspace-1',
            worktreeAutoCommitMode: 'per_conversation'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal auto-commit title goal',
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
            goalTodoRef: taskId,
            title: overlayTitle,
            status: 'planning',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        const autocommitMessages: string[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            async gitAutocommitWorktree(_sessionId: string, options: { message: string }) {
                autocommitMessages.push(options.message)
                return { success: true }
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `prompt:auto-commit:${taskId}`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'Continue the implementation work.' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Execution complete.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'review',
                                handoff: 'Work is ready for review.',
                                evidence: 'Docs-backed title should drive the auto-commit message.'
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
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptLocalId,
                    hasAssistantReply: true
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(autocommitMessages).toEqual([
            `HOPI: task ${taskId.slice(0, 8)} — ${docsTitle}`
        ])
    })

    it('normalizes newly created goal tasks to planning instead of running without a session', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-created-running-normalized'
        const goalId = 'goal-created-running-normalized'
        const taskId = 'planner-task-created-running-normalized'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal created task normalization project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Normalize created task lanes',
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
            title: 'Plan next batch',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Next task ready.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_goal_task',
                                title: 'Animate next polish pass',
                                description: 'A planner-created task should not enter In Progress before a session starts.',
                                status: 'running',
                                priority: 'high'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Created next task.',
                                evidence: 'Planner output included a running status by mistake.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const created = store.tasks
            .listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.id !== taskId)
        expect(created?.status).toBe('planning')
        expect(created?.activeSessionId).toBeNull()
    })

    it('normalizes newly created blocked goal tasks back to planning when no blocker payload exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-created-blocked-normalized'
        const goalId = 'goal-created-blocked-normalized'
        const goalKey = 'goal-created-blocked-normalized'
        const taskId = 'planner-task-created-blocked-normalized'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal created blocked normalization project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Normalize created blocked task lanes',
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
            title: 'Plan next batch',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'text',
                text: [
                    'Next task ready.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_goal_task',
                                title: 'Investigate blocker wording',
                                description: 'A planner-created task should not be born blocked without blocker payload.',
                                status: 'blocked',
                                priority: 'medium'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const created = store.tasks
            .listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.id !== taskId)
        expect(created?.status).toBe('planning')
        expect(created?.blockedReason).toBeNull()
        expect(created?.blockedSource).toBeNull()

        const todoDoc = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain('title: Investigate blocker wording')
        expect(todoDoc).toContain('status: planned')
        expect(todoDoc).not.toContain('status: blocked')
    })

    it('applies goal action packets from the assistant message before ready arrives', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-message'
        const goalId = 'goal-actions-message'
        const taskId = 'generator-task-actions-message'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action message project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Build handoff polish',
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
            title: 'Show post-edit deck handoff summary',
            status: 'running',
            activeSessionId: sessionId,
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
                                    handoff: 'Ready for evaluator review.',
                                    evidence: 'Focused tests passed.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Ready for evaluator review.')
        expect(task?.evidence).toBe('Focused tests passed.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('replays a stored final goal action packet for active idle sessions', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-idle-replay'
        const goalId = 'goal-actions-idle-replay'
        const taskId = 'generator-task-actions-idle-replay'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action idle replay project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Recover idle final packet',
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
            title: 'Replay stored HOPI actions',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        store.messages.addMessage(sessionId, {
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
                                    handoff: 'Replayed from stored final packet.',
                                    evidence: 'The hub missed the realtime message event.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    hasAssistantReply: true
                }
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Replayed from stored final packet.')
        expect(task?.evidence).toBe('The hub missed the realtime message event.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('reconciles stored final goal action packets on project ticks', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-tick-replay'
        const goalId = 'goal-actions-tick-replay'
        const taskId = 'generator-task-actions-tick-replay'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action tick replay project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Recover idle final packet during scheduler tick',
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
            title: 'Replay stored HOPI actions from tick',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        store.messages.addMessage(sessionId, {
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
                                    handoff: 'Replayed during scheduler reconciliation.',
                                    evidence: 'No realtime session event was required.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    hasAssistantReply: true
                }
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionsByNamespace(requestedNamespace: string) {
                return requestedNamespace === namespace ? [session] : []
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        const reconciled = automation.reconcileIdleGoalActionSessions(namespace, projectId)

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(reconciled).toBe(true)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Replayed during scheduler reconciliation.')
        expect(task?.evidence).toBe('No realtime session event was required.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('reconciles stored final goal action packets on project ticks when the goal overlay status is stale but docs still show in_progress', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-tick-stale-overlay'
        const goalId = 'goal-actions-tick-stale-overlay'
        const goalKey = 'goal-actions-tick-stale-overlay'
        const taskId = 'generator-task-actions-tick-stale-overlay'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Replay stored HOPI actions from tick',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action stale tick replay project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Recover idle final packet during scheduler tick',
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
            goalTodoRef: taskId,
            title: 'Stale overlay replay task',
            status: 'planning',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        store.messages.addMessage(sessionId, {
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
                                    handoff: 'Replayed during scheduler reconciliation from docs-backed in_progress.',
                                    evidence: 'No realtime session event was required.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    hasAssistantReply: true
                }
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionsByNamespace(requestedNamespace: string) {
                return requestedNamespace === namespace ? [session] : []
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        const reconciled = automation.reconcileIdleGoalActionSessions(namespace, projectId)

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(reconciled).toBe(true)
        expect(task?.status).toBe('review')
        expect(task?.handoff).toBe('Replayed during scheduler reconciliation from docs-backed in_progress.')
        expect(task?.evidence).toBe('No realtime session event was required.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_review')
    })

    it('does not replay a stale final goal action packet from before the latest task prompt', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-idle-stale-replay'
        const goalId = 'goal-actions-idle-stale-replay'
        const taskId = 'generator-task-actions-idle-stale-replay'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action stale replay project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Avoid stale idle final packet',
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
            title: 'Do not replay stale HOPI actions',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual'
        })

        store.messages.addMessage(sessionId, {
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
                                    handoff: 'This belongs to an older turn.',
                                    evidence: 'Do not apply after a later task prompt.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        store.messages.addMessage(sessionId, {
            role: 'user',
            content: {
                type: 'text',
                text: 'Continue this task with a new prompt.'
            }
        }, `auto:kickoff:${taskId}:retry`)
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    hasAssistantReply: true
                }
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.handoff).toBeNull()
        expect(task?.evidence).toBeNull()
    })

    it('recovers a blocked goal task when its final action packet is available later', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-blocked-recovery'
        const goalId = 'goal-actions-blocked-recovery'
        const taskId = 'generator-task-actions-blocked-recovery'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal action blocked recovery project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Recover missed final packet',
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
            title: 'Recover final HOPI actions',
            status: 'running',
            blockedReason: 'Agent session became inactive before applying its final HOPI_ACTIONS packet.',
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
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
                                    handoff: 'Recovered final packet.',
                                    evidence: 'The missed packet moved the task to review.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.blockedReason).toBeNull()
        expect(task?.handoff).toBe('Recovered final packet.')
        expect(task?.evidence).toBe('The missed packet moved the task to review.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('clears stale blocker metadata when a goal task is re-prompted back into execution', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-reprompt-clears-blocker'
        const goalId = 'goal-reprompt-clears-blocker'
        const goalKey = 'goal-reprompt-clears-blocker'
        const taskId = 'generator-task-reprompt-clears-blocker'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 're-prompt-ref',
            title: 'Retry merge follow-up',
            status: 'in_review',
            blockedBy: [{ kind: 'merge_conflict', summary: 'Resolve merge conflict before retry.' }]
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal re-prompt clears blocker project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Retry merge follow-up',
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
            goalTodoRef: 're-prompt-ref',
            title: 'Retry merge follow-up',
            status: 'review',
            blockedReason: 'Resolve merge conflict before retry.',
            blockedSource: 'merge',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1',
            workflowProfile: 'default',
            mergeRuntime: {
                updatedAt: Date.now(),
                status: 'blocked',
                sessionId,
                latestNote: 'Merge blocked.',
                blockedReason: 'Resolve merge conflict before retry.',
                failureFingerprint: 'merge-blocked'
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

        const prompt = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'Please retry the merge follow-up now.' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, prompt))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBeNull()
        expect(task?.blockedSource).toBeNull()
        expect(task?.blockedSessionId).toBeNull()

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: re-prompt-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).not.toContain('blockedBy:')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_prompted')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('ignores stale DB-only manual goal rows when a linked session receives a task progress prompt', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-db-only-prompted-goal'
        const goalId = 'goal-stale-db-only-prompted'
        const goalKey = 'goal-stale-db-only-prompted'
        const taskId = 'task-stale-db-only-prompted'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Stale prompted goal project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale prompted goal',
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
            title: 'Stale prompted task',
            status: 'blocked',
            blockedReason: 'Old blocker',
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1',
            workflowProfile: 'default'
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

        const prompt = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'Please continue the stale task.' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, prompt))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            status: 'blocked',
            blockedReason: 'Old blocker',
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            goalTodoRef: null
        })
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(false)
    })

    it('preserves the execution lane when a legacy preview-blocked goal task receives a blocked action packet update', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-preview-blocked-update'
        const goalId = 'goal-actions-preview-blocked-update'
        const goalKey = 'goal-actions-preview-blocked-update'
        const taskId = 'generator-task-actions-preview-blocked-update'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Repair preview blocker',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal preview blocked action update project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Repair preview blocker',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })
        session.metadata = {
            ...(session.metadata ?? { path: workspacePath, host: 'test' }),
            path: workspacePath,
            host: 'test'
        }

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Repair preview blocker',
            status: 'blocked',
            blockedReason: 'Preview process exited with code 1',
            blockedSource: 'preview',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            previewRuntime: {
                updatedAt: Date.now(),
                status: 'blocked',
                sessionId,
                latestNote: 'Preview blocked.',
                blockedReason: 'Preview process exited with code 1',
                failureFingerprint: 'preview-blocked'
            },
            workflowProfile: 'default'
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
                                    type: 'update_current_task',
                                    status: 'blocked',
                                    handoff: 'Preview blocker still needs repair.',
                                    evidence: 'Preview crashed during the latest run.'
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBe('Preview process exited with code 1')
        expect(task?.blockedSource).toBe('preview')
        expect(task?.handoff).toBe('Preview blocker still needs repair.')
        expect(task?.evidence).toBe('Preview crashed during the latest run.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('blockedBy:')
        expect(todo).toContain('summary: Preview process exited with code 1')
    })

    it('does not synthesize a durable intervention blocker when a blocked action packet omits blocker metadata', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-blocked-update-without-blocker'
        const goalId = 'goal-actions-blocked-update-without-blocker'
        const goalKey = 'goal-actions-blocked-update-without-blocker'
        const taskId = 'generator-task-actions-blocked-update-without-blocker'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Keep packet blockers explicit',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal blocked action update without blocker project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Keep packet blockers explicit',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })
        session.metadata = {
            ...(session.metadata ?? { path: workspacePath, host: 'test' }),
            path: workspacePath,
            host: 'test'
        }

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Keep packet blockers explicit',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workflowProfile: 'default'
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent() {
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
                                    status: 'blocked',
                                    handoff: 'Need a real blocker payload before persisting a hold.'
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.blockedReason).toBeNull()
        expect(task?.blockedSource).toBeNull()
        expect(task?.handoff).toBe('Need a real blocker payload before persisting a hold.')

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('status: blocked')
        expect(todo).not.toContain('summary:')
    })

    it('applies a final goal action packet after a transient runner-offline scheduler block', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-actions-runner-recovery'
        const goalId = 'goal-actions-runner-recovery'
        const taskId = 'generator-task-actions-runner-recovery'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal runner recovery project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Recover runner-offline final packet',
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
            title: 'Recover runner-offline HOPI actions',
            status: 'running',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler',
            activeSessionId: sessionId,
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
                                    handoff: 'Recovered after runner reconnect.',
                                    evidence: 'The final packet beat the stale scheduler blocker.'
                                }
                            ]
                        }),
                        '```'
                    ].join('\n')
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.blockedReason).toBeNull()
        expect(task?.handoff).toBe('Recovered after runner reconnect.')
        expect(task?.evidence).toBe('The final packet beat the stale scheduler blocker.')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('unblocks an inactive-blocked goal task when its session keeps sending messages', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-live-message-recovery'
        const goalId = 'goal-live-message-recovery'
        const goalKey = 'goal-live-message-recovery'
        const taskId = 'generator-task-live-message-recovery'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'recover-ref',
            title: 'Recover live generator',
            status: 'blocked'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal live message recovery project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Recover active generator',
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
            title: 'Recover live generator',
            status: 'running',
            blockedReason: 'Agent session became inactive before applying its final HOPI_ACTIONS packet.',
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1',
            goalTodoRef: 'recover-ref'
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
        const toolMessage = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    output: { status: 'completed' }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, toolMessage))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBeNull()
        expect(task?.blockedSource).toBeNull()
        expect(task?.blockedSessionId).toBeNull()
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: recover-ref')
        expect(todo).toContain('status: in_progress')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_recovered')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('ignores stale DB-only manual goal rows when live messages arrive after an old inactive block', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-db-only-live-recovery-goal'
        const goalId = 'goal-stale-db-only-live-recovery'
        const goalKey = 'goal-stale-db-only-live-recovery'
        const taskId = 'task-stale-db-only-live-recovery'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Stale live recovery goal project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale live recovery goal',
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
            title: 'Stale live recovery task',
            status: 'running',
            blockedReason: 'Agent session became inactive before applying its final HOPI_ACTIONS packet.',
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        const realtimeEvents: SyncEvent[] = []
        const automation = new TaskAutomation(store, {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine)

        const toolMessage = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    output: { status: 'completed' }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, toolMessage))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBe('Agent session became inactive before applying its final HOPI_ACTIONS packet.')
        expect(task?.blockedSource).toBe('agent')
        expect(task?.blockedSessionId).toBe(sessionId)
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(false)
    })

    it('syncs goal todo docs when an inactive session blocks a goal task', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-inactive-session-block'
        const goalId = 'goal-inactive-session-block'
        const goalKey = 'goal-inactive-session-block'
        const taskId = 'generator-task-inactive-session-block'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'inactive-block-ref',
            title: 'Inactive block generator',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal inactive session project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Block inactive generator',
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
            goalTodoRef: 'inactive-block-ref',
            title: 'Inactive block generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBe('Agent session became inactive before applying its final HOPI_ACTIONS packet.')
        expect(task?.blockedSource).toBe('agent')
        expect(task?.blockedSessionId).toBe(sessionId)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: inactive-block-ref')
        expect(todo).toContain('status: in_progress')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_blocked')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('preserves docs-backed in_progress lane when an inactive session blocks a stale-planning goal overlay', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-inactive-session-stale-overlay'
        const goalId = 'goal-inactive-session-stale-overlay'
        const goalKey = 'goal-inactive-session-stale-overlay'
        const taskId = 'generator-task-inactive-session-stale-overlay'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'inactive-stale-ref',
            title: 'Inactive stale overlay generator',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal inactive stale overlay project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Block inactive generator from docs lane',
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
            goalTodoRef: 'inactive-stale-ref',
            title: 'Stale inactive overlay title',
            status: 'planning',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBe('Agent session became inactive before applying its final HOPI_ACTIONS packet.')
        expect(task?.blockedSource).toBe('agent')
        expect(task?.blockedSessionId).toBe(sessionId)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: inactive-stale-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('blockedBy:')
        expect(todo).toContain('title: Inactive stale overlay generator')
        expect(todo).not.toContain('Stale inactive overlay title')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_blocked')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
        const toast = realtimeEvents.find((event) => event.type === 'toast')
        expect(toast?.data.body).toContain('Inactive stale overlay generator')
        expect(toast?.data.body).not.toContain('Stale inactive overlay title')
    })

    it('ignores stale DB-only goal rows linked through session metadata when the session becomes inactive', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-inactive-session-stale-db-only-metadata'
        const goalId = 'goal-inactive-session-stale-db-only-metadata'
        const goalKey = 'goal-inactive-session-stale-db-only-metadata'
        const taskId = 'generator-task-inactive-session-stale-db-only-metadata'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Inactive stale DB-only metadata project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB-only metadata-linked goal row',
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
            title: 'Stale DB-only metadata-linked generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason ?? null).toBeNull()
        expect(task?.blockedSource ?? null).toBeNull()
        expect(task?.blockedSessionId ?? null).toBeNull()
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
        expect(realtimeEvents).toHaveLength(0)
    })

    it('ignores stale DB-only goal rows discovered only through activeSessionId when the session becomes inactive', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-inactive-session-stale-db-only-active'
        const goalId = 'goal-inactive-session-stale-db-only-active'
        const goalKey = 'goal-inactive-session-stale-db-only-active'
        const taskId = 'generator-task-inactive-session-stale-db-only-active'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Inactive stale DB-only activeSession project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB-only activeSession goal row',
            status: 'active'
        })

        const { sessionId, session } = createUnlinkedSession(store, {
            namespace,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale DB-only activeSession generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason ?? null).toBeNull()
        expect(task?.blockedSource ?? null).toBeNull()
        expect(task?.blockedSessionId ?? null).toBeNull()
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
        expect(realtimeEvents).toHaveLength(0)
    })

    it('preserves the execution lane when an inactive session re-blocks a legacy preview-blocked goal task', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-legacy-preview-block'
        const goalId = 'goal-legacy-preview-block'
        const goalKey = 'goal-legacy-preview-block'
        const taskId = 'generator-task-legacy-preview-block'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'legacy-preview-block-ref',
            title: 'Legacy preview blocked generator',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Legacy preview block project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Legacy preview block goal',
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
            goalTodoRef: 'legacy-preview-block-ref',
            title: 'Legacy preview blocked generator',
            status: 'blocked',
            blockedReason: 'Preview process exited with code 1',
            blockedSource: 'preview',
            blockedSessionId: sessionId,
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1',
            previewRuntime: {
                status: 'blocked',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now(),
                startedAt: Date.now(),
                completedAt: Date.now(),
                retryCount: 1,
                latestNote: 'Preview blocked.',
                blockedReason: 'Preview process exited with code 1'
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

        session.active = false
        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason).toBe('Agent session became inactive before applying its final HOPI_ACTIONS packet.')
        expect(task?.blockedSource).toBe('agent')
        expect(task?.blockedSessionId).toBe(sessionId)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: legacy-preview-block-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('kind: intervention')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_blocked')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
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
        expect(radarTask?.status).toBe('running')
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
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal checkpoint project',
            defaultWorkspaceId: 'workspace-goal-checkpoint-actions'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-checkpoint-actions',
            projectId,
            label: 'Workspace',
            path: workspacePath
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-checkpoint-actions')
        })
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
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal checkpoint project',
            defaultWorkspaceId: 'workspace-goal-checkpoint-description'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-checkpoint-description',
            projectId,
            label: 'Workspace',
            path: workspacePath
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-checkpoint-description')
        })
        expect(topics).toHaveLength(1)
        expect(topics[0]?.body).toBe('Should we stop after the architecture pass or continue directly into the content spike?')
        expect(store.goals.getGoalByNamespace(goalId, namespace)?.status).toBe('blocked')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('done')
    })

    it('creates blocking decision topics for docs-only goal todo refs from action packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-only-decision-action'
        const goalId = 'goal-docs-only-decision-action'
        const goalKey = 'goal-docs-only-decision-action'
        const taskId = 'planner-task-docs-only-decision-action'
        const docsOnlyTaskRef = 'docs-only-decision-task'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: docsOnlyTaskRef,
            title: 'Docs-only task waiting for an answer',
            status: 'planned'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal docs-only decision action project',
            defaultWorkspaceId: 'workspace-goal-docs-only-decision-action'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-docs-only-decision-action',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Docs-only decision action goal',
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
        expect(store.tasks.getTaskByNamespace(docsOnlyTaskRef, namespace)).toBeNull()

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
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_decision_topic',
                                taskId: docsOnlyTaskRef,
                                title: 'Clarify docs-only task',
                                body: 'Which implementation path should this docs-only task take?',
                                blocking: true
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Blocked docs-only work for a human answer.',
                                evidence: 'Planner step is complete.'
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-docs-only-decision-action')
        })
        expect(topics).toHaveLength(1)
        expect(topics[0]?.taskId).toBe(docsOnlyTaskRef)
        expect(topics[0]?.blocking).toBe(true)

        const blockedTask = store.tasks.getTaskByNamespace(docsOnlyTaskRef, namespace)
        expect(blockedTask?.status).toBe('planning')
        expect(blockedTask?.goalTodoRef).toBe(docsOnlyTaskRef)
        expect(blockedTask?.blockedReason).toBe('Which implementation path should this docs-only task take?')
        expect(blockedTask?.blockedSource).toBe('decision')

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('Blocked docs-only work for a human answer.')
        expect(planner?.evidence).toBe('Planner step is complete.')

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain(`ref: ${docsOnlyTaskRef}`)
        expect(todoDoc).toContain('status: planned')
        expect(todoDoc).toContain('kind: decision')
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_blocked_by_decision')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
        expect(realtimeEvents).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: docsOnlyTaskRef,
            projectId,
            namespace
        }))
    })

    it('persists canonical goal todo refs when action packets target raw goal task ids for decision topics', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-decision-raw-id-action'
        const goalId = 'goal-decision-raw-id-action'
        const goalKey = 'goal-decision-raw-id-action'
        const plannerTaskId = 'planner-task-decision-raw-id-action'
        const targetTaskId = 'goal-decision-raw-id-task'
        const targetGoalTodoRef = 'goal-decision-canonical-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: targetGoalTodoRef,
            title: 'Canonical decision target',
            status: 'planned'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal decision raw id project',
            defaultWorkspaceId: 'workspace-goal-decision-raw-id-action'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-decision-raw-id-action',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal decision raw id goal',
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
            source: 'planner'
        })
        store.tasks.createTask({
            id: targetTaskId,
            projectId,
            goalId,
            goalTodoRef: targetGoalTodoRef,
            title: 'Stale overlay decision target',
            description: 'Stale overlay decision target description.',
            status: 'planning'
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
                                taskId: targetTaskId,
                                title: 'Clarify canonical link',
                                body: 'Should the durable decision link use the todo ref?',
                                blocking: true
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Stopped after creating the decision topic.',
                                evidence: 'The target task now needs a human answer.'
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-decision-raw-id-action')
        })
        expect(topics).toHaveLength(1)
        expect(topics[0]?.taskId).toBe(targetGoalTodoRef)
        const decisions = readFileSync(join(goalDir, 'decisions.yml'), 'utf8')
        expect(decisions).toContain(`taskId: ${targetGoalTodoRef}`)
        expect(decisions).not.toContain(`taskId: ${targetTaskId}`)

        const blockedTask = store.tasks.getTaskByNamespace(targetTaskId, namespace)
        expect(blockedTask?.goalTodoRef).toBe(targetGoalTodoRef)
        expect(blockedTask?.blockedSource).toBe('decision')
    })

    it('skips task-scoped decision topics that target stale DB-only goal rows from action packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-decision-db-only-action'
        const goalId = 'goal-decision-db-only-action'
        const goalKey = 'goal-decision-db-only-action'
        const plannerTaskId = 'planner-task-decision-db-only-action'
        const staleTaskId = 'stale-db-only-decision-task'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: plannerTaskId,
            title: 'Planner task for stale DB-only decision target',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal decision DB-only action project',
            defaultWorkspaceId: 'workspace-goal-decision-db-only-action'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-decision-db-only-action',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Decision DB-only action goal',
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
            goalTodoRef: plannerTaskId,
            title: 'Planner task for stale DB-only decision target',
            status: 'running',
            activeSessionId: sessionId,
            source: 'planner'
        })
        store.tasks.createTask({
            id: staleTaskId,
            projectId,
            goalId,
            title: 'Stale DB-only decision target',
            status: 'planning',
            workflowProfile: 'default'
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
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_decision_topic',
                                taskId: staleTaskId,
                                title: 'Invalid stale DB-only task topic',
                                body: 'This should be ignored because the task is not in canonical todo docs.',
                                blocking: true
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Ignored stale DB-only decision target.',
                                evidence: 'Planner packet still completed.'
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-decision-db-only-action')
        })
        expect(topics).toHaveLength(0)

        const planner = store.tasks.getTaskByNamespace(plannerTaskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('Ignored stale DB-only decision target.')
        expect(planner?.evidence).toBe('Planner packet still completed.')

        const staleTask = store.tasks.getTaskByNamespace(staleTaskId, namespace)
        expect(staleTask?.goalTodoRef ?? null).toBeNull()
        expect(staleTask?.blockedSource ?? null).toBeNull()

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc).toContain(`ref: ${plannerTaskId}`)
        expect(todoDoc).toContain('status: done')
        expect(todoDoc).not.toContain(staleTaskId)
        const decisionsDocPath = join(goalDir, 'decisions.yml')
        expect(existsSync(decisionsDocPath)).toBe(false)
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('todo_item_updated_from_action_packet')
        expect(realtimeEvents).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: plannerTaskId,
            projectId,
            namespace
        }))
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

    it('skips duplicate goal task creation when a docs-only todo item with the same title already exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-only-duplicate-actions'
        const goalId = 'goal-docs-only-duplicate-actions'
        const goalKey = 'goal-docs-only-duplicate-actions'
        const taskId = 'planner-task-docs-only-duplicate-actions'
        const docsOnlyRef = 'docs-only-existing-task'
        const docsOnlyTitle = 'Restore archive docs through storage adapter'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: docsOnlyRef,
            title: docsOnlyTitle,
            status: 'planned'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal docs-only duplicate action project',
            defaultWorkspaceId: 'workspace-goal-docs-only-duplicate-actions'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-docs-only-duplicate-actions',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Keep docs board unique',
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
        expect(store.tasks.getTaskByNamespace(docsOnlyRef, namespace)).toBeNull()

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
                                title: docsOnlyTitle,
                                description: 'This docs-only item already exists and should not be recreated.'
                            },
                            {
                                type: 'create_goal_task',
                                title: 'Create a genuinely new docs-backed task',
                                description: 'This task is new.'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Promoted only new work.',
                                evidence: 'Skipped docs-only duplicate work.'
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

        expect(store.tasks.getTaskByNamespace(docsOnlyRef, namespace)).toBeNull()
        const tasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
        const created = tasks.find((task) => task.id !== taskId)
        expect(created?.title).toBe('Create a genuinely new docs-backed task')
        expect(tasks.filter((task) => task.title === docsOnlyTitle)).toHaveLength(0)

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('Promoted only new work.')
        expect(planner?.evidence).toBe('Skipped docs-only duplicate work.')

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc.match(new RegExp(`\\s{4}title: ${docsOnlyTitle}`, 'g'))).toHaveLength(1)
        expect(todoDoc).toContain(`ref: ${docsOnlyRef}`)
        expect(todoDoc).toContain('title: Create a genuinely new docs-backed task')
        expect(realtimeEvents.filter((event) => event.type === 'task-added')).toHaveLength(1)
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
    })

    it('creates a goal task when only a stale DB-only task with the same title exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-db-only-duplicate-actions'
        const goalId = 'goal-stale-db-only-duplicate-actions'
        const goalKey = 'goal-stale-db-only-duplicate-actions'
        const taskId = 'planner-task-stale-db-only-duplicate-actions'
        const staleTaskId = 'stale-db-only-goal-task'
        const duplicateTitle = 'Restore archive docs through storage adapter'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Ignore stale DB duplicate rows',
            'items: []',
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal stale DB-only duplicate action project',
            defaultWorkspaceId: 'workspace-goal-stale-db-only-duplicate-actions'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-stale-db-only-duplicate-actions',
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB duplicate rows',
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
            id: staleTaskId,
            projectId,
            goalId,
            title: duplicateTitle,
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
                                title: duplicateTitle,
                                description: 'This should still be created because only stale DB residue exists.'
                            },
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Promoted docs-first duplicate handling.',
                                evidence: 'Ignored stale DB-only residue.'
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
        const duplicateTitleTasks = tasks.filter((task) => task.title === duplicateTitle)
        expect(duplicateTitleTasks).toHaveLength(2)
        const created = duplicateTitleTasks.find((task) => task.id !== staleTaskId)
        expect(created?.goalTodoRef).toBe(created?.id)
        expect(store.tasks.getTaskByNamespace(staleTaskId, namespace)?.goalTodoRef).toBeNull()

        const planner = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(planner?.status).toBe('done')
        expect(planner?.handoff).toBe('Promoted docs-first duplicate handling.')
        expect(planner?.evidence).toBe('Ignored stale DB-only residue.')

        const todoDoc = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoDoc.match(new RegExp(`\\s{4}title: ${duplicateTitle}`, 'g'))).toHaveLength(1)
        expect(todoDoc).toContain(`ref: ${created?.goalTodoRef}`)
        expect(realtimeEvents.filter((event) => event.type === 'task-added')).toHaveLength(1)
        expect(realtimeEvents.some((event) => event.type === 'project-updated')).toBe(true)
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

        const created = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace,
            taskId: 'Restore archive docs through storage adapter'
        })
        expect(created?.goalTodoRef).toBe('Restore archive docs through storage adapter')
        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .filter((task) => task.goalTodoRef === 'Restore archive docs through storage adapter')).toHaveLength(1)
        const promotedTodo = readFileSync(join(docsRoot, 'goals', 'todo-ref-goal', 'todo.yml'), 'utf8')
        expect(promotedTodo).toContain('ref: Restore archive docs through storage adapter')
        expect(promotedTodo).toContain('kind: engineering')
        expect(promotedTodo).toContain('status: planned')
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
        expect(todo).toContain('ref: review-ref')
        expect(todo).toContain('kind: engineering')
        expect(todo).toContain('status: in_review')
        expect(todo).not.toContain('taskId:')
        const eventLog = readFileSync(join(docsRoot, 'goals', 'runtime-status-goal', 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('todo_item_updated_from_action_packet')
    })

    it('syncs linked goal todo status when an automation transition blocks a task', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-todo-block-sync'
        const goalId = 'goal-todo-block-sync'
        const taskId = 'generator-task-block-sync'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey: 'block-sync-goal',
            goalId,
            todoRef: 'block-ref',
            title: 'Canonical block sync task',
            status: 'in_progress'
        })

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
            title: 'Stale block sync overlay title',
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
            hopiController: true,
            goalAssistantToolingVersion: 9
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

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: block-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('title: Canonical block sync task')
        expect(todo).not.toContain('Stale block sync overlay title')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Agent session exited unexpectedly')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Canonical block sync task」被阻塞了。')
        expect(controllerMessages[0]?.text).not.toContain('Controller event:')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Canonical block sync task')
        expect(controllerMessages[0]?.text).not.toContain('Stale block sync overlay title')
        expect(controllerMessages[0]?.text).toContain('用户可读原因：执行中的 agent 异常退出了，当前任务没有自然完成。')
        expect(controllerMessages[0]?.text).toContain('原始阻塞原因：Agent session exited unexpectedly')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_blocked')
    })

    it('does not leak a stale overlay title when interruption blocking loses the canonical board item mid-flight', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-todo-block-sync-docs-missing'
        const goalId = 'goal-todo-block-sync-docs-missing'
        const taskId = 'generator-task-block-sync-docs-missing'
        const workspacePath = createTempWorkspace()
        const goalKey = 'block-sync-goal-docs-missing'
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'block-ref-docs-missing',
            title: 'Canonical block sync task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal todo block sync docs-missing project',
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
            goalKey,
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
            title: 'Stale block sync overlay title',
            status: 'running',
            activeSessionId: linkedSession.sessionId,
            workspaceId: 'workspace-1',
            source: 'manual',
            goalTodoRef: 'block-ref-docs-missing'
        })
        const controllerMetadata = {
            path: workspacePath,
            host: 'test',
            projectId,
            goalId,
            hopiController: true,
            goalAssistantToolingVersion: 9
        }
        const controllerStored = store.sessions.getOrCreateSession(
            'controller-session-block-sync-docs-missing',
            controllerMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
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
        const realtimeEvents: SyncEvent[] = []

        const originalUpdateTaskByNamespace = store.tasks.updateTaskByNamespace.bind(store.tasks)
        store.tasks.updateTaskByNamespace = ((id, ns, patch) => {
            const updated = originalUpdateTaskByNamespace(id, ns, patch)
            if (updated?.id === taskId) {
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Canonical block sync task',
                    'items: []'
                ].join('\n'), 'utf8')
            }
            return updated
        }) as typeof store.tasks.updateTaskByNamespace

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
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
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

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('ref: block-ref-docs-missing')
        expect(todo).not.toContain('Stale block sync overlay title')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Canonical block sync task」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Canonical block sync task')
        expect(controllerMessages[0]?.text).not.toContain('Stale block sync overlay title')
        const blockedToast = realtimeEvents.find(
            (event): event is Extract<SyncEvent, { type: 'toast' }> => event.type === 'toast' && event.data?.title === 'Task blocked'
        )
        expect(blockedToast?.data?.body).toContain('Canonical block sync task')
        expect(blockedToast?.data?.body).not.toContain('Stale block sync overlay title')
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
        const docsTitle = 'Docs-backed accepted task title'
        const overlayTitle = 'Stale overlay accepted task title'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey: 'auto-merge-goal',
            goalId,
            todoRef: 'map-traversal',
            title: docsTitle,
            status: 'in_review'
        })

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
            title: overlayTitle,
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
        const doneTodo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(doneTodo).toContain('ref: map-traversal')
        expect(doneTodo).toContain(`title: ${docsTitle}`)
        expect(doneTodo).not.toContain(overlayTitle)
        expect(doneTodo).toContain('kind: engineering')
        expect(doneTodo).toContain('status: done')
        expect(doneTodo).not.toContain('taskId:')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('merge_runtime_updated')
        expect(eventLog).toContain('merge_task_completed')
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
        expect(accepted?.status).toBe('review')
        expect(accepted?.blockedSource).toBe('merge')
        expect(accepted?.finishedAt).toBeNull()
        expect(accepted?.worktreeMergedAt).toBeNull()
        expect(accepted?.worktreeMergeCommit).toBeNull()
        expect(accepted?.mergeRuntime?.blockedReason).toContain('No committed changes are waiting to merge')
        expect(mergeCalls).toBe(0)
        expect(cleanupCalls).toBe(0)
        expect(archiveCalls).toBe(0)
    })

    it('blocks auto-merge for a docs-backed done goal task even when the overlay status is stale planning', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-auto-merge-stale-planning'
        const goalId = 'goal-evaluator-auto-merge-stale-planning'
        const goalKey = 'goal-evaluator-auto-merge-stale-planning'
        const taskId = 'generator-task-auto-merge-stale-planning'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Implement map traversal',
            status: 'done'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            worktreeCleanupAfterMerge: true,
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            goalTodoRef: taskId,
            title: 'Implement map traversal',
            status: 'planning',
            activeSessionId: sessionId,
            source: 'evaluator'
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
                return { success: true }
            },
            async archiveSession() {
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

        expect(result).toBe('blocked')
        expect(mergeCalls).toBe(0)

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted).toMatchObject({
            status: 'review',
            blockedSource: 'merge'
        })
        expect(accepted?.mergeRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: merging')
        expect(todo).toContain('summary: No committed changes are waiting to merge')
    })

    it('accepts a canonical goal todo ref when auto-merging through a legacy overlay id', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-no-commits-alias'
        const goalId = 'goal-no-commits-alias'
        const goalKey = 'goal-no-commits-alias'
        const taskId = 'legacy-no-commits-overlay-id'
        const taskRef = 'goal-no-commits-alias-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskRef,
            title: 'Alias auto-merge title',
            status: 'done'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal no commits alias',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: 'workspace-1',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal no commits alias',
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

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskRef,
            title: 'Stale alias overlay title',
            status: 'review',
            activeSessionId: sessionId,
            source: 'evaluator',
            workspaceId: 'workspace-1'
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
                return { success: true }
            },
            async archiveSession() {
            },
            handleRealtimeEvent(_event: SyncEvent) {
            }
        } as unknown as SyncEngine

        const result = await autoMergeAcceptedTask({
            store,
            engine,
            namespace,
            taskId: taskRef
        })

        expect(result).toBe('blocked')
        expect(mergeCalls).toBe(0)

        const accepted = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(accepted).toMatchObject({
            goalTodoRef: taskRef,
            status: 'review',
            blockedSource: 'merge'
        })
        expect(accepted?.mergeRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskRef}`)
        expect(todo).toContain('title: Alias auto-merge title')
        expect(todo).not.toContain('title: Stale alias overlay title')
    })

    it('ignores stale DB-only goal rows when auto-merge is triggered directly', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-auto-merge-direct'
        const goalId = 'goal-stale-auto-merge-direct'
        const goalKey = 'goal-stale-auto-merge-direct'
        const taskId = 'stale-goal-auto-merge-direct-task'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal stale auto-merge direct',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: 'workspace-1',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal stale auto-merge direct',
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

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Stale DB-only auto-merge task',
            status: 'review',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        let mergeStateChecks = 0
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
                mergeStateChecks += 1
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
                return { success: true }
            },
            async archiveSession() {
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

        expect(result).toBe('not_applicable')
        expect(mergeStateChecks).toBe(0)
        expect(mergeCalls).toBe(0)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.goalTodoRef).toBeNull()
        expect(existsSync(goalDir)).toBe(false)
    })

    it('does not recreate a removed goal todo item when auto-merge blocks after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-auto-merge-docs-missing-block'
        const goalId = 'goal-auto-merge-docs-missing-block'
        const goalKey = 'goal-auto-merge-docs-missing-block'
        const taskId = 'goal-auto-merge-docs-missing-block-task'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Canonical auto-merge item',
            status: 'done'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal auto-merge docs-missing block',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: 'workspace-1',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal auto-merge docs-missing block',
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

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay auto-merge item',
            status: 'done',
            activeSessionId: sessionId,
            source: 'evaluator',
            workspaceId: 'workspace-1'
        })
        const controllerMetadata = {
            path: workspacePath,
            host: 'test',
            projectId,
            goalId,
            hopiController: true,
            goalAssistantToolingVersion: 9
        }
        const controllerStored = store.sessions.getOrCreateSession(
            'controller-session-goal-auto-merge-docs-missing-block',
            controllerMetadata,
            null,
            namespace
        )
        const controllerNow = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
            namespace,
            seq: 0,
            createdAt: controllerNow,
            updatedAt: controllerNow,
            active: true,
            activeAt: controllerNow,
            metadata: controllerMetadata,
            metadataVersion: controllerStored.metadataVersion,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: controllerNow
        }

        let mergeStateChecks = 0
        const controllerMessages: Array<{ sessionId: string; text: string }> = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                if (id === controllerSession.id && ns === namespace) {
                    return controllerSession
                }
                return id === sessionId && ns === namespace ? session : undefined
            },
            async sendMessage(sentSessionId: string, message: { text: string }) {
                if (sentSessionId !== controllerSession.id) {
                    throw new Error('sendMessage unavailable for non-controller sessions in this test')
                }
                controllerMessages.push({ sessionId: sentSessionId, text: message.text })
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                mergeStateChecks += 1
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Canonical auto-merge item',
                    'items: []'
                ].join('\n'), 'utf8')
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0,
                    mergeable: false
                }
            },
            async gitMergeWorktree() {
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async archiveSession() {
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

        expect(result).toBe('blocked')
        expect(mergeStateChecks).toBe(1)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            goalTodoRef: taskId,
            blockedSource: 'merge'
        })
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${taskId}`)
        expect(todo).not.toContain('title: Stale overlay auto-merge item')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Canonical auto-merge item」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Canonical auto-merge item')
        expect(controllerMessages[0]?.text).not.toContain('Stale overlay auto-merge item')
    })

    it('auto-merges evaluator acceptance through the evaluator session when the generator session is stale', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-stale-generator'
        const goalId = 'goal-evaluator-stale-generator'
        const goalKey = 'goal-evaluator-stale-generator'
        const taskId = 'generator-task-stale-generator'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Canonical merge title',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: 'workspace-1',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            goalTodoRef: taskId,
            title: 'Stale overlay merge title',
            status: 'review',
            activeSessionId: oldGeneratorStored.id,
            source: 'evaluator',
            workspaceId: 'workspace-1'
        })

        let mergeStateSessionId = ''
        let mergeCommitMessage = ''
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
            async gitMergeWorktree(_sessionId: string, request: { commitMessage?: string | null }) {
                mergeCommitMessage = request.commitMessage ?? ''
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
        expect(mergeCommitMessage).toContain('Canonical merge title')
        expect(mergeCommitMessage).not.toContain('Stale overlay merge title')
        expect(accepted?.mergeRuntime?.sessionId).toBe(evaluatorSessionId)
        expect(accepted?.status).toBe('done')
        expect(accepted?.mergeRuntime?.status).toBe('succeeded')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: done')
        expect(todo).toContain('title: Canonical merge title')
        expect(todo).not.toContain('title: Stale overlay merge title')
    })

    it('does not auto-merge through a preferred session when relink loses the canonical goal todo item', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-todo-during-relink'
        const goalId = 'goal-evaluator-missing-todo-during-relink'
        const goalKey = 'goal-evaluator-missing-todo-during-relink'
        const taskId = 'generator-task-missing-todo-during-relink'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Canonical merge title',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator relink guard project',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: 'workspace-1',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            'stale-generator-session-missing-todo',
            oldGeneratorMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const oldGeneratorSession: Session = {
            id: oldGeneratorStored.id,
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
            goalTodoRef: taskId,
            title: 'Stale overlay merge title',
            status: 'review',
            activeSessionId: oldGeneratorStored.id,
            source: 'evaluator',
            workspaceId: 'workspace-1'
        })

        let removedTodo = false
        let mergeStateSessionId = ''
        let mergeCommitMessage = ''
        const engine = {
            getSession(id: string) {
                if (id === evaluatorSessionId) return evaluatorSession
                if (id === oldGeneratorStored.id) return oldGeneratorSession
                return undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                if (ns !== namespace) return undefined
                if (id === evaluatorSessionId) {
                    if (!removedTodo) {
                        rmSync(goalDir, { recursive: true, force: true })
                        removedTodo = true
                    }
                    return evaluatorSession
                }
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
            async gitMergeWorktree(_sessionId: string, request: { commitMessage?: string | null }) {
                mergeCommitMessage = request.commitMessage ?? ''
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

        const result = await autoMergeAcceptedTask({
            store,
            engine,
            namespace,
            taskId,
            preferredSessionId: evaluatorSessionId
        })

        expect(result).toBe('not_applicable')
        expect(mergeStateSessionId).toBe('')
        expect(mergeCommitMessage).toBe('')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe(oldGeneratorStored.id)
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
        const goalKey = 'goal-evaluator-merge-fails'
        const taskId = 'generator-task-merge-fails'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'merge-fails-ref',
            title: 'Implement map traversal',
            status: 'in_review'
        })

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
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            title: 'Stale evaluator merge overlay title',
            status: 'review',
            activeSessionId: sessionId,
            workspaceId: 'workspace-1',
            goalTodoRef: 'merge-fails-ref',
            source: 'evaluator'
        })
        const controllerMetadata = {
            path: workspacePath,
            host: 'test',
            projectId,
            goalId,
            hopiController: true,
            goalAssistantToolingVersion: 9
        }
        const controllerStored = store.sessions.getOrCreateSession(
            'controller-session-evaluator-merge-fails',
            controllerMetadata,
            null,
            namespace
        )
        const controllerNow = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
            namespace,
            seq: 0,
            createdAt: controllerNow,
            updatedAt: controllerNow,
            active: true,
            activeAt: controllerNow,
            metadata: controllerMetadata,
            metadataVersion: controllerStored.metadataVersion,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: controllerNow
        }
        const controllerMessages: Array<{ sessionId: string; text: string }> = []

        let cleanupCalls = 0
        let archiveCalls = 0
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, ns: string) {
                if (id === controllerSession.id && ns === namespace) {
                    return controllerSession
                }
                return id === sessionId && ns === namespace ? session : undefined
            },
            async sendMessage(sessionId: string, message: { text: string }) {
                if (sessionId !== controllerSession.id) {
                    throw new Error('sendMessage unavailable for non-controller sessions in this test')
                }
                controllerMessages.push({ sessionId, text: message.text })
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
                    error: 'Platform merge failed'
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
        expect(accepted?.status).toBe('review')
        expect(accepted?.blockedSource).toBe('merge')
        expect(accepted?.finishedAt).toBeNull()
        expect(accepted?.worktreeMergedAt).toBeNull()
        expect(accepted?.worktreeMergeCommit).toBeNull()
        expect(accepted?.mergeRuntime?.blockedReason).toContain('Platform merge failed')
        expect(cleanupCalls).toBe(0)
        expect(archiveCalls).toBe(0)
        const blockedTodo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(blockedTodo).toContain('ref: merge-fails-ref')
        expect(blockedTodo).toContain('status: merging')
        expect(blockedTodo).toContain('title: Implement map traversal')
        expect(blockedTodo).not.toContain('Stale evaluator merge overlay title')
        expect(blockedTodo).toContain('summary: Platform merge failed')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Implement map traversal」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Implement map traversal')
        expect(controllerMessages[0]?.text).not.toContain('Stale evaluator merge overlay title')
        expect(controllerMessages[0]?.text).toContain('原始阻塞原因：Platform merge failed')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('merge_task_blocked')
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
        const goalKey = 'goal-evaluator-missing-actions'
        const taskId = 'generator-task-missing-actions'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'evaluator-ref',
            title: 'Review localized copy',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            workspaceId: 'workspace-1',
            goalTodoRef: 'evaluator-ref',
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
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: evaluator-ref')
        expect(todo).toContain('status: in_review')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_review_requeued')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('does not block an already-merged task when evaluator review ends without HOPI_ACTIONS', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-actions-merged'
        const goalId = 'goal-evaluator-missing-actions-merged'
        const taskId = 'generator-task-missing-actions-merged'

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

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review localized copy',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator',
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123',
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
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            finishedAt: mergedAt,
            mergeRuntime: {
                status: 'succeeded',
                sessionId: 'generator-session-1',
                updatedAt: mergedAt,
                requestedAt: mergedAt - 2_000,
                startedAt: mergedAt - 1_000,
                completedAt: mergedAt,
                retryCount: 1,
                latestNote: 'Auto-merge completed for the accepted worktree task.'
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
        expect(task?.status).toBe('done')
        expect(task?.blockedReason).toBeNull()
        expect(task?.blockedSource).toBeNull()
        expect(task?.blockedSessionId).toBeNull()
        expect(task?.finishedAt).toBe(mergedAt)
        expect(task?.worktreeMergedAt).toBe(mergedAt)
        expect(task?.mergeRuntime?.status).toBe('succeeded')
        expect(task?.initRuntime?.status).toBe('succeeded')
        expect(task?.initRuntime?.latestNote).toContain('already merged successfully')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('blocks evaluator review after repeated missing HOPI_ACTIONS packets', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-actions-block'
        const goalId = 'goal-evaluator-missing-actions-block'
        const goalKey = 'goal-evaluator-missing-actions-block'
        const taskId = 'generator-task-missing-actions-block'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'evaluator-block-ref',
            title: 'Review localized copy',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            workspaceId: 'workspace-1',
            goalTodoRef: 'evaluator-block-ref',
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
        expect(task?.status).toBe('review')
        expect(task?.source).toBe('manual')
        expect(task?.blockedReason).toContain('Evaluator finished without a HOPI_ACTIONS packet')
        expect(task?.blockedSource).toBe('evaluator')
        expect(task?.blockedSessionId).toBe(sessionId)
        expect(task?.initRuntime?.status).toBe('blocked')
        expect(task?.initRuntime?.sessionId).toBe(sessionId)
        expect(task?.initRuntime?.retryCount).toBe(1)
        expect(task?.initRuntime?.blockedReason).toContain('Evaluator finished without a HOPI_ACTIONS packet')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: evaluator-block-ref')
        expect(todo).toContain('status: in_review')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Evaluator finished without a HOPI_ACTIONS packet.')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_blocked')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('does not leak a stale overlay title when evaluator missing-action blocking loses the canonical board item mid-flight', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-evaluator-missing-actions-block-docs-missing'
        const goalId = 'goal-evaluator-missing-actions-block-docs-missing'
        const goalKey = 'goal-evaluator-missing-actions-block-docs-missing'
        const taskId = 'generator-task-missing-actions-block-docs-missing'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'evaluator-block-ref-docs-missing',
            title: 'Canonical evaluator block title',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal evaluator docs-missing block project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
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
            title: 'Stale evaluator block overlay title',
            status: 'review',
            activeSessionId: 'generator-session-1',
            source: 'evaluator',
            workspaceId: 'workspace-1',
            goalTodoRef: 'evaluator-block-ref-docs-missing',
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
        const controllerMetadata = {
            path: workspacePath,
            host: 'test',
            projectId,
            goalId,
            hopiController: true,
            goalAssistantToolingVersion: 9
        }
        const controllerStored = store.sessions.getOrCreateSession(
            'controller-session-evaluator-missing-actions-block-docs-missing',
            controllerMetadata,
            null,
            namespace
        )
        const now = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
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
        const realtimeEvents: SyncEvent[] = []

        const originalUpdateTaskByNamespace = store.tasks.updateTaskByNamespace.bind(store.tasks)
        store.tasks.updateTaskByNamespace = ((id, ns, patch) => {
            const updated = originalUpdateTaskByNamespace(id, ns, patch)
            if (updated?.id === taskId) {
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Canonical evaluator block title',
                    'items: []'
                ].join('\n'), 'utf8')
            }
            return updated
        }) as typeof store.tasks.updateTaskByNamespace

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            getSessionByNamespace(id: string, requestedNamespace: string) {
                if (requestedNamespace === namespace && id === controllerSession.id) return controllerSession
                return undefined
            },
            async sendMessage(sentSessionId: string, message: { text: string }) {
                controllerMessages.push({ sessionId: sentSessionId, text: message.text })
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
        expect(task?.status).toBe('review')
        expect(task?.source).toBe('manual')
        expect(task?.blockedReason).toContain('Evaluator finished without a HOPI_ACTIONS packet')
        expect(task?.blockedSource).toBe('evaluator')
        expect(task?.blockedSessionId).toBe(sessionId)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('ref: evaluator-block-ref-docs-missing')
        expect(todo).not.toContain('Stale evaluator block overlay title')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「Canonical evaluator block title」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：Canonical evaluator block title')
        expect(controllerMessages[0]?.text).not.toContain('Stale evaluator block overlay title')
        const taskUpdated = realtimeEvents.find(
            (event): event is Extract<SyncEvent, { type: 'task-updated' }> => event.type === 'task-updated' && event.taskId === taskId
        )
        expect(taskUpdated).toBeDefined()
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
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal decision action project',
            defaultWorkspaceId: 'workspace-goal-decision-actions'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-goal-decision-actions',
            projectId,
            label: 'Workspace',
            path: workspacePath
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

        const topics = listGoalDecisionTopicsFromDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace('workspace-goal-decision-actions')
        })
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

    it('clears stale merge completion markers when ready moves a task back into review', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-ready-clears-stale-merge'
        const taskId = 'task-ready-clears-stale-merge'
        const mergedAt = Date.now() - 10_000

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
            title: 'Retry review after reopen',
            status: 'running',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc1234',
            mergeRuntime: {
                status: 'succeeded',
                sessionId,
                updatedAt: mergedAt,
                requestedAt: mergedAt - 2_000,
                startedAt: mergedAt - 1_000,
                completedAt: mergedAt,
                retryCount: 1,
                latestNote: 'Old merge result.'
            }
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            finishedAt: mergedAt,
            mergedDiffSnapshot: { baseCommit: 'abc1234' }
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
            content: { type: 'text', text: 'continue review' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('review')
        expect(task?.finishedAt).toBeNull()
        expect(task?.worktreeMergedAt).toBeNull()
        expect(task?.worktreeMergeCommit).toBeNull()
        expect(task?.mergedDiffSnapshot).toBeNull()
        expect(task?.mergeRuntime).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
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

    it('ignores stale DB-only goal rows linked through session metadata when the agent reports process-exited', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-process-exited-stale-db-only-metadata'
        const goalId = 'goal-process-exited-stale-db-only-metadata'
        const goalKey = 'goal-process-exited-stale-db-only-metadata'
        const taskId = 'generator-task-process-exited-stale-db-only-metadata'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Process-exited stale DB-only metadata project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB-only metadata-linked goal row on process exit',
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
            title: 'Stale DB-only metadata-linked generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason ?? null).toBeNull()
        expect(task?.blockedSource ?? null).toBeNull()
        expect(task?.blockedSessionId ?? null).toBeNull()
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
        expect(realtimeEvents).toHaveLength(0)
    })

    it('ignores stale DB-only bootstrap goal rows linked through session metadata when the agent reports process-exited', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-process-exited-stale-db-only-bootstrap-metadata'
        const goalId = 'goal-process-exited-stale-db-only-bootstrap-metadata'
        const goalKey = 'goal-process-exited-stale-db-only-bootstrap-metadata'
        const taskId = 'generator-task-process-exited-stale-db-only-bootstrap-metadata'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Process-exited stale DB-only bootstrap metadata project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB-only bootstrap metadata-linked goal row on process exit',
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
            title: 'Stale DB-only bootstrap metadata-linked generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'project_init',
            workspaceId: 'workspace-1'
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

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason ?? null).toBeNull()
        expect(task?.blockedSource ?? null).toBeNull()
        expect(task?.blockedSessionId ?? null).toBeNull()
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
        expect(realtimeEvents).toHaveLength(0)
    })

    it('ignores stale DB-only goal rows discovered only through activeSessionId when a launcher emits legacy process-exited events', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-process-exited-stale-db-only-active'
        const goalId = 'goal-process-exited-stale-db-only-active'
        const goalKey = 'goal-process-exited-stale-db-only-active'
        const taskId = 'generator-task-process-exited-stale-db-only-active'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Process-exited stale DB-only activeSession project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ignore stale DB-only activeSession goal row on process exit',
            status: 'active'
        })

        const { sessionId, session } = createUnlinkedSession(store, {
            namespace,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale DB-only activeSession generator',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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
                    type: 'message',
                    message: 'Process exited unexpectedly: Codex app-server exited (code=1, signal=null)'
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, errorMsg))

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('running')
        expect(task?.blockedReason ?? null).toBeNull()
        expect(task?.blockedSource ?? null).toBeNull()
        expect(task?.blockedSessionId ?? null).toBeNull()
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
        expect(realtimeEvents).toHaveLength(0)
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

    it('keeps the docs-backed goal task title when bootstrap contract repair prompt delivery fails', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-bootstrap-invalid-send-failed'
        const goalId = 'goal-bootstrap-invalid-send-failed'
        const goalKey = 'goal-bootstrap-invalid-send-failed'
        const taskId = 'task-goal-bootstrap-invalid-send-failed'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'bootstrap-contract-send-failed-ref',
            title: 'Canonical bootstrap contract title',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal bootstrap send failure project',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Bootstrap send failure goal',
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
            goalTodoRef: 'bootstrap-contract-send-failed-ref',
            title: 'Stale bootstrap overlay title',
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

        const realtimeEvents: SyncEvent[] = []
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
                throw new Error('repair prompt delivery failed')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
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
        expect(updated?.blockedSource).toBe('bootstrap_contract')
        expect(updated?.blockedReason).toContain('repair prompt delivery failed')
        expect(updated?.initRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: bootstrap-contract-send-failed-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('title: Canonical bootstrap contract title')
        expect(todo).not.toContain('Stale bootstrap overlay title')
        expect(todo).toContain('summary: repair prompt delivery failed')
        const blockedToast = realtimeEvents.find(
            (event): event is Extract<SyncEvent, { type: 'toast' }> => event.type === 'toast' && event.data?.title === 'Bootstrap repair failed'
        )
        expect(blockedToast?.data?.body).toContain('Canonical bootstrap contract title')
        expect(blockedToast?.data?.body).not.toContain('Stale bootstrap overlay title')
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

    it('keeps a goal-scoped bootstrap task in progress when contract repair attempts are exhausted', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-bootstrap-invalid-exhausted'
        const goalId = 'goal-bootstrap-invalid-exhausted'
        const goalKey = 'goal-bootstrap-invalid-exhausted'
        const taskId = 'task-goal-bootstrap-invalid-exhausted'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'bootstrap-contract-ref',
            title: 'Initialize project scripts',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal bootstrap project',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Bootstrap goal',
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
            goalTodoRef: 'bootstrap-contract-ref',
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
        expect(updated?.status).toBe('running')
        expect(updated?.blockedSource).toBe('bootstrap_contract')
        expect(updated?.blockedReason).toContain('Invalid .hopi/actions.yaml')
        expect(updated?.initRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: bootstrap-contract-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: "Invalid .hopi/actions.yaml:')
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

    it('keeps a goal-scoped bootstrap task in progress when preview repair attempts are exhausted', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-bootstrap-preview-exhausted'
        const goalId = 'goal-bootstrap-preview-exhausted'
        const goalKey = 'goal-bootstrap-preview-exhausted'
        const taskId = 'task-goal-bootstrap-preview-exhausted'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'bootstrap-preview-ref',
            title: 'Canonical bootstrap preview title',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal bootstrap preview project',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Bootstrap preview goal',
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
            goalTodoRef: 'bootstrap-preview-ref',
            title: 'Stale bootstrap preview overlay title',
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
            },
            previewRuntime: {
                status: 'retrying',
                sessionId,
                updatedAt: 25,
                requestedAt: 21,
                startedAt: 22,
                completedAt: null,
                retryCount: 2,
                latestNote: 'Bootstrap preview probe failed; asked the agent to keep repairing it (2/2).',
                blockedReason: null
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? {
                    ...session,
                    metadata: {
                        ...session.metadata,
                        worktree: undefined
                    }
                } : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async previewStartForSession() {
                return {
                    active: true,
                    status: 'error',
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
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
            async sendMessage() {
                throw new Error('should not send another preview repair prompt')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
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
        expect(updated?.blockedSource).toBe('bootstrap_preview')
        expect(updated?.blockedReason).toContain('Preview process exited with code 1')
        expect(updated?.previewRuntime?.status).toBe('blocked')
        expect(updated?.initRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: bootstrap-preview-ref')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('title: Canonical bootstrap preview title')
        expect(todo).not.toContain('Stale bootstrap preview overlay title')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Preview process exited with code 1')
        const blockedToast = realtimeEvents.find(
            (event): event is Extract<SyncEvent, { type: 'toast' }> => event.type === 'toast' && event.data?.title === 'Bootstrap preview failed'
        )
        expect(blockedToast?.data?.body).toContain('Canonical bootstrap preview title')
        expect(blockedToast?.data?.body).not.toContain('Stale bootstrap preview overlay title')
    })

    it('does not recreate a removed goal todo item when bootstrap preview blocking loses the canonical board item mid-flight', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-bootstrap-preview-docs-missing'
        const goalId = 'goal-bootstrap-preview-docs-missing'
        const goalKey = 'goal-bootstrap-preview-docs-missing'
        const taskId = 'task-goal-bootstrap-preview-docs-missing'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'bootstrap-preview-docs-missing-ref',
            title: 'Canonical bootstrap preview title',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal bootstrap preview docs-missing project',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Bootstrap preview goal',
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
            goalTodoRef: 'bootstrap-preview-docs-missing-ref',
            title: 'Stale bootstrap preview overlay title',
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
            },
            previewRuntime: {
                status: 'retrying',
                sessionId,
                updatedAt: 25,
                requestedAt: 21,
                startedAt: 22,
                completedAt: null,
                retryCount: 2,
                latestNote: 'Bootstrap preview probe failed; asked the agent to keep repairing it (2/2).',
                blockedReason: null
            }
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? {
                    ...session,
                    metadata: {
                        ...session.metadata,
                        worktree: undefined
                    }
                } : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async previewStartForSession() {
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Canonical bootstrap preview title',
                    'items: []'
                ].join('\n'), 'utf8')
                return {
                    active: true,
                    status: 'error',
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
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
            async sendMessage() {
                throw new Error('should not send another preview repair prompt')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
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
        expect(updated?.blockedSource).toBe('bootstrap_preview')
        expect(updated?.blockedReason).toContain('Preview process exited with code 1')
        expect(updated?.previewRuntime?.status).toBe('blocked')
        expect(updated?.initRuntime?.status).toBe('blocked')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('ref: bootstrap-preview-docs-missing-ref')
        expect(todo).not.toContain('Stale bootstrap preview overlay title')
        const blockedToast = realtimeEvents.find(
            (event): event is Extract<SyncEvent, { type: 'toast' }> => event.type === 'toast' && event.data?.title === 'Bootstrap preview failed'
        )
        expect(blockedToast?.data?.body).toContain('Canonical bootstrap preview title')
        expect(blockedToast?.data?.body).not.toContain('Stale bootstrap preview overlay title')
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

    it('ignores stale DB-only manual goal rows when ready arrives', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-db-only-ready-goal'
        const goalId = 'goal-stale-db-only-ready'
        const goalKey = 'goal-stale-db-only-ready'
        const taskId = 'task-stale-db-only-ready'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Stale ready goal project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale ready goal',
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
            title: 'Stale ready task',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1',
            workflowProfile: 'default'
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

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            status: 'running',
            goalTodoRef: null
        })
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(false)
    })

    it('ignores stale DB-only non-manual goal rows when ready arrives', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-db-only-ready-bootstrap-goal'
        const goalId = 'goal-stale-db-only-ready-bootstrap'
        const goalKey = 'goal-stale-db-only-ready-bootstrap'
        const taskId = 'task-stale-db-only-ready-bootstrap'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Stale bootstrap ready goal project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale bootstrap ready goal',
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
            title: 'Stale bootstrap ready task',
            status: 'running',
            activeSessionId: sessionId,
            source: 'project_init',
            workspaceId: 'workspace-1'
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

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            status: 'running',
            goalTodoRef: null
        })
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(false)
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

    it('resolves an unlinked session to the docs-backed running goal task when the overlay lane is stale', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-unlinked-goal-session'
        const goalId = 'goal-unlinked-goal-session'
        const goalKey = 'goal-unlinked-goal-session'
        const taskId = 'goal-task-unlinked-goal-session'
        const distractorTaskId = 'distractor-task-unlinked-goal-session'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Docs-backed unlinked goal task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Unlinked goal session project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Unlinked goal session goal',
            status: 'active'
        })

        const { sessionId, session } = createUnlinkedSession(store, {
            namespace,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay goal task',
            status: 'planning',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })
        store.tasks.createTask({
            id: distractorTaskId,
            projectId,
            title: 'Distractor task',
            status: 'planning',
            activeSessionId: sessionId,
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
                    'Unlinked fallback should still find the docs-backed running goal task.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Unlinked session resolved through docs-backed running lane.',
                                evidence: 'The stale planning overlay did not hide the active Goal task.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const goalTask = store.tasks.getTaskByNamespace(taskId, namespace)
        const distractorTask = store.tasks.getTaskByNamespace(distractorTaskId, namespace)
        expect(goalTask?.status).toBe('review')
        expect(goalTask?.handoff).toBe('Unlinked session resolved through docs-backed running lane.')
        expect(goalTask?.evidence).toBe('The stale planning overlay did not hide the active Goal task.')
        expect(distractorTask?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_review')
    })

    it('resolves session metadata canonical refs back to a legacy goal overlay id', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-canonical-session-link-ref'
        const goalId = 'goal-canonical-session-link-ref'
        const goalKey = 'goal-canonical-session-link-ref'
        const rawTaskId = 'legacy-goal-overlay-id'
        const todoRef = 'canonical-session-link-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Canonical session link task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Canonical session link project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Canonical session link goal',
            status: 'active'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId: todoRef,
            thinking: false
        })

        store.tasks.createTask({
            id: rawTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale linked overlay title',
            status: 'planning',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
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
                    'Canonical session metadata ref should still resolve the writable overlay row.',
                    '',
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_current_task',
                                status: 'done',
                                handoff: 'Resolved canonical session link ref.',
                                evidence: 'Legacy overlay id did not block the action packet.'
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

        const updated = store.tasks.getTaskByNamespace(rawTaskId, namespace)
        expect(updated?.status).toBe('review')
        expect(updated?.handoff).toBe('Resolved canonical session link ref.')
        expect(updated?.evidence).toBe('Legacy overlay id did not block the action packet.')
        expect(updated?.goalTodoRef).toBe(todoRef)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === rawTaskId)).toBe(true)

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('status: in_review')
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

    it('syncs goal todo docs when permission pending moves a goal task into review', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-permission-review'
        const goalId = 'goal-permission-review'
        const goalKey = 'goal-permission-review'
        const taskId = 'task-goal-permission-review'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'permission-ref',
            title: 'Permission review task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal permission review project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Permission review goal',
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
            goalTodoRef: 'permission-ref',
            title: 'Permission review task',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId: 'workspace-1'
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
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: permission-ref')
        expect(todo).toContain('status: in_review')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_ready')
    })

    it('does not recreate a removed goal todo item when permission pending arrives after the canonical board item disappears', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-permission-review-docs-missing'
        const goalId = 'goal-permission-review-docs-missing'
        const goalKey = 'goal-permission-review-docs-missing'
        const taskId = 'task-goal-permission-review-docs-missing'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: 'permission-ref',
            title: 'Permission review missing projection task',
            status: 'in_progress'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal permission review docs missing project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Permission review missing projection goal',
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
            goalTodoRef: 'permission-ref',
            title: 'Stale permission review overlay title',
            status: 'running',
            activeSessionId: sessionId,
            workspaceId: 'workspace-1'
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

        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Permission review missing projection task',
            'items: []'
        ].join('\n'), 'utf8')

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
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('ref: permission-ref')
        const eventLogPath = join(goalDir, 'events.jsonl')
        if (existsSync(eventLogPath)) {
            const eventLog = readFileSync(eventLogPath, 'utf8')
            expect(eventLog).not.toContain('automation_task_ready')
        }
    })

    it('ignores stale DB-only manual goal rows when permission pending arrives', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-db-only-permission-goal'
        const goalId = 'goal-stale-db-only-permission'
        const goalKey = 'goal-stale-db-only-permission'
        const taskId = 'task-stale-db-only-permission'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Stale permission goal project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale permission goal',
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
            title: 'Stale permission task',
            status: 'running',
            activeSessionId: sessionId,
            source: 'manual',
            workspaceId: 'workspace-1'
        })

        const realtimeEvents: SyncEvent[] = []
        const automation = new TaskAutomation(store, {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine)
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

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        expect(existsSync(goalDir)).toBe(false)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(false)
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

    it('moves a goal task from in_review back to in_progress when the session starts thinking again', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-thinking-resumed'
        const goalId = 'goal-thinking-resumed'
        const goalKey = 'goal-thinking-resumed'
        const taskId = 'goal-task-thinking-resumed'
        const workspacePath = createTempWorkspace()
        const goalDir = seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Goal thinking resumed task',
            status: 'in_review'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Goal thinking resumed project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal thinking resumed',
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
            goalTodoRef: taskId,
            title: 'Goal thinking resumed task',
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
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_progress')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('automation_task_resumed')
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
