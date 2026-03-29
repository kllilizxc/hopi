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
    activeSessionId?: string | null
    workspaceId?: string | null
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Project',
        autoRunEnabled: true,
        maxRunningSessions: 1,
        defaultWorkspaceId: options.workspaceId ?? null
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Task',
        status: 'planned',
        workflowProfile: options.workflowProfile,
        workflowPhase: options.workflowPhase,
        activeSessionId: options.activeSessionId ?? null
    })
}

describe('AutoRunScheduler workflow strategy gate', () => {
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
            workflowPhase: 'discuss'
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
            workflowPhase: 'execute_ready'
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
            defaultWorkspaceId: workspaceId
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
            activeSessionId: previousSessionId
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
            activeSessionId: sessionId
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
            defaultWorkspaceId: workspaceId
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
