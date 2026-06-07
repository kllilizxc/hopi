import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { AutoRunScheduler } from './autoRunScheduler'
import { createGoalDecisionTopicInDocs, resolveGoalDecisionTopicInDocs } from './goals/goalDecisionStore'
import { upsertGoalTodoTaskState } from './goals/goalTodo'
import type { SyncEngine } from './syncEngine'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

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

function seedGoalTodoTask(store: Store, options: {
    namespace: string
    projectId: string
    goalId: string
    workspaceId: string
    taskId: string
    status: 'planning' | 'running' | 'review' | 'blocked' | 'done' | 'unknown'
    title: string
    tag?: string | null
}): void {
    const project = store.projects.getProjectByNamespace(options.projectId, options.namespace)
    const goal = store.goals.getGoalByNamespace(options.goalId, options.namespace)
    const workspace = store.workspaces.getWorkspace(options.workspaceId)
    if (!project || !goal || !workspace) {
        throw new Error('Unable to seed Goal todo task without project/goal/workspace')
    }
    upsertGoalTodoTaskState({
        project,
        goal,
        defaultWorkspace: workspace,
        taskId: options.taskId,
        status: options.status,
        tag: options.tag ?? null,
        title: options.title
    })
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
        path: mkdtempSync(join(tmpdir(), `hopi-${options.projectId}-`))
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
                return null
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

    it('does not request a scheduler tick for a legacy DB-only goal task without docs projection', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-legacy-db-only-goal-task-event'
        const goalId = 'goal-legacy-db-only-goal-task-event'
        const taskId = 'task-legacy-db-only-goal-task-event'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Legacy DB-only goal task',
            status: 'active',
            autopilotEnabled: false
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Legacy DB-only task',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const scheduler = new AutoRunScheduler(store, {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace() {
                return null
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine)

        scheduler.handleEvent({
            type: 'task-updated',
            namespace,
            projectId,
            taskId,
            data: { taskId }
        })

        expect((scheduler as unknown as { tickTimers: Map<string, unknown> }).tickTimers.size).toBe(0)
    })

    it('does not request a scheduler tick for a legacy DB-only goal task when autopilot is enabled', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-legacy-db-only-goal-task-autopilot-event'
        const goalId = 'goal-legacy-db-only-goal-task-autopilot-event'
        const taskId = 'task-legacy-db-only-goal-task-autopilot-event'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Legacy DB-only autopilot goal task',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Legacy DB-only planner task',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })

        const scheduler = new AutoRunScheduler(store, {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace() {
                return null
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine)

        scheduler.handleEvent({
            type: 'task-added',
            namespace,
            projectId,
            taskId,
            data: { taskId }
        })

        expect((scheduler as unknown as { tickTimers: Map<string, unknown> }).tickTimers.size).toBe(0)
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
                return null
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
                return null
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
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-blocked-goal-planned-continue-'))

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
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: taskId,
            title: 'Finish current batch task',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId,
            status: 'planning',
            title: 'Finish current batch task',
            tag: 'ready'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-blocked-goal-planned-continue',
            { path: workspacePath, host: 'localhost' },
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
                    metadata: { projectId, taskId, path: workspacePath, hopiTaskRole: 'generator' }
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
        const workspaceId = 'workspace-goal-autopilot'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-autopilot-'))
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: taskId,
            title: 'Task',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId,
            status: 'planning',
            title: 'Task',
            tag: 'ready'
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource === 'scheduler')

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('auto-runs goal planner tasks when project auto-run is on even if goal autopilot is off', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-project-auto-run'
        const goalId = 'goal-manual-autopilot'
        const taskId = 'task-goal-planner-project-auto'
        const workspaceId = 'workspace-goal-planner-project-auto'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-planner-project-auto-'))
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: taskId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            workflowPhase: null
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId,
            status: 'planning',
            title: 'Clarify goal',
            tag: 'ready'
        })
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource === 'scheduler')

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('planning')
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
                return null
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
        expect(planner?.contract).toContain('Target open generator tasks: 3')
        expect(planner?.contract).toContain('Current open generator tasks: 0')
        expect(planner?.contract).toContain('If the milestone assessment says continuing is worthwhile, create up to 3 independent ready generator tasks')
        expect(planner?.contract).not.toContain('create a DecisionTopic proposing completion')
        expect(planner?.contract).toContain('Leave final Goal done/archive to explicit user actions')
        expect(planner?.contract).toContain('milestone review is allowed and should block the Goal')
        expect(planner?.contract).toContain('Do not mark the Goal paused, done, or archived just because the current iteration looks complete')
        expect(planner?.contract).not.toContain('operator/planner-mail.yml')
        expect(planner?.contract).not.toContain('legacy `goals[]` / `tag` shape')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
    })

    it('does not create a planner refill while ready generator work is waiting to start', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-ready-work'
        const goalId = 'goal-ready-work'
        const taskId = 'ready-generator-task'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 3,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-ready-work',
            projectId,
            path: mkdtempSync(join(tmpdir(), 'hopi-ready-work-'))
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Respect small ready batches',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Ready generator work',
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
            tag: 'ready',
            title: 'Ready generator work'
        })

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId, path: workspace.path }
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
                    sessionId: `session-ready-generator-${spawnCount}`
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

        const planners = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .filter((task) => task.source === 'planner')
        expect(planners).toHaveLength(0)
        expect(spawnCount).toBeGreaterThan(0)
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
            goalKey: 'candidate-backlog-goal',
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
                return null
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
        const todo = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'candidate-backlog-goal', 'todo.yml'),
            'utf8'
        )
        expect(todo).toContain(`ref: ${planner?.id}`)
        expect(todo).toContain('kind: planning')
        expect(todo).toContain('title: Plan next goal iteration')
        const eventLog = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'candidate-backlog-goal', 'events.jsonl'),
            'utf8'
        )
        expect(eventLog).toContain('scheduler_planner_seeded')
        expect(eventLog).toContain(`"taskId":"${planner?.id}"`)
    })

    it('carries recent resolved decision answers into generated planner loop tasks', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-decision-handoff'
        const goalId = 'goal-decision-handoff'
        const workspaceId = 'workspace-goal-decision-handoff'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-decision-handoff-'))
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 0,
            automationReadinessStatus: 'unknown',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            label: 'Workspace',
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating with human answer',
            status: 'active',
            autopilotEnabled: true
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'keep-iterating-with-human-answer')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            'goalKey: keep-iterating-with-human-answer',
            'title: "Keep iterating with human answer"',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Keep iterating with human answer',
            '',
            '## Objective',
            '',
            'Continue after the latest human answer.',
            ''
        ].join('\n'))
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
        createGoalDecisionTopicInDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace(workspaceId),
            id: 'topic-main-menu-entry',
            taskId: 'finished-planner-task',
            title: 'Choose story entry',
            body: 'Should story content enter from MainMenu or a debug-only button?',
            blocking: true,
            writer: 'test',
            reason: 'Seed a resolved decision topic for scheduler handoff coverage.'
        })
        resolveGoalDecisionTopicInDocs({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal: store.goals.getGoalByNamespace(goalId, namespace)!,
            defaultWorkspace: store.workspaces.getWorkspace(workspaceId),
            topicId: 'topic-main-menu-entry',
            resolution: 'Use MainMenu as the player-facing entry.',
            writer: 'test',
            reason: 'Resolve the seeded decision topic for scheduler handoff coverage.'
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
        expect(planner?.contract).toContain('## Milestone Stop Assessment')
        expect(planner?.contract).toContain('create exactly one blocking goal-level DecisionTopic with taskId null')
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
        const workspaceId = 'workspace-goal-planner-backstop'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-planner-backstop-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationBackstopPolicy: {
                maxHoursWithoutMilestone: 0,
                maxGeneratorTasksWithoutMilestone: 1,
                maxPlannerRefillsWithoutMilestone: 0
            },
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: 'finished-generator-task',
            title: 'Completed generator work',
            status: 'done',
            source: 'manual'
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId: 'finished-generator-task',
            status: 'done',
            title: 'Completed generator work'
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
        const workspaceId = 'workspace-goal-planner-reactivated'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-planner-reactivated-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Keep iterating after a human answer',
            status: 'active',
            autopilotEnabled: true
        })
        store.sessions.getOrCreateSession(
            sessionId,
            { path: workspacePath, host: 'localhost', projectId, taskId, hopiTaskRole: 'planner' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
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
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId,
            status: 'planning',
            title: 'Plan next goal iteration',
            tag: 'ready'
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
                    metadata: { projectId, taskId, path: workspacePath, hopiTaskRole: 'planner' }
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
                    metadata: { projectId, taskId, path: workspacePath, hopiTaskRole: 'planner' }
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

        expect(kickoffSessionId).toBe(sessionId)
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('Resolved DecisionTopic: Choose next slice')
        expect(kickoffText).toContain('Use MainMenu as the player-facing entry.')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)
    })

    it('requests a planner tick when a finished docs-backed goal task leaves the board running low', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-finished-low-water'
        const goalId = 'goal-finished-low-water'
        const goalKey = 'goal-finished-low-water'
        const workspaceId = 'workspace-goal-finished-low-water'
        const taskId = 'task-finished-work'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-finished-low-water-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
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
            title: 'Keep iterating after work finishes',
            status: 'active',
            autopilotEnabled: true
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId,
            workspaceId,
            taskId,
            status: 'done',
            title: 'Finished implementation task'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
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
                return null
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
        expect(planner?.contract).not.toContain('operator/planner-mail.yml')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
    })

    it('does not create a planner tick while goal work is already active', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-active-work'
        const goalId = 'goal-active-work'
        const workspaceId = 'workspace-goal-active-work'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-active-work-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: 'task-active-review',
            title: 'Active review work',
            status: 'review',
            source: 'evaluator',
            workflowProfile: 'default',
            workflowPhase: null
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId: 'task-active-review',
            status: 'review',
            title: 'Active review work'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
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
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-goal-radar',
            projectId,
            path: mkdtempSync(join(tmpdir(), 'hopi-goal-radar-'))
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Maintain repo health',
            status: 'active',
            autopilotEnabled: true
        })
        const goalDir = join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goal.goalKey}`,
            'title: "Maintain repo health"',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Maintain repo health',
            '',
            '## Objective',
            '',
            'Keep docs and technical debt visible.',
            ''
        ].join('\n'))

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
        expect(radar?.contract).toContain('.hopi/docs/tech-debt.md')
        expect(radar?.contract).toContain('TODO/FIXME')
        const todo = readFileSync(join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${radar?.id}`)
        expect(todo).toContain('kind: planning')
        expect(todo).toContain('Radar: scan goal docs and technical debt')
        const eventLog = readFileSync(join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('scheduler_radar_seeded')
        expect(eventLog).toContain(`"taskId":"${radar?.id}"`)
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
                return null
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
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('Machine not found')
        expect(task?.initRuntime).toBeNull()
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
                return null
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
        const workspaceId = 'workspace-goal-generator-readiness'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-generator-readiness-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            defaultWorkspaceId: workspaceId,
            automationReadinessStatus: 'unknown'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        const goal = store.goals.createGoal({
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
            goalTodoRef: taskId,
            title: 'Implement first slice',
            status: 'planning',
            source: 'manual',
            workflowProfile: 'default',
            workflowPhase: null
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId: goal.id,
            workspaceId,
            taskId,
            status: 'planning',
            title: 'Implement first slice',
            tag: 'ready'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource === 'scheduler')

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('planning')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('starts a queued review while the generator lane is occupied', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-review-reserved-slot'
        const goalId = 'goal-review-reserved-slot'
        const workspaceId = 'workspace-review-reserved-slot'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-review-reserved-slot-'))
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
            path: workspacePath
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
            goalTodoRef: 'task-still-running',
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
            goalTodoRef: reviewTaskId,
            title: 'Ready for review',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId,
            workspaceId,
            taskId: 'task-still-running',
            status: 'running',
            title: 'Still running'
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId,
            workspaceId,
            taskId: reviewTaskId,
            status: 'review',
            title: 'Ready for review'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator',
            { path: workspacePath, host: 'localhost' },
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
                        metadata: { projectId, taskId: 'task-still-running', path: workspacePath, hopiTaskRole: 'generator' }
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
                        metadata: { projectId, taskId: reviewTaskId, path: workspacePath, hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: workspacePath }
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
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-blocked-goal-review-continue-'))
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
            path: workspacePath
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
            goalTodoRef: reviewTaskId,
            title: 'Review should still drain',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId,
            workspaceId,
            taskId: reviewTaskId,
            status: 'review',
            title: 'Review should still drain'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator-blocked-goal',
            { path: workspacePath, host: 'localhost' },
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
                        metadata: { projectId, taskId: reviewTaskId, path: workspacePath, hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: workspacePath }
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
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-default-generator-lane-limit-'))

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
            path: workspacePath
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
                goalTodoRef: `task-generator-${index}`,
                title: `Generator task ${index}`,
                status: 'planning',
                source: 'manual',
                workflowProfile: 'default',
                workflowPhase: null
            })
            seedGoalTodoTask(store, {
                namespace,
                projectId,
                goalId,
                workspaceId,
                taskId: `task-generator-${index}`,
                status: 'planning',
                title: `Generator task ${index}`,
                tag: 'ready'
            })
            store.sessions.getOrCreateSession(
                `session-generator-${index}`,
                { path: workspacePath, host: 'localhost' },
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
                    metadata: { projectId, path: workspacePath }
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
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-evaluator-lane-paused-'))
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
            path: workspacePath
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
            goalTodoRef: reviewTaskId,
            title: 'Review should wait',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSessionId,
            workflowProfile: 'default',
            workflowPhase: null,
            handoff: 'Ready for evaluator.'
        })
        seedGoalTodoTask(store, {
            namespace,
            projectId,
            goalId,
            workspaceId,
            taskId: reviewTaskId,
            status: 'review',
            title: 'Review should wait'
        })

        const evaluatorSession = store.sessions.getOrCreateSession(
            'session-evaluator-paused',
            { path: workspacePath, host: 'localhost' },
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
                        metadata: { projectId, taskId: reviewTaskId, path: workspacePath, hopiTaskRole: 'generator' }
                    }
                }
                if (sessionId === evaluatorSession.id) {
                    return {
                        id: evaluatorSession.id,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: { projectId, path: workspacePath }
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

    it('still auto-runs project_init tasks before project readiness is ready', async () => {
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
            automationReadinessStatus: 'unknown'
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getMachineByNamespace() {
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('Machine not found')
        expect(task?.initRuntime).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
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
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('Machine not found')
        expect(task?.initRuntime).toBeNull()
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
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.handleEvent({ type: 'session-added', sessionId })

        sessionActive = false
        scheduler.handleEvent({ type: 'session-updated', sessionId })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('Machine not found')
        expect(task?.initRuntime).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
    })

    it('waits for runner recovery without retrying until the machine comes back', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-runner-recovery-wait'
        const taskId = 'task-runner-recovery-wait'
        const workspaceId = 'workspace-runner-recovery-wait'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-runner-recovery-wait-'))
        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-runner-recovery-wait',
            { path: workspacePath, host: 'localhost' },
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
            path: workspacePath
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
                    metadata: { projectId, taskId, path: workspacePath, hopiTaskRole: 'generator' }
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
        expect(waitingTask?.blockedSource).toBe('scheduler')
        expect(waitingTask?.blockedReason).toBe('Runner offline or not connected. Start it on the machine and try again: hopi runner start')
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
        expect(resumedTask?.initRuntime?.status).not.toBe('waiting')
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
