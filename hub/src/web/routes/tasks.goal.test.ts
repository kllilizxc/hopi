import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createGoalsRoutes } from './goals'
import { createTasksRoutes } from './tasks'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-tasks-goal-'))
    tempDirs.push(path)
    return path
}

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

function seedWorkspace(store: Store, projectId: string): string {
    const workspacePath = createTempWorkspace()
    store.workspaces.createWorkspace({
        id: `${projectId}-workspace`,
        projectId,
        path: workspacePath
    })
    return workspacePath
}

function seedGoal(store: Store, options: {
    id: string
    projectId: string
    namespace?: string
    goalKey?: string
    title?: string
}): void {
    store.goals.createGoal({
        id: options.id,
        projectId: options.projectId,
        namespace: options.namespace ?? 'default',
        goalKey: options.goalKey,
        title: options.title ?? options.id
    })
}

function seedGoalTodoTask(store: Store, options: {
    projectId: string
    goalId: string
    goalKey: string
    taskId: string
    status?: string
}): { workspacePath: string } {
    const workspacePath = createTempWorkspace()
    seedProject(store, options.projectId)
    store.workspaces.createWorkspace({
        id: `${options.projectId}-workspace`,
        projectId: options.projectId,
        path: workspacePath
    })
    seedGoal(store, {
        id: options.goalId,
        projectId: options.projectId,
        goalKey: options.goalKey,
        title: 'YAML Goal'
    })
    const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', options.goalKey)
    mkdirSync(goalDir, { recursive: true })
    const yamlStatus = options.status === 'running'
        ? 'in_progress'
        : options.status === 'review'
            ? 'in_review'
            : options.status === 'planning'
                ? 'planned'
                : options.status ?? 'planned'
    writeFileSync(join(goalDir, 'todo.yml'), [
        'version: 1',
        'goal:',
        `  goalKey: ${options.goalKey}`,
        `  goalId: ${options.goalId}`,
        '  title: YAML Goal',
        'items:',
        `  - ref: ${options.taskId}`,
        `    status: ${yamlStatus}`,
        '    title: YAML only task',
        '    body: Build this from the goal todo file.'
    ].join('\n'), 'utf8')
    return { workspacePath }
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

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('goal-scoped task routes', () => {
    it('creates, filters, and updates tasks scoped to project goals', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-tasks'
        const otherProjectId = 'project-other'
        seedProject(store, projectId)
        seedWorkspace(store, projectId)
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
        seedWorkspace(store, projectId)
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
        seedWorkspace(store, projectId)
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

    it('returns goal todo projected task details without materializing a DB task', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-task-read'
        const goalId = 'goal-yaml-task-read'
        const taskId = 'yaml-only-task-a1b2c3'
        seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-task-read',
            taskId,
            status: 'candidate'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; projectId: string; goalId: string | null; title: string; tag?: string | null }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            projectId,
            goalId,
            title: 'YAML only task',
            tag: 'candidate'
        })
        expect(store.tasks.getTaskByNamespace(taskId, 'default')).toBeNull()
    })

    it('projects task-scoped blocking decisions onto yaml-only goal todo tasks', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-task-decision'
        const goalId = 'goal-yaml-task-decision'
        const taskId = 'yaml-only-task-needs-choice'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-task-decision',
            taskId,
            status: 'candidate'
        })
        writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-task-decision', 'decisions.yml'), [
            'version: 1',
            'topics:',
            '  - id: topic-story-entry',
            `    projectId: ${projectId}`,
            `    goalId: ${goalId}`,
            '    scope: task',
            `    taskId: ${taskId}`,
            '    title: Choose story entry',
            '    body: Should this enter through MainMenu or a debug button?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 100',
            '    updatedAt: 100',
            ''
        ].join('\n'), 'utf8')

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: {
                id: string
                status: string
                tag?: string | null
                blockedReason?: string | null
                blockedSource?: string | null
            }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            status: 'blocked',
            tag: 'candidate',
            blockedReason: 'Choose story entry: Should this enter through MainMenu or a debug button?',
            blockedSource: 'decision'
        })
        expect(store.tasks.getTaskByNamespace(taskId, 'default')).toBeNull()
    })

    it('materializes a goal todo projected task when updating task state', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-task-write'
        const goalId = 'goal-yaml-task-write'
        const taskId = 'yaml-only-task-d4e5f6'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-task-write',
            taskId
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'blocked',
                blockedReason: 'Needs product decision'
            })
        })

        expect(response.status).toBe(200)
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored).toMatchObject({
            id: taskId,
            projectId,
            goalId,
            status: 'blocked',
            blockedReason: 'Needs product decision'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-task-write', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('tag:')
        expect(todo).toContain('summary: Needs product decision')
    })

    it('uses the existing DB task id for a linked goal todo item', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-task-overlay'
        const goalId = 'goal-yaml-task-overlay'
        const todoRef = 'linked-yaml-task-g7h8i9'
        const dbTaskId = 'stored-task-for-linked-yaml'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-task-overlay',
            taskId: todoRef
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stored linked task',
            status: 'running'
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)

        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as { tasks: Array<{ id: string; goalTodoRef: string | null }> }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef
        })

        const updateResponse = await app.request(`/api/tasks/${todoRef}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'done' })
        })

        expect(updateResponse.status).toBe(200)
        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.status).toBe('done')
        expect(store.tasks.getTaskByNamespace(todoRef, 'default')).toBeNull()
        expect(store.tasks
            .listTasksByProjectAndNamespace(projectId, 'default', { goalId })
            .filter((task) => task.goalTodoRef === todoRef)).toHaveLength(1)

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-task-overlay', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('status: done')
    })

    it('repairs linked goal todo state when an old preview runtime is blocked', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-preview-blocked'
        const goalId = 'goal-yaml-preview-blocked'
        const todoRef = 'preview-blocked-yaml-task'
        const dbTaskId = 'stored-preview-blocked-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-preview-blocked',
            taskId: todoRef,
            status: 'running'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Preview blocked task',
            status: 'running',
            previewRuntime: {
                status: 'blocked',
                sessionId: 'session-preview-blocked',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: 'preview-blocked',
                latestNote: 'Preview blocked.',
                blockedReason: 'Preview process exited with code 1'
            }
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)

        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; goalTodoRef: string | null; status: string; blockedReason: string | null }>
        }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'running',
            blockedReason: null
        })
        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.status).toBe('running')
        expect(stored?.blockedReason).toBeNull()
        expect(stored?.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-preview-blocked', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('status: in_progress')
        expect(todo).not.toContain('summary: Preview process exited with code 1')
    })

    it('uses goal todo status over stale DB task status for list and detail', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-authority'
        const goalId = 'goal-yaml-authority'
        const todoRef = 'todo-authority-task'
        seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-authority',
            taskId: todoRef,
            status: 'running'
        })
        store.tasks.createTask({
            id: 'stale-db-task',
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale DB task',
            status: 'blocked',
            blockedReason: 'Stale DB blocker'
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; status: string; blockedReason: string | null }>
        }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: 'stale-db-task',
            status: 'running',
            blockedReason: null
        })

        const detailResponse = await app.request('/api/tasks/stale-db-task')
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: 'stale-db-task',
            status: 'running',
            blockedReason: null
        })
    })

    it('projects goal todo dependencyTaskList into task dependency metadata', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-dependencies'
        const goalId = 'goal-yaml-dependencies'
        const workspacePath = createTempWorkspace()
        seedProject(store, projectId)
        store.workspaces.createWorkspace({
            id: `${projectId}-workspace`,
            projectId,
            path: workspacePath
        })
        seedGoal(store, {
            id: goalId,
            projectId,
            goalKey: 'yaml-dependencies',
            title: 'Dependency Goal'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-dependencies')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            '  goalKey: yaml-dependencies',
            `  goalId: ${goalId}`,
            '  title: Dependency Goal',
            'items:',
            '  - ref: define-library',
            '    status: done',
            '    title: Define deck library ownership',
            '  - ref: integrate-flow',
            '    status: planned',
            '    title: Integrate expedition deck flow',
            '    dependencyTaskList:',
            '      - ref: define-library',
            '      - ref: missing-dependency',
            ''
        ].join('\n'), 'utf8')

        const app = createTestApp(store)
        const response = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            tasks: Array<{
                id: string
                goalTodoRef: string | null
                dependencyTaskList?: Array<{
                    ref: string
                    taskId: string | null
                    title: string | null
                    status: string | null
                }>
            }>
        }
        const task = body.tasks.find((candidate) => candidate.goalTodoRef === 'integrate-flow')
        expect(task?.dependencyTaskList).toEqual([
            {
                ref: 'define-library',
                taskId: 'define-library',
                title: 'Define deck library ownership',
                status: 'done'
            },
            {
                ref: 'missing-dependency',
                taskId: null,
                title: null,
                status: null
            }
        ])
    })

    it('backfills a legacy DB-only goal task into todo before projecting the board', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-backfill'
        const goalId = 'goal-yaml-backfill'
        const workspacePath = createTempWorkspace()
        seedProject(store, projectId)
        store.workspaces.createWorkspace({
            id: `${projectId}-workspace`,
            projectId,
            path: workspacePath
        })
        seedGoal(store, {
            id: goalId,
            projectId,
            goalKey: 'yaml-backfill',
            title: 'Backfill Goal'
        })
        store.tasks.createTask({
            id: 'legacy-db-only-task',
            projectId,
            goalId,
            title: 'Legacy DB task',
            description: 'Created before todo.yml became canonical.',
            status: 'planning'
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; goalTodoRef: string | null; status: string }>
        }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: 'legacy-db-only-task',
            goalTodoRef: 'legacy-db-only-task',
            status: 'planning'
        })
        const stored = store.tasks.getTaskByNamespace('legacy-db-only-task', 'default')
        expect(stored?.goalTodoRef).toBe('legacy-db-only-task')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-backfill', 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: legacy-db-only-task')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('title: Legacy DB task')
    })
})
