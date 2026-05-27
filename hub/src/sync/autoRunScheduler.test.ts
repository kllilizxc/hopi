import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { AutoRunScheduler } from './autoRunScheduler'
import { createGoalDecisionTopicInDocs, resolveGoalDecisionTopicInDocs } from './goals/goalDecisions'
import { upsertGoalTodoTaskState } from './goals/goalTodo'
import type { SyncEngine } from './syncEngine'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

const DEFAULT_VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    '      expose: primary',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) {
            return
        }
        await delay(20)
    }
    throw new Error('Timed out while waiting for condition')
}

function createProjectWithTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    workflowProfile: string
    workflowPhase: string | null
    goalId?: string | null
    activeSessionId?: string | null
    workspaceId?: string | null
    source?: string | null
    autoRunEnabled?: boolean
    automationReadinessStatus?: 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
}): void {
    const workspaceId = options.workspaceId ?? `${options.projectId}-workspace`
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Project',
        autoRunEnabled: options.autoRunEnabled ?? true,
        maxRunningSessions: 1,
        defaultWorkspaceId: workspaceId,
        automationReadinessStatus: options.automationReadinessStatus ?? 'unknown'
    })
    store.workspaces.createWorkspace({
        id: workspaceId,
        projectId: options.projectId,
        path: `/tmp/${workspaceId}`
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        goalId: options.goalId ?? null,
        title: 'Task',
        status: 'planning',
        source: options.source ?? 'manual',
        workflowProfile: options.workflowProfile,
        workflowPhase: options.workflowPhase,
        activeSessionId: options.activeSessionId ?? null
    })
}

