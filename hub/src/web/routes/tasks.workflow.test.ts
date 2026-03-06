import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createTasksRoutes } from './tasks'

function createTestApp(store: Store): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createTasksRoutes({
        store,
        getSyncEngine: () => null
    }))
    return app
}

describe('tasks workflow strategy routes', () => {
    it('defaults new task workflow phase from task strategy', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-gsd'
        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'GSD Project',
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Task 1', workflowProfile: 'gsd' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { task?: { workflowPhase?: string | null } }
        expect(body.task?.workflowPhase).toBe('discuss')
    })

    it('applies strategy patch when task moves to finished', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-gsd-finish'
        const taskId = 'task-gsd-finish'

        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'GSD Project',
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_review',
            workflowProfile: 'gsd',
            workflowPhase: 'verify'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'finished' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { task?: { status?: string; workflowPhase?: string | null } }
        expect(body.task?.status).toBe('finished')
        expect(body.task?.workflowPhase).toBe('done')
    })
})
