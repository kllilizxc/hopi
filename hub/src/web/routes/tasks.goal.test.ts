import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createGoalsRoutes } from './goals'
import { createTasksRoutes } from './tasks'

function createTestApp(store: Store): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createGoalsRoutes({ store, getSyncEngine: () => null }))
    app.route('/api', createTasksRoutes({ store, getSyncEngine: () => null }))
    return app
}

function seedProject(store: Store, id: string, namespace = 'default'): void {
    store.projects.createProject({
        id,
        namespace,
        machineId: 'machine-1',
        name: id
    })
}

function seedGoal(store: Store, options: {
    id: string
    projectId: string
    namespace?: string
    title?: string
}): void {
    store.goals.createGoal({
        id: options.id,
        projectId: options.projectId,
        namespace: options.namespace ?? 'default',
        title: options.title ?? options.id
    })
}

async function createTask(app: Hono, projectId: string, body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            title: 'Task',
            workflowProfile: 'default',
            ...body
        })
    })
}

describe('goal-scoped task routes', () => {
    it('creates, filters, and updates tasks scoped to project goals', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-tasks'
        const otherProjectId = 'project-other'
        seedProject(store, projectId)
        seedProject(store, otherProjectId)
        seedProject(store, 'project-other-namespace', 'other')
        seedGoal(store, { id: 'goal-a', projectId, title: 'Goal A' })
        seedGoal(store, { id: 'goal-b', projectId, title: 'Goal B' })
        seedGoal(store, { id: 'goal-other-project', projectId: otherProjectId })
        seedGoal(store, { id: 'goal-other-namespace', projectId: 'project-other-namespace', namespace: 'other' })

        const app = createTestApp(store)

        const firstResponse = await createTask(app, projectId, {
            title: 'Task A',
            goalId: 'goal-a',
            contract: 'Build the goal A contract.'
        })
        expect(firstResponse.status).toBe(200)
        const firstBody = await firstResponse.json() as { task: { id: string; goalId: string | null; contract: string | null } }
        expect(firstBody.task.goalId).toBe('goal-a')
        expect(firstBody.task.contract).toBe('Build the goal A contract.')

        const secondResponse = await createTask(app, projectId, {
            title: 'Task B',
            goalId: 'goal-b'
        })
        expect(secondResponse.status).toBe(200)
        const secondBody = await secondResponse.json() as { task: { id: string; goalId: string | null } }
        expect(secondBody.task.goalId).toBe('goal-b')

        const filteredResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=goal-a`)
        expect(filteredResponse.status).toBe(200)
        const filteredBody = await filteredResponse.json() as {
            tasks: Array<{ id: string; goalId: string | null; contract: string | null }>
        }
        expect(filteredBody.tasks).toHaveLength(1)
        expect(filteredBody.tasks[0]?.id).toBe(firstBody.task.id)
        expect(filteredBody.tasks[0]?.goalId).toBe('goal-a')
        expect(filteredBody.tasks[0]?.contract).toBe('Build the goal A contract.')

        const unfilteredResponse = await app.request(`/api/projects/${projectId}/tasks`)
        expect(unfilteredResponse.status).toBe(200)
        const unfilteredBody = await unfilteredResponse.json() as { tasks: Array<{ id: string }> }
        expect(unfilteredBody.tasks.map(task => task.id).sort()).toEqual([
            firstBody.task.id,
            secondBody.task.id
        ].sort())

        const invalidCreateResponse = await createTask(app, projectId, {
            title: 'Invalid task',
            goalId: 'goal-other-project'
        })
        expect(invalidCreateResponse.status).toBe(404)
        expect(await invalidCreateResponse.json()).toEqual({ error: 'Goal not found' })

        const invalidNamespaceCreateResponse = await createTask(app, projectId, {
            title: 'Invalid namespace task',
            goalId: 'goal-other-namespace'
        })
        expect(invalidNamespaceCreateResponse.status).toBe(404)
        expect(await invalidNamespaceCreateResponse.json()).toEqual({ error: 'Goal not found' })

        const updateResponse = await app.request(`/api/tasks/${firstBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                goalId: 'goal-b',
                handoff: 'Ready for goal B.',
                evidence: 'Verified by route test.'
            })
        })
        expect(updateResponse.status).toBe(200)
        const updateBody = await updateResponse.json() as {
            task: { goalId: string | null; handoff: string | null; evidence: string | null }
        }
        expect(updateBody.task.goalId).toBe('goal-b')
        expect(updateBody.task.handoff).toBe('Ready for goal B.')
        expect(updateBody.task.evidence).toBe('Verified by route test.')

        const unlinkResponse = await app.request(`/api/tasks/${firstBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: null })
        })
        expect(unlinkResponse.status).toBe(200)
        const unlinkBody = await unlinkResponse.json() as { task: { goalId: string | null } }
        expect(unlinkBody.task.goalId).toBeNull()

        const invalidUpdateResponse = await app.request(`/api/tasks/${firstBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-other-project' })
        })
        expect(invalidUpdateResponse.status).toBe(404)
        expect(await invalidUpdateResponse.json()).toEqual({ error: 'Goal not found' })
    })

    it('allows planner and evaluator sources for agent-created goal tasks', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-task-source'
        seedProject(store, projectId)
        seedGoal(store, { id: 'goal-source', projectId })

        const app = createTestApp(store)
        const plannerResponse = await createTask(app, projectId, {
            title: 'Planner-created task',
            goalId: 'goal-source',
            source: 'planner'
        })

        expect(plannerResponse.status).toBe(200)
        const plannerBody = await plannerResponse.json() as { task: { id: string; source: string | null } }
        expect(plannerBody.task.source).toBe('planner')

        const updateResponse = await app.request(`/api/tasks/${plannerBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: 'evaluator' })
        })

        expect(updateResponse.status).toBe(200)
        const updateBody = await updateResponse.json() as { task: { source: string | null } }
        expect(updateBody.task.source).toBe('evaluator')
    })

    it('rejects empty goalId query instead of returning unfiltered tasks', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-empty-goal-query'
        seedProject(store, projectId)

        const app = createTestApp(store)
        const taskResponse = await createTask(app, projectId, { title: 'Task A' })
        expect(taskResponse.status).toBe(200)

        const response = await app.request(`/api/projects/${projectId}/tasks?goalId=`)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid query' })
    })

    it('rejects malformed includeArchived query when goalId is valid', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-invalid-include-archived'
        seedProject(store, projectId)
        seedGoal(store, { id: 'goal-valid', projectId })

        const app = createTestApp(store)
        const scopedResponse = await createTask(app, projectId, {
            title: 'Scoped task',
            goalId: 'goal-valid'
        })
        expect(scopedResponse.status).toBe(200)
        const unscopedResponse = await createTask(app, projectId, { title: 'Unscoped task' })
        expect(unscopedResponse.status).toBe(200)

        const response = await app.request(`/api/projects/${projectId}/tasks?goalId=goal-valid&includeArchived=maybe`)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid query' })
    })
})
