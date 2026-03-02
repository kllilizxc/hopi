import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function seedMergeTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    sessionId: string
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Merge Project',
        defaultSessionType: 'worktree',
        worktreeTargetBranch: 'main'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: 'in_review',
        activeSessionId: options.sessionId
    })
}

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createTasksRoutes({
        store,
        getSyncEngine: () => engine
    }))
    return app
}

describe('tasks merge route unexpected errors', () => {
    it('returns thrown error message for unexpected merge failures', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-message'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-message',
            taskId,
            sessionId: 'session-merge-message'
        })

        const engine = {
            resolveSessionAccess() {
                throw new Error('simulated merge crash')
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('simulated merge crash')
    })

    it('uses fallback message when thrown value has no readable message', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-fallback'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-fallback',
            taskId,
            sessionId: 'session-merge-fallback'
        })

        const engine = {
            resolveSessionAccess() {
                throw null
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('Merge failed unexpectedly')
    })
})
