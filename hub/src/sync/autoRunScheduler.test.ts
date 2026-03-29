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
    source?: string | null
    automationReadinessStatus?: 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Project',
        autoRunEnabled: true,
        maxRunningSessions: 1,
        automationReadinessStatus: options.automationReadinessStatus ?? 'unknown'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Task',
        status: 'planned',
        source: options.source ?? 'manual',
        workflowProfile: options.workflowProfile,
        workflowPhase: options.workflowPhase
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
})