describe('AutoRunScheduler workflow strategy gate', () => {
    it('does not start planned tasks while goal automation is paused', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-paused-auto-run'
        const goalId = 'goal-paused-auto-run'
        const taskId = 'task-goal-paused-auto-run'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Paused goal',
            status: 'active',
            autopilotEnabled: true,
            automationPausedAt: Date.now()
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Task',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('planning')
        expect(realtimeEvents).toEqual([])
    })

    it('does not create autopilot tasks while goal automation is paused', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-paused-goal-autopilot'
        const goalId = 'goal-paused-autopilot'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Paused autonomous goal',
            status: 'active',
            autopilotEnabled: true,
            automationPausedAt: Date.now()
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })).toEqual([])
        expect(realtimeEvents).toEqual([])
    })

    it('does not create planner refill tasks while a goal is blocked for milestone review', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-blocked-goal-no-planner-refill'
        const goalId = 'goal-blocked-no-planner-refill'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Blocked autonomous goal',
            status: 'blocked',
            autopilotEnabled: true,
            currentFocus: 'Awaiting milestone review.'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })).toEqual([])
        expect(realtimeEvents).toEqual([])
    })

    it('continues existing planned goal tasks even when the goal is blocked', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-blocked-goal-planned-continue'
        const goalId = 'goal-blocked-planned-continue'
        const taskId = 'task-blocked-goal-planned-continue'
        const workspaceId = 'workspace-blocked-goal-planned-continue'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Blocked goal',
            status: 'blocked',
            autopilotEnabled: true,
            currentFocus: 'Awaiting milestone review.'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Finish current batch task',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-blocked-goal-planned-continue',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, taskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: spawned.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        expect(spawnCount).toBe(1)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe(spawned.id)
    })

    it('auto-runs planner tasks for an enabled goal even when project auto-run is off', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-autopilot'
        const goalId = 'goal-autopilot'
        const taskId = 'task-goal-planner'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autonomous goal',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Task',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('auto-runs goal planner tasks when project auto-run is on even if goal autopilot is off', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-project-auto-run'
        const goalId = 'goal-manual-autopilot'
        const taskId = 'task-goal-planner-project-auto'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Manual autopilot goal',
            autopilotEnabled: false
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('creates a planner tick task when an enabled goal board is running low', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-low-water'
        const goalId = 'goal-low-water'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating',
            status: 'active',
            autopilotEnabled: true
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner' && task.title.includes('Plan next'))
        expect(planner?.title).toContain('Plan next')
        expect(planner?.agentFlavor).toBeNull()
        expect(planner?.model).toBeNull()
        expect(planner?.permissionMode).toBe('safe-yolo')
        expect(planner?.contract).toContain('.hopi/docs/goals/keep-iterating/todo.yml')
        expect(planner?.contract).toContain('.hopi/docs/goals/keep-iterating/design.md')
        expect(planner?.contract).toContain('before creating or reshaping substantial engineering tasks')
        expect(planner?.contract).toContain('Target open generator tasks: 3')
        expect(planner?.contract).toContain('Current open generator tasks: 0')
        expect(planner?.contract).toContain('If the milestone assessment says continuing is worthwhile, create up to 3 independent ready generator tasks')
        expect(planner?.contract).not.toContain('create a DecisionTopic proposing completion')
        expect(planner?.contract).toContain('Leave final Goal done/archive to explicit user actions')
        expect(planner?.contract).toContain('milestone review is allowed and should block the Goal')
        expect(planner?.contract).toContain('Do not mark the Goal paused, done, or archived just because the current iteration looks complete')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
    })

    it('ignores candidate planning tasks when deciding whether to refill with a planner tick', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-candidate-backlog'
        const goalId = 'goal-candidate-backlog'
        const taskId = 'candidate-task'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-candidate-backlog',
            projectId,
            path: mkdtempSync(join(tmpdir(), 'hopi-candidate-backlog-'))
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep candidates in backlog',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Candidate backlog item',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })
        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'candidate',
            title: 'Candidate backlog item'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner' && task.title.includes('Plan next'))
        expect(planner?.contract).toContain('Current open generator tasks: 0')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
    })

    it('does not materialize ready goal todo tasks blocked by task-scoped decisions', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-ready-decision-blocked'
        const goalId = 'goal-ready-decision-blocked'
        const taskId = 'ready-task-needs-choice'
        const project = store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        const defaultWorkspace = store.workspaces.createWorkspace({
            id: `${projectId}-workspace`,
            projectId,
            path: mkdtempSync(join(tmpdir(), 'hopi-ready-decision-blocked-'))
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: defaultWorkspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep decision-blocked ready tasks parked',
            status: 'active',
            autopilotEnabled: true
        })
        upsertGoalTodoTaskState({
            project,
            goal,
            defaultWorkspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            title: 'Ready task needs choice'
        })
        createGoalDecisionTopicInDocs({
            id: 'topic-ready-task-choice',
            project,
            goal,
            defaultWorkspace,
            scope: 'task',
            taskId,
            title: 'Choose ready task direction',
            body: 'Pick one path before starting this task.',
            blocking: true
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === taskId)).toBe(false)
    })

    it('carries recent resolved decision answers into generated planner loop tasks', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-decision-handoff'
        const goalId = 'goal-decision-handoff'
        const workspaceId = `${projectId}-workspace`
        const project = store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 0,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        const defaultWorkspace = store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: mkdtempSync(join(tmpdir(), 'hopi-decision-handoff-'))
        })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating with human answer',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: 'finished-planner-task',
            projectId,
            goalId,
            title: 'Previous planner question',
            status: 'done',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })
        const topic = createGoalDecisionTopicInDocs({
            id: 'topic-main-menu-entry',
            project,
            goal,
            defaultWorkspace,
            scope: 'task',
            taskId: 'finished-planner-task',
            title: 'Choose story entry',
            body: 'Should story content enter from MainMenu or a debug-only button?',
            blocking: true
        })
        if (!topic) {
            throw new Error('Expected docs-backed decision topic')
        }
        const resolvedTopic = resolveGoalDecisionTopicInDocs({
            project,
            goal,
            defaultWorkspace,
            topicId: topic.id,
            resolution: 'Use MainMenu as the player-facing entry.'
        })
        if (!resolvedTopic) {
            throw new Error('Expected docs-backed decision topic to resolve')
        }

        const engine = {
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner' && task.title.includes('Plan next'))
        expect(planner?.contract).toContain('## Milestone Stop Assessment')
        expect(planner?.contract).toContain('create exactly one blocking DecisionTopic with `scope: "goal"`')
        expect(planner?.contract).toContain('set the Goal status to blocked')
        expect(planner?.contract).toContain('If the milestone assessment says continuing is worthwhile')
        expect(planner?.contract).not.toContain('do not create a completion DecisionTopic')
        expect(planner?.handoff).toContain('Resolved DecisionTopic: Choose story entry')
        expect(planner?.handoff).toContain('Should story content enter from MainMenu or a debug-only button?')
        expect(planner?.handoff).toContain('Use MainMenu as the player-facing entry.')
    })

    it('surfaces project-configured milestone backstops in the planner contract', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-backstop'
        const goalId = 'goal-planner-backstop'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationBackstopPolicy: {
                maxHoursWithoutMilestone: 0,
                maxGeneratorTasksWithoutMilestone: 1,
                maxPlannerRefillsWithoutMilestone: 0
            },
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating with a soft stop',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: 'finished-generator-task',
            projectId,
            goalId,
            title: 'Completed generator work',
            status: 'done',
            source: 'manual'
        })

        const engine = {
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner' && task.title.includes('Plan next'))
        expect(planner?.contract).toContain('## Backstop Triggered')
        expect(planner?.contract).toContain('1 completed generator tasks since the last milestone baseline')
        expect(planner?.contract).toContain('This is not an automatic stop')
    })

    it('continues a reactivated goal planner in its active linked session with decision context', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-reactivated'
        const goalId = 'goal-planner-reactivated'
        const taskId = 'task-planner-reactivated'
        const sessionId = 'session-planner-reactivated'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating after a human answer',
            status: 'active',
            autopilotEnabled: true
        })
        store.sessions.getOrCreateSession(
            sessionId,
            { path: '/tmp/workspace', host: 'localhost', projectId, taskId, hopiTaskRole: 'planner' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'planning',
            source: 'planner',
            activeSessionId: sessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: [
                'Resolved DecisionTopic: Choose next slice',
                'Topic ID: topic-next-slice',
                '',
                'Question / Context:',
                'Should the next story slice enter from MainMenu?',
                '',
                'Human answer:',
                'Use MainMenu as the player-facing entry.'
            ].join('\n')
        })

        let spawnCount = 0
        let kickoffText = ''
        let kickoffSessionId = ''
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return [{
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, taskId, path: '/tmp/workspace', hopiTaskRole: 'planner' }
                }]
            },
            getSessionByNamespace(lookupSessionId: string) {
                if (lookupSessionId !== sessionId) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, taskId, path: '/tmp/workspace', hopiTaskRole: 'planner' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: 'unexpected-new-session'
                }
            },
            async sendMessage(sentSessionId: string, payload: { text: string }) {
                kickoffSessionId = sentSessionId
                kickoffText = payload.text
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await delay(150)

        expect(spawnCount).toBe(0)
        expect(kickoffSessionId).toBe(sessionId)
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('Resolved DecisionTopic: Choose next slice')
        expect(kickoffText).toContain('Use MainMenu as the player-facing entry.')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('requests a planner tick when a finished goal task leaves the board running low', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-finished-low-water'
        const goalId = 'goal-finished-low-water'
        const taskId = 'task-finished-work'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating after work finishes',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Finished implementation task',
            status: 'done',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.handleEvent({
            type: 'task-updated',
            taskId,
            projectId,
            namespace,
            data: { taskId }
        })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner' && task.title.includes('Plan next')))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner' && task.id !== taskId)
        expect(planner?.title).toContain('Plan next')
        expect(planner?.permissionMode).toBe('safe-yolo')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
    })

    it('does not create a planner tick while goal work is already active', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-active-work'
        const goalId = 'goal-active-work'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Avoid planner churn',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: 'task-active-review',
            projectId,
            goalId,
            title: 'Active review work',
            status: 'review',
            source: 'evaluator',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await delay(100)

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner')
        expect(planner).toBeUndefined()
        expect(realtimeEvents.some((event) => {
            if (event.type !== 'task-added') return false
            const task = store.tasks.getTaskByNamespace(event.taskId, namespace)
            return task?.source === 'planner'
        })).toBe(false)
    })

    it('creates a periodic radar task for an enabled active goal', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar'
        const goalId = 'goal-radar'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Maintain repo health',
            status: 'active',
            autopilotEnabled: true
        })

        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'radar'))

        const radar = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'radar')
        expect(radar?.agentFlavor).toBeNull()
        expect(radar?.model).toBeNull()
        expect(radar?.permissionMode).toBe('safe-yolo')
        expect(radar?.contract).toContain('.hopi/preference.md')
        expect(radar?.contract).toContain('.hopi/docs/goals/maintain-repo-health/design.md')
        expect(radar?.contract).toContain('.hopi/docs/goals/maintain-repo-health/events.jsonl')
        expect(radar?.contract).not.toContain('.hopi/docs/tech-debt.md')
        expect(radar?.contract).toContain('TODO/FIXME')
    })

    it('runs known-project ticks for projects seeded from persisted state', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar-seeded'
        const goalId = 'goal-radar-seeded'
        const project = store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Maintain repo health',
            status: 'active',
            autopilotEnabled: true
        })

        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.seedKnownProjects([project])
        scheduler.requestKnownProjectTicks({ delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'radar'))
    })

    it('does not auto-run gsd tasks outside execute_ready phase', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd-discuss'
        const taskId = 'task-gsd-discuss'
        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'gsd',
            workflowPhase: 'discuss',
            automationReadinessStatus: 'ready'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })
        await delay(120)

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(false)
    })

    it('auto-run attempts gsd execute_ready tasks', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd-execute'
        const taskId = 'task-gsd-execute'
        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'gsd',
            workflowPhase: 'execute_ready',
            automationReadinessStatus: 'ready'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.initRuntime).toMatchObject({
            status: 'waiting',
            failure: {
                code: 'runner_offline',
                retry: {
                    action: 'wait_then_retry_start',
                    available: true
                }
            }
        })
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('does not auto-run regular tasks before project readiness is ready', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-readiness-gate'
        const taskId = 'task-readiness-gate'
        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'default',
            workflowPhase: null,
            automationReadinessStatus: 'unknown'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })
        await delay(120)

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(false)
    })

    it('auto-runs goal generator tasks before project readiness is ready', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-readiness'
        const goalId = 'goal-generator-readiness'
        const taskId = 'task-generator-readiness'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'unknown'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autonomous goal',
            status: 'active',
            autopilotEnabled: false
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement first slice',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('materializes and starts ready todo.yml-only tasks for an enabled goal', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-todo-only-auto-run'
        const goalId = 'goal-todo-only-auto-run'
        const workspaceId = 'workspace-todo-only-auto-run'
        const taskId = 'todo-only-ready-task'
        const sessionId = 'session-todo-only-ready-task'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-todo-only-auto-run-'))

        const project = store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationLaneLimits: {
                generator: 1,
                planner: 0,
                evaluator: 0,
                radar: 0
            },
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey: 'todo-only-auto-run',
            title: 'Todo only auto-run',
            status: 'active',
            autopilotEnabled: true
        })
        upsertGoalTodoTaskState({
            project,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            title: 'Implement todo-only work',
            body: 'This task exists only in todo.yml before the scheduler sees it.'
        })
        store.sessions.getOrCreateSession(
            sessionId,
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnCount = 0
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(lookupSessionId: string) {
                if (lookupSessionId !== sessionId) return undefined
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, path: workspacePath, hopiTaskRole: 'generator' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        expect(spawnCount).toBe(1)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toMatchObject({
            goalTodoRef: taskId,
            title: 'Implement todo-only work',
            description: 'This task exists only in todo.yml before the scheduler sees it.',
            activeSessionId: sessionId
        })
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === taskId)).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('starts a queued review while the generator lane is occupied', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-review-reserved-slot'
        const goalId = 'goal-review-reserved-slot'
        const workspaceId = 'workspace-review-reserved-slot'
        const reviewTaskId = 'task-ready-for-review'
        const previousSessionId = 'session-generator-done'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autonomous goal',
            status: 'active',
            autopilotEnabled: false
        })
        store.tasks.createTask({
            id: 'task-still-running',
            projectId,
            goalId,
            title: 'Still running',
            status: 'running',
            source: 'manual',
            activeSessionId: 'session-still-running',
            workflowProfile: 'default',
            workflowPhase: null
        })
        store.tasks.createTask({
            id: reviewTaskId,
            projectId,
            goalId,
            title: 'Ready for review',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const realtimeEvents: SyncEvent[] = []
        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return [
                    {
                        id: 'session-still-running',
                        namespace,
                        active: true,
                        thinking: true,
                        metadata: { projectId, taskId: 'task-still-running', path: '/tmp/workspace', hopiTaskRole: 'generator' }
                    }
                ]
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId === previousSessionId) {
                    return {
                        id: previousSessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, taskId: reviewTaskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: '/tmp/workspace' }
                    }
                }
                return undefined
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: evaluatorSession.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await delay(150)

        expect(spawnCount).toBe(1)
        expect(store.tasks.getTaskByNamespace(reviewTaskId, namespace)?.source).toBe('evaluator')
        expect(store.sessions.getSessionByNamespace(evaluatorSession.id, namespace)?.metadata).toMatchObject({
            taskId: reviewTaskId,
            hopiTaskRole: 'evaluator'
        })
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === reviewTaskId)).toBe(true)
    })

    it('continues blocked-goal review tasks into evaluator runs for the current batch', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-blocked-goal-review-continue'
        const goalId = 'goal-blocked-review-continue'
        const workspaceId = 'workspace-blocked-goal-review-continue'
        const reviewTaskId = 'task-blocked-goal-review-continue'
        const previousSessionId = 'session-generator-done-blocked-goal'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Blocked goal',
            status: 'blocked',
            autopilotEnabled: true,
            currentFocus: 'Awaiting milestone review.'
        })
        store.tasks.createTask({
            id: reviewTaskId,
            projectId,
            goalId,
            title: 'Review should still drain',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator-blocked-goal',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId === previousSessionId) {
                    return {
                        id: previousSessionId,
                        namespace,
                        active: false,
                        thinking: false,
                        metadata: { projectId, taskId: reviewTaskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: '/tmp/workspace' }
                    }
                }
                return undefined
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: evaluatorSession.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(reviewTaskId, namespace)?.source === 'evaluator')

        expect(spawnCount).toBe(1)
        expect(store.tasks.getTaskByNamespace(reviewTaskId, namespace)?.status).toBe('review')
        expect(store.sessions.getSessionByNamespace(evaluatorSession.id, namespace)?.metadata).toMatchObject({
            taskId: reviewTaskId,
            hopiTaskRole: 'evaluator'
        })
    })

    it('starts at most three generator tasks by default', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-default-generator-lane-limit'
        const goalId = 'goal-default-generator-lane-limit'
        const workspaceId = 'workspace-default-generator-lane-limit'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 5,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autonomous goal',
            status: 'active',
            autopilotEnabled: false
        })

        for (let index = 1; index <= 4; index += 1) {
            store.tasks.createTask({
                id: `task-generator-${index}`,
                projectId,
                goalId,
                title: `Generator task ${index}`,
                status: 'planning',
                source: 'manual',
                workflowProfile: 'default',
                workflowPhase: null
            })
            store.sessions.getOrCreateSession(
                `session-generator-${index}`,
                { path: '/tmp/workspace', host: 'localhost' },
                null,
                namespace
            )
        }

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                const match = /^session-generator-(\d+)$/.exec(sessionId)
                if (!match) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, path: '/tmp/workspace' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: `session-generator-${spawnCount}`
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await delay(150)

        expect(spawnCount).toBe(3)
        const started = store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            .filter((task) => task.status === 'running')
        expect(started).toHaveLength(3)
        expect(store.tasks.getTaskByNamespace('task-generator-4', namespace)?.status).toBe('planning')
    })

    it('uses a custom evaluator lane limit to pause review starts', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-evaluator-lane-paused'
        const goalId = 'goal-evaluator-lane-paused'
        const workspaceId = 'workspace-evaluator-lane-paused'
        const reviewTaskId = 'task-review-paused'
        const previousSessionId = 'session-generator-done-paused'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 5,
            defaultWorkspaceId: workspaceId,
            automationLaneLimits: { evaluator: 0 },
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autonomous goal',
            status: 'active',
            autopilotEnabled: false
        })
        store.tasks.createTask({
            id: reviewTaskId,
            projectId,
            goalId,
            title: 'Review should wait',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator-paused',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId === previousSessionId) {
                    return {
                        id: previousSessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, taskId: reviewTaskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: '/tmp/workspace' }
                    }
                }
                return undefined
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: evaluatorSession.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await delay(150)

        expect(spawnCount).toBe(0)
        expect(store.tasks.getTaskByNamespace(reviewTaskId, namespace)?.status).toBe('review')
        expect(store.tasks.getTaskByNamespace(reviewTaskId, namespace)?.source).toBe('manual')
    })

    it('still auto-runs project_init tasks when project auto-run is off and readiness is not ready', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-bootstrap'
        const taskId = 'task-init-bootstrap'
        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'default',
            workflowPhase: null,
            source: 'project_init',
            autoRunEnabled: false,
            automationReadinessStatus: 'unknown'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.initRuntime).toMatchObject({
            status: 'waiting',
            failure: {
                code: 'runner_offline',
                retry: {
                    action: 'wait_then_retry_start',
                    available: true
                }
            }
        })
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('retries legacy scheduler runner-offline blocks when runner is ready', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-legacy-runner-block'
        const taskId = 'task-init-legacy-runner-block'
        const spawned = store.sessions.getOrCreateSession(
            'session-legacy-runner-block',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'default',
            workflowPhase: null,
            source: 'project_init',
            autoRunEnabled: false,
            automationReadinessStatus: 'unknown'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler'
        })

        let spawnCount = 0
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, taskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: spawned.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(DEFAULT_VALID_ACTIONS_MANIFEST)
                }
            },
            async runBash() {
                return { success: true, stdout: 'setup ok', stderr: '' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.activeSessionId).toBe(spawned.id)
        expect(task?.blockedReason).toBeNull()
        expect(task?.blockedSource).toBeNull()
        expect(task?.initRuntime?.status).toBe('succeeded')
        expect(spawnCount).toBe(1)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('blocks planned tasks when session startup throws unexpectedly', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-start-throws'
        const taskId = 'task-start-throws'
        const workspaceId = 'workspace-start-throws'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workflowProfile: 'default'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                throw new Error('RPC socket disconnected: spawn failed')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('blocked')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
        const toastEvent = realtimeEvents.find((event) => event.type === 'toast')
        expect(toastEvent?.type === 'toast' ? toastEvent.data.taskStartFailure?.code : null).toBe('unexpected_error')
    })

    it('auto-run retries planned tasks with an inactive previous session link', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-requeue-inactive-session'
        const taskId = 'task-requeue-inactive-session'
        const previousSessionId = 'session-old'

        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'default',
            workflowPhase: null,
            activeSessionId: previousSessionId,
            automationReadinessStatus: 'ready'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== previousSessionId) {
                    return undefined
                }
                return {
                    id: previousSessionId,
                    namespace,
                    active: false,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.initRuntime).toMatchObject({
            status: 'waiting',
            failure: {
                code: 'runner_offline',
                retry: {
                    action: 'wait_then_retry_start',
                    available: true
                }
            }
        })
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('retries a planned task after its linked session becomes inactive', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-session-ended-requeue'
        const taskId = 'task-session-ended-requeue'
        const sessionId = 'session-linked'

        createProjectWithTask(store, {
            namespace,
            projectId,
            taskId,
            workflowProfile: 'default',
            workflowPhase: null,
            activeSessionId: sessionId,
            automationReadinessStatus: 'ready'
        })

        const realtimeEvents: SyncEvent[] = []
        let sessionActive = true
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSession(sessionLookupId: string) {
                if (sessionLookupId !== sessionId) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: sessionActive,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getSessionByNamespace(sessionLookupId: string) {
                if (sessionLookupId !== sessionId) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: sessionActive,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.handleEvent({ type: 'session-added', sessionId })

        sessionActive = false
        scheduler.handleEvent({ type: 'session-updated', sessionId })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.initRuntime).toMatchObject({
            status: 'waiting',
            failure: {
                code: 'runner_offline',
                retry: {
                    action: 'wait_then_retry_start',
                    available: true
                }
            }
        })
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('waits for runner recovery without retrying until the machine comes back', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-runner-recovery-wait'
        const taskId = 'task-runner-recovery-wait'
        const workspaceId = 'workspace-runner-recovery-wait'
        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-runner-recovery-wait',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workflowProfile: 'default'
        })

        const realtimeEvents: SyncEvent[] = []
        let runnerReady = false
        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, taskId, path: '/tmp/workspace', hopiTaskRole: 'generator' }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: runnerReady,
                    runnerState: { status: runnerReady ? 'running' : 'stopped' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: spawned.id
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(DEFAULT_VALID_ACTIONS_MANIFEST)
                }
            },
            async runBash() {
                return { success: true, stdout: 'setup ok', stderr: '' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const waitingTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(waitingTask?.status).toBe('planning')
        expect(waitingTask?.initRuntime?.failure?.code).toBe('runner_offline')
        expect(spawnCount).toBe(0)

        const toastCountBeforeRetryProbe = realtimeEvents.filter((event) => event.type === 'toast').length
        scheduler.handleEvent({
            type: 'task-updated',
            namespace,
            projectId,
            taskId,
            data: { taskId }
        })
        await delay(120)

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status).toBe('waiting')
        expect(spawnCount).toBe(0)
        expect(realtimeEvents.filter((event) => event.type === 'toast')).toHaveLength(toastCountBeforeRetryProbe)

        runnerReady = true
        scheduler.handleEvent({
            type: 'machine-updated',
            namespace,
            machineId: 'machine-1',
            data: { activeAt: Date.now() }
        })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const resumedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(resumedTask?.activeSessionId).toBe(spawned.id)
        expect(resumedTask?.initRuntime?.status).toBe('succeeded')
        expect(spawnCount).toBe(1)
    })

    it('reruns after a new planned task arrives during an active scheduler pass', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-pending-tick'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 2,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'ready'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'Task 1',
            status: 'planning',
            workflowProfile: 'default'
        })

        const spawned1 = store.sessions.getOrCreateSession(
            'spawned-session-1',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        const spawned2 = store.sessions.getOrCreateSession(
            'spawned-session-2',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const realtimeEvents: SyncEvent[] = []
        let spawnCount = 0
        let firstActivationResolved = false
        let resolveFirstActivation!: () => void
        const firstActivation = new Promise<void>((resolve) => {
            resolveFirstActivation = () => {
                firstActivationResolved = true
                resolve()
            }
        })

        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId === spawned1.id) {
                    return {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: '/tmp/workspace' }
                    }
                }
                if (sessionId === spawned2.id) {
                    return {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: '/tmp/workspace' }
                    }
                }
                return undefined
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: spawnCount === 1 ? spawned1.id : spawned2.id
                }
            },
            async waitForSessionActive(sessionId: string) {
                if (sessionId === spawned1.id && !firstActivationResolved) {
                    await firstActivation
                }
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => spawnCount === 1)

        store.tasks.createTask({
            id: 'task-2',
            projectId,
            title: 'Task 2',
            status: 'planning',
            workflowProfile: 'default'
        })
        scheduler.handleEvent({
            type: 'task-added',
            namespace,
            projectId,
            taskId: 'task-2',
            data: { taskId: 'task-2' }
        })

        await delay(350)
        expect(spawnCount).toBe(1)

        resolveFirstActivation()

        await waitFor(() => spawnCount === 2)

        const task2 = store.tasks.getTaskByNamespace('task-2', namespace)
        expect(task2?.status).toBe('running')
        expect(task2?.activeSessionId).toBe(spawned2.id)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })
})
