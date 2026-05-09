import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { AutoRunScheduler } from './autoRunScheduler'
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
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Project',
        autoRunEnabled: options.autoRunEnabled ?? true,
        maxRunningSessions: 1,
        defaultWorkspaceId: options.workspaceId ?? null,
        automationReadinessStatus: options.automationReadinessStatus ?? 'unknown'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        goalId: options.goalId ?? null,
        title: 'Task',
        status: 'planned',
        source: options.source ?? 'manual',
        workflowProfile: options.workflowProfile,
        workflowPhase: options.workflowPhase,
        activeSessionId: options.activeSessionId ?? null
    })
}

describe('AutoRunScheduler workflow strategy gate', () => {
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
            status: 'planned',
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
                return null
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
            status: 'planned',
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
                return null
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
                return null
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .some((task) => task.source === 'planner'))

        const planner = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .find((task) => task.source === 'planner')
        expect(planner?.title).toContain('Plan next')
        expect(planner?.permissionMode).toBe('safe-yolo')
        expect(planner?.contract).toContain('.hopi/docs/todo.md')
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
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
            status: 'finished',
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
        expect(realtimeEvents.some((event) => event.type === 'task-added' && event.taskId === planner?.id)).toBe(true)
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
        expect(radar?.permissionMode).toBe('safe-yolo')
        expect(radar?.contract).toContain('.hopi/docs/tech-debt.md')
        expect(radar?.contract).toContain('TODO/FIXME')
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
        expect(task?.status).toBe('planned')
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
        expect(task?.status).toBe('blocked')
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
        expect(task?.status).toBe('planned')
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
            status: 'planned',
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
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'blocked')

        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
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
        expect(task?.status).toBe('blocked')
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
            status: 'planned',
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
        expect(task?.status).toBe('blocked')
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
        expect(task?.status).toBe('blocked')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
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
            status: 'planned',
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
            status: 'planned',
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
        expect(task2?.status).toBe('in_progress')
        expect(task2?.activeSessionId).toBe(spawned2.id)
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })
})
