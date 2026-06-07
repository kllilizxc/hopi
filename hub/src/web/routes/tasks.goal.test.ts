import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@hopi/protocol/types'
import { Hono } from 'hono'
import { Store } from '../../store'
import { materializeGoalTodoTaskOverlayForWrite } from '../../sync/goals/goalTodoProjection'
import type { SyncEngine } from '../../sync/syncEngine'
import { createGoalsRoutes } from './goals'
import { createTasksRoutes } from './tasks'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-tasks-goal-'))
    tempDirs.push(path)
    return path
}

function createTestApp(store: Store, engine: SyncEngine | null = null): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createGoalsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/api', createTasksRoutes({ store, getSyncEngine: () => engine }))
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

function toCanonicalGoalTodoStatus(status?: string, tag?: string): string {
    if (tag === 'candidate' || tag === 'deferred') {
        return 'planned'
    }
    switch (status) {
        case 'running':
        case 'in_progress':
            return 'in_progress'
        case 'review':
        case 'in_review':
            return 'in_review'
        case 'merging':
            return 'merging'
        case 'done':
        case 'finished':
            return 'done'
        default:
            return 'planned'
    }
}

function seedGoalTodoTask(store: Store, options: {
    projectId: string
    goalId: string
    goalKey: string
    taskId: string
    status?: string
    tag?: string
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
    writeFileSync(join(goalDir, 'todo.yml'), [
        'version: 1',
        'goal:',
        `  goalKey: ${options.goalKey}`,
        `  goalId: ${options.goalId}`,
        '  title: YAML Goal',
        'items:',
        `  - ref: ${options.taskId}`,
        '    kind: engineering',
        `    status: ${toCanonicalGoalTodoStatus(options.status, options.tag)}`,
        ...(options.tag ? [`    tag: ${options.tag}`] : []),
        '    title: YAML only task',
        '    description: Build this from the goal todo file.'
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

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

async function waitForTaskPredicate(options: {
    store: Store
    taskId: string
    predicate: (task: ReturnType<Store['tasks']['getTaskByNamespace']>) => boolean
    timeoutMs?: number
}): Promise<ReturnType<Store['tasks']['getTaskByNamespace']>> {
    const timeoutMs = options.timeoutMs ?? 5_000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
        const task = options.store.tasks.getTaskByNamespace(options.taskId, 'default')
        if (options.predicate(task)) {
            return task
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error(`Timed out waiting for task ${options.taskId}`)
}

const VALID_ACTIONS_MANIFEST = [
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
        const workspacePath = seedWorkspace(store, projectId)
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
        const goalA = store.goals.getGoalByNamespace('goal-a', 'default')
        const goalB = store.goals.getGoalByNamespace('goal-b', 'default')
        const goalATodoAfterMove = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalA?.goalKey ?? 'goal-a', 'todo.yml'), 'utf8')
        const goalBTodoAfterMove = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalB?.goalKey ?? 'goal-b', 'todo.yml'), 'utf8')
        expect(goalATodoAfterMove).not.toContain(`ref: ${firstBody.task.id}`)
        expect(goalBTodoAfterMove).toContain(`ref: ${firstBody.task.id}`)
        const goalAEvents = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalA?.goalKey ?? 'goal-a', 'events.jsonl'), 'utf8')
        expect(goalAEvents).toContain('todo_item_removed_from_tasks_api')

        const unlinkResponse = await app.request(`/api/tasks/${firstBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: null })
        })
        expect(unlinkResponse.status).toBe(200)
        const unlinkBody = await unlinkResponse.json() as { task: { goalId: string | null } }
        expect(unlinkBody.task.goalId).toBeNull()
        const goalBTodoAfterUnlink = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalB?.goalKey ?? 'goal-b', 'todo.yml'), 'utf8')
        expect(goalBTodoAfterUnlink).not.toContain(`ref: ${firstBody.task.id}`)

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

    it('returns explicit canonical goal status on docs-projected task responses', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-canonical-status'
        seedProject(store, projectId)
        seedWorkspace(store, projectId)
        seedGoal(store, { id: 'goal-a', projectId, title: 'Goal A' })

        const app = createTestApp(store)

        const createResponse = await createTask(app, projectId, {
            title: 'Task A',
            goalId: 'goal-a'
        })
        expect(createResponse.status).toBe(200)
        const created = await createResponse.json() as {
            task: {
                id: string
                goalId: string | null
                goalCanonicalStatus?: string | null
                status: string
            }
        }
        expect(created.task.goalId).toBe('goal-a')
        expect(created.task.goalCanonicalStatus).toBe('planned')
        expect(created.task.status).toBe('planning')

        const detailResponse = await app.request(`/api/tasks/${created.task.id}`)
        expect(detailResponse.status).toBe(200)
        const detail = await detailResponse.json() as {
            task: {
                id: string
                goalCanonicalStatus?: string | null
                status: string
            }
        }
        expect(detail.task.id).toBe(created.task.id)
        expect(detail.task.goalCanonicalStatus).toBe('planned')
        expect(detail.task.status).toBe('planning')
    })

    it('writes goal-scoped task creation through todo docs and emits a docs-first event', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-create'
        const goalId = 'goal-docs-create'
        const goalKey = 'goal-docs-create'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Create Goal' })

        const app = createTestApp(store)
        const response = await createTask(app, projectId, {
            title: 'Route-created goal task',
            goalId,
            description: 'Create through the tasks API with todo first.'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; goalTodoRef: string | null; goalId: string | null }
        }
        expect(body.task.goalId).toBe(goalId)
        expect(body.task.goalTodoRef).toBe(body.task.id)

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${body.task.id}`)
        expect(todo).toContain('kind: engineering')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('title: Route-created goal task')

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('todo_item_created_from_tasks_api')
    })

    it('writes blockers for goal-scoped task creation without requiring blocked status', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-create-blocked-review'
        const goalId = 'goal-docs-create-blocked-review'
        const goalKey = 'goal-docs-create-blocked-review'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Create Blocked Review Goal' })

        const app = createTestApp(store)
        const response = await createTask(app, projectId, {
            title: 'Route-created blocked review task',
            goalId,
            status: 'review',
            blockedReason: 'Waiting for evaluator follow-up',
            blockedSource: 'evaluator'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; goalTodoRef: string | null; goalId: string | null; status: string; blockedReason: string | null }
        }
        expect(body.task).toMatchObject({
            goalId,
            goalTodoRef: body.task.id,
            status: 'review',
            blockedReason: 'Waiting for evaluator follow-up'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${body.task.id}`)
        expect(todo).toContain('status: in_review')
        expect(todo).toContain('blockedBy:')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Waiting for evaluator follow-up')

        const detailResponse = await app.request(`/api/tasks/${body.task.id}`)
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: body.task.id,
            status: 'review',
            blockedReason: 'Waiting for evaluator follow-up'
        })

        const stored = store.tasks.getTaskByNamespace(body.task.id, 'default')
        expect(stored).toMatchObject({
            status: 'review',
            blockedReason: 'Waiting for evaluator follow-up',
            blockedSource: 'evaluator'
        })
    })

    it('normalizes goal-scoped blocked task creation without blocker metadata back to planning', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-create-blocked-without-blocker'
        const goalId = 'goal-docs-create-blocked-without-blocker'
        const goalKey = 'goal-docs-create-blocked-without-blocker'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Create Blocked Without Blocker Goal' })

        const app = createTestApp(store)
        const response = await createTask(app, projectId, {
            title: 'Route-created blocked task without blocker metadata',
            goalId,
            status: 'blocked'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; goalTodoRef: string | null; goalId: string | null; status: string; blockedReason: string | null; blockedSource?: string | null }
        }
        expect(body.task).toMatchObject({
            goalId,
            status: 'planning',
            blockedReason: null
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${body.task.goalTodoRef ?? body.task.id}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('status: blocked')
        expect(todo).not.toContain('kind: intervention')
        expect(todo).not.toContain('summary:')

        const stored = store.tasks.getTaskByNamespace(body.task.id, 'default')
        expect(stored).toMatchObject({
            status: 'planning',
            blockedReason: null,
            blockedSource: null
        })
    })

    it('archives goal-scoped tasks by removing the canonical todo item first', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-archive'
        const goalId = 'goal-docs-archive'
        const goalKey = 'goal-docs-archive'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Archive Goal' })

        const app = createTestApp(store)
        const createResponse = await createTask(app, projectId, {
            title: 'Archive me from goal docs',
            goalId,
            description: 'This goal task should leave todo.yml when archived.'
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            task: { id: string; goalId: string | null; goalTodoRef: string | null }
        }

        const archiveResponse = await app.request(`/api/tasks/${createBody.task.id}/archive`, {
            method: 'POST'
        })
        expect(archiveResponse.status).toBe(200)
        expect(await archiveResponse.json()).toEqual({ ok: true })

        const stored = store.tasks.getTaskByNamespace(createBody.task.id, 'default')
        expect(stored?.archivedAt).toEqual(expect.any(Number))

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).not.toContain(`ref: ${createBody.task.id}`)
        expect(todo).not.toContain('title: Archive me from goal docs')

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('todo_item_removed_from_tasks_api')

        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string }>
        }
        expect(listBody.tasks.some((task) => task.id === createBody.task.id)).toBe(false)
    })

    it('writes same-goal task patches through todo docs and emits a docs-first event', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-patch'
        const goalId = 'goal-docs-patch'
        const goalKey = 'goal-docs-patch'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Patch Goal' })

        const app = createTestApp(store)
        const createResponse = await createTask(app, projectId, {
            title: 'Patch me through docs',
            goalId,
            description: 'Original description'
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            task: { id: string; goalTodoRef: string | null }
        }

        const patchResponse = await app.request(`/api/tasks/${createBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'blocked',
                title: 'Patched through docs',
                description: 'Updated description',
                blockedReason: 'Waiting for explicit user decision'
            })
        })

        expect(patchResponse.status).toBe(200)
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${createBody.task.id}`)
        expect(todo).toContain('title: Patched through docs')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('summary: Waiting for explicit user decision')

        const detailResponse = await app.request(`/api/tasks/${createBody.task.id}`)
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: createBody.task.id,
            status: 'planning',
            blockedReason: 'Waiting for explicit user decision'
        })

        const stored = store.tasks.getTaskByNamespace(createBody.task.id, 'default')
        expect(stored).toMatchObject({
            status: 'planning',
            blockedReason: 'Waiting for explicit user decision'
        })

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('todo_item_updated_from_tasks_api')
    })

    it('keeps the docs-backed title when same-goal task patches reuse a stale overlay row', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-patch-stale-title'
        const goalId = 'goal-docs-patch-stale-title'
        const goalKey = 'goal-docs-patch-stale-title'
        const taskId = 'goal-docs-patch-stale-title-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay patch title',
            status: 'in_progress',
            workflowProfile: 'default'
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
            'controller-session-goal-patch-stale-title',
            controllerMetadata,
            null,
            'default'
        )
        const now = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
            namespace: 'default',
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
            getSessionByNamespace(id: string, namespace: string) {
                if (id === controllerSession.id && namespace === 'default') {
                    return controllerSession
                }
                return undefined
            },
            async sendMessage(sessionId: string, message: { text: string }) {
                controllerMessages.push({ sessionId, text: message.text })
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const patchResponse = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'blocked',
                blockedReason: 'Waiting for product decision'
            })
        })

        expect(patchResponse.status).toBe(200)
        const patchBody = await patchResponse.json() as {
            task: { id: string; title: string; blockedReason: string | null }
        }
        expect(patchBody.task).toMatchObject({
            id: taskId,
            title: 'YAML only task',
            blockedReason: 'Waiting for product decision'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('title: YAML only task')
        expect(todo).not.toContain('title: Stale overlay patch title')
        expect(todo).toContain('summary: Waiting for product decision')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「YAML only task」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：YAML only task')
        expect(controllerMessages[0]?.text).not.toContain('Stale overlay patch title')
    })

    it('keeps the docs-backed title when same-goal task patches lose the canonical board item mid-flight', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-patch-docs-missing-midflight'
        const goalId = 'goal-docs-patch-docs-missing-midflight'
        const goalKey = 'goal-docs-patch-docs-missing-midflight'
        const taskId = 'goal-docs-patch-docs-missing-midflight-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay patch title',
            status: 'in_progress',
            workflowProfile: 'default'
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
            'controller-session-goal-patch-docs-missing-midflight',
            controllerMetadata,
            null,
            'default'
        )
        const now = Date.now()
        const controllerSession: Session = {
            id: controllerStored.id,
            namespace: 'default',
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
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        const originalUpdateTaskByNamespace = store.tasks.updateTaskByNamespace.bind(store.tasks)
        store.tasks.updateTaskByNamespace = ((id, namespace, patch) => {
            const updated = originalUpdateTaskByNamespace(id, namespace, patch)
            if (updated?.id === taskId) {
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: YAML Goal',
                    'items: []'
                ].join('\n'), 'utf8')
            }
            return updated
        }) as typeof store.tasks.updateTaskByNamespace

        const engine = {
            getSessionByNamespace(id: string, namespace: string) {
                if (id === controllerSession.id && namespace === 'default') {
                    return controllerSession
                }
                return undefined
            },
            async sendMessage(sessionId: string, message: { text: string }) {
                controllerMessages.push({ sessionId, text: message.text })
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const patchResponse = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'blocked',
                blockedReason: 'Waiting for product decision'
            })
        })

        expect(patchResponse.status).toBe(200)
        const patchBody = await patchResponse.json() as {
            task: { id: string; title: string; blockedReason: string | null }
        }
        expect(patchBody.task).toMatchObject({
            id: taskId,
            title: 'YAML only task',
            blockedReason: 'Waiting for product decision'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${taskId}`)
        expect(todo).not.toContain('title: Stale overlay patch title')
        expect(todo).not.toContain('summary: Waiting for product decision')

        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]?.sessionId).toBe(controllerSession.id)
        expect(controllerMessages[0]?.text).toContain('任务「YAML only task」被阻塞了。')
        expect(controllerMessages[0]?.text).toContain('被阻塞任务：YAML only task')
        expect(controllerMessages[0]?.text).not.toContain('Stale overlay patch title')
    })

    it('writes blockers for same-goal task patches without requiring blocked status', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-patch-blocked-review'
        const goalId = 'goal-docs-patch-blocked-review'
        const goalKey = 'goal-docs-patch-blocked-review'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Patch Blocked Review Goal' })

        const app = createTestApp(store)
        const createResponse = await createTask(app, projectId, {
            title: 'Patch me into blocked review',
            goalId
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            task: { id: string }
        }

        const patchResponse = await app.request(`/api/tasks/${createBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'review',
                blockedReason: 'Needs reviewer confirmation',
                blockedSource: 'evaluator'
            })
        })

        expect(patchResponse.status).toBe(200)
        const patchBody = await patchResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(patchBody.task).toMatchObject({
            id: createBody.task.id,
            status: 'review',
            blockedReason: 'Needs reviewer confirmation'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${createBody.task.id}`)
        expect(todo).toContain('status: in_review')
        expect(todo).toContain('blockedBy:')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Needs reviewer confirmation')

        const detailResponse = await app.request(`/api/tasks/${createBody.task.id}`)
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: createBody.task.id,
            status: 'review',
            blockedReason: 'Needs reviewer confirmation'
        })

        const stored = store.tasks.getTaskByNamespace(createBody.task.id, 'default')
        expect(stored).toMatchObject({
            status: 'review',
            blockedReason: 'Needs reviewer confirmation',
            blockedSource: 'evaluator'
        })
    })

    it('does not synthesize blockers for same-goal blocked patches without blocker metadata', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-docs-patch-blocked-without-blocker'
        const goalId = 'goal-docs-patch-blocked-without-blocker'
        const goalKey = 'goal-docs-patch-blocked-without-blocker'
        seedProject(store, projectId)
        const workspacePath = seedWorkspace(store, projectId)
        seedGoal(store, { id: goalId, projectId, goalKey, title: 'Docs Patch Blocked Without Blocker Goal' })

        const app = createTestApp(store)
        const createResponse = await createTask(app, projectId, {
            title: 'Patch me into legacy blocked without blocker metadata',
            goalId
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            task: { id: string }
        }

        const patchResponse = await app.request(`/api/tasks/${createBody.task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'blocked'
            })
        })

        expect(patchResponse.status).toBe(200)
        const patchBody = await patchResponse.json() as {
            task: { id: string; status: string; blockedReason: string | null }
        }
        expect(patchBody.task).toMatchObject({
            id: createBody.task.id,
            status: 'planning',
            blockedReason: null
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${createBody.task.id}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('status: blocked')
        expect(todo).not.toContain('kind: intervention')
        expect(todo).not.toContain('summary:')

        const stored = store.tasks.getTaskByNamespace(createBody.task.id, 'default')
        expect(stored).toMatchObject({
            status: 'planning',
            blockedReason: null,
            blockedSource: null
        })
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
            tag: 'ready'
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
            tag: 'ready'
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
                tag: 'deferred',
                blockedReason: 'Needs product decision'
            })
        })

        expect(response.status).toBe(200)
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored).toMatchObject({
            id: taskId,
            projectId,
            goalId,
            status: 'planning',
            blockedReason: 'Needs product decision'
        })

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-task-write', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('tag: deferred')
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

    it('preserves the canonical lane for an old preview runtime blocker without rewriting goal todo docs', async () => {
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
            status: 'running',
            tag: 'promoted'
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
            blockedReason: 'Preview process exited with code 1'
        })

        const detailResponse = await app.request(`/api/tasks/${dbTaskId}`)
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; goalTodoRef: string | null; status: string; blockedReason: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'running',
            blockedReason: 'Preview process exited with code 1'
        })
        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.status).toBe('running')
        expect(stored?.blockedReason).toBe('Preview process exited with code 1')
        expect(stored?.blockedSource).toBe('preview')
        expect(stored?.previewRuntime?.status).toBe('blocked')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-preview-blocked', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('status: in_progress')
        expect(todo).not.toContain('summary: Preview process exited with code 1')
    })

    it('does not copy synthetic runtime envelopes into a materialized writable goal overlay row', () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-materialize-runtime'
        const goalId = 'goal-yaml-materialize-runtime'
        const goalKey = 'yaml-materialize-runtime'
        const taskId = 'materialized-runtime-task'
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
            goalKey,
            title: 'Materialize Runtime Goal'
        })

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Materialize Runtime Goal',
            'items:',
            `  - ref: ${taskId}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Materialized runtime task',
            '    description: Docs-only task with a durable blocker.',
            '    blockedBy:',
            '      - kind: decision',
            '        summary: Waiting for product decision'
        ].join('\n'), 'utf8')

        const materialized = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace: 'default',
            taskId
        })

        expect(materialized).toMatchObject({
            id: taskId,
            goalId,
            goalTodoRef: taskId,
            status: 'running',
            blockedReason: 'Waiting for product decision',
            blockedSource: 'decision'
        })
        expect(materialized?.mergeRuntime).toBeNull()
        expect(materialized?.previewRuntime).toBeNull()
        expect(materialized?.initRuntime).toBeNull()
    })

    it('projects a legacy blocked overlay with an explicit blocker source back onto the canonical lane', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-scheduler-blocked'
        const goalId = 'goal-yaml-scheduler-blocked'
        const todoRef = 'scheduler-blocked-yaml-task'
        const dbTaskId = 'stored-scheduler-blocked-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'yaml-scheduler-blocked',
            taskId: todoRef,
            status: 'planning',
            tag: 'ready'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Scheduler blocked task',
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler'
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)

        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; goalTodoRef: string | null; status: string; blockedReason: string | null; blockedSource: string | null }>
        }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'planning',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler'
        })

        const detailResponse = await app.request(`/api/tasks/${dbTaskId}`)
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; goalTodoRef: string | null; status: string; blockedReason: string | null; blockedSource: string | null }
        }
        expect(detailBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'planning',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler'
        })

        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.status).toBe('blocked')
        expect(stored?.blockedSource).toBe('scheduler')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-scheduler-blocked', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('summary: Runner offline or not connected.')
    })

    it('writes goal todo docs first when preview start blocks an inactive goal task session', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-route-blocked'
        const goalId = 'goal-goal-preview-route-blocked'
        const goalKey = 'goal-preview-route-blocked'
        const taskId = 'goal-preview-route-blocked-task'
        const sessionId = 'goal-preview-route-blocked-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Preview route blocked task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: sessionId
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
            'controller-session-preview-route-blocked',
            controllerMetadata,
            null,
            'default'
        )

        const session = {
            id: sessionId,
            namespace: 'default',
            active: false,
            thinking: false,
            metadata: {
                path: workspacePath,
                machineId: 'machine-1',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const controllerSession = {
            id: controllerStored.id,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: controllerMetadata,
            agentState: null
        }
        const controllerMessages: string[] = []
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id === controllerSession.id) {
                    return controllerSession
                }
                return undefined
            },
            async sendMessage(_sessionId: string, message: { text: string }) {
                controllerMessages.push(message.text)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(503)
        const body = await response.json() as {
            task?: {
                id?: string
                status?: string
                goalCanonicalStatus?: string | null
                blockedSource?: string | null
                blockedReason?: string | null
            }
            previewRuntime?: { status?: string; blockedReason?: string | null }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            status: 'running',
            goalCanonicalStatus: 'in_progress',
            blockedSource: 'preview'
        })
        expect(body.previewRuntime?.status).toBe('blocked')
        expect(body.previewRuntime?.blockedReason).toContain('inactive')
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored?.status).toBe('running')
        expect(stored?.previewRuntime?.status).toBe('blocked')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('title: YAML only task')
        expect(todo).not.toContain('title: Preview route blocked task')
        expect(todo).toContain('kind: intervention')
        expect(todo).toContain('summary: Linked session became inactive before preview could start.')

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('preview_runtime_updated_from_tasks_api')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]).toContain('YAML only task')
        expect(controllerMessages[0]).not.toContain('Preview route blocked task')
    })

    it('returns a docs-projected goal task from preview status responses', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-status'
        const goalId = 'goal-goal-preview-status'
        const goalKey = 'goal-preview-status'
        const taskId = 'goal-preview-status-task'
        const sessionId = 'goal-preview-status-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Preview status task',
            status: 'running',
            activeSessionId: sessionId,
            previewRuntime: {
                status: 'blocked',
                sessionId,
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

        const engine = {
            previewStatusForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: false,
                    status: 'idle' as const,
                    taskId,
                    sessionId,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: false,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host'
                        },
                        agentState: null
                    }
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task?: { id: string; goalTodoRef: string | null; status: string; blockedReason: string | null; blockedSource: string | null }
            previewRuntime?: { status?: string; blockedReason?: string | null }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            goalTodoRef: taskId,
            status: 'running',
            blockedReason: 'Preview process exited with code 1',
            blockedSource: 'preview'
        })
        expect(body.previewRuntime?.status).toBe('blocked')
        expect(body.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')
    })

    it('does not recreate a removed goal todo item when preview start blocks after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-docs-missing-block'
        const goalId = 'goal-goal-preview-docs-missing-block'
        const goalKey = 'goal-preview-docs-missing-block'
        const taskId = 'goal-preview-docs-missing-block-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })
        const sessionId = store.sessions.getOrCreateSession(
            'session-goal-preview-docs-missing-block',
            { path: workspacePath, machineId: 'machine-1' },
            null,
            'default'
        ).id

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Preview route docs-missing task',
            status: 'running',
            activeSessionId: sessionId
        })

        let docsRemoved = false
        const session = {
            id: sessionId,
            namespace: 'default',
            active: false,
            thinking: false,
            metadata: {
                path: workspacePath,
                machineId: 'machine-1',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                if (!docsRemoved) {
                    docsRemoved = true
                    writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), [
                        'version: 1',
                        'goal:',
                        `  goalKey: ${goalKey}`,
                        `  goalId: ${goalId}`,
                        '  title: YAML Goal',
                        'items: []'
                    ].join('\n'), 'utf8')
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(503)
        const body = await response.json() as {
            task?: { id?: string; title?: string; blockedSource?: string | null }
            previewRuntime?: { status?: string }
        }
        expect(body.task?.id).toBe(taskId)
        expect(body.task?.title).toBe('YAML only task')
        expect(body.task?.blockedSource).toBe('preview')
        expect(body.previewRuntime?.status).toBe('blocked')
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored?.previewRuntime?.status).toBe('blocked')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${taskId}`)
        expect(todo).not.toContain('title: Preview route docs-missing task')
    })

    it('accepts a canonical goal todo ref alias for preview start routes', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-alias'
        const goalId = 'goal-goal-preview-alias'
        const goalKey = 'goal-preview-alias'
        const todoRef = 'goal-preview-alias-ref'
        const dbTaskId = 'goal-preview-alias-db-task'
        const sessionId = 'goal-preview-alias-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Preview alias task',
            status: 'running',
            activeSessionId: sessionId,
            previewRuntime: {
                status: 'blocked',
                sessionId,
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

        const inactiveSession = {
            id: sessionId,
            namespace: 'default',
            active: false,
            thinking: false,
            metadata: {
                path: workspacePath,
                machineId: 'machine-1',
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: inactiveSession
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${todoRef}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(startResponse.status).toBe(503)
        const startBody = await startResponse.json() as {
            task?: {
                id?: string
                goalTodoRef?: string | null
                status?: string
                blockedSource?: string | null
            }
            previewRuntime?: { status?: string; blockedReason?: string | null }
        }
        expect(startBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'running',
            blockedSource: 'preview'
        })
        expect(startBody.previewRuntime?.status).toBe('blocked')
        expect(startBody.previewRuntime?.blockedReason).toContain('inactive')
    })

    it('accepts a canonical goal todo ref alias for preview status routes', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-status-alias'
        const goalId = 'goal-goal-preview-status-alias'
        const goalKey = 'goal-preview-status-alias'
        const todoRef = 'goal-preview-status-alias-ref'
        const dbTaskId = 'goal-preview-status-alias-db-task'
        const sessionId = 'goal-preview-status-alias-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Preview status alias task',
            status: 'running',
            activeSessionId: sessionId,
            previewRuntime: {
                status: 'blocked',
                sessionId,
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

        const engine = {
            previewStatusForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: false,
                    status: 'idle' as const,
                    taskId: dbTaskId,
                    sessionId,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: false,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host'
                        },
                        agentState: null
                    }
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/preview`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task?: { id: string; goalTodoRef: string | null; status: string; blockedReason: string | null; blockedSource: string | null }
            previewRuntime?: { status?: string; blockedReason?: string | null }
        }
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'running',
            blockedReason: 'Preview process exited with code 1',
            blockedSource: 'preview'
        })
        expect(body.previewRuntime?.status).toBe('blocked')
        expect(body.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')
    })

    it('returns a docs-projected goal task from preview stop responses', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-stop'
        const goalId = 'goal-goal-preview-stop'
        const goalKey = 'goal-preview-stop'
        const taskId = 'goal-preview-stop-task'
        const sessionId = 'goal-preview-stop-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Preview stop task',
            status: 'running',
            activeSessionId: sessionId,
            previewRuntime: {
                status: 'running',
                sessionId,
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Preview started.',
                blockedReason: null
            }
        })

        const engine = {
            previewStatusForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            previewStopForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: false,
                    status: 'stopped' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    updatedAt: Date.now(),
                    logTail: ['stopped']
                }
            },
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: false,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host'
                        },
                        agentState: null
                    }
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task?: { id: string; goalTodoRef: string | null; status: string; tag?: string | null }
            previewRuntime?: { status?: string; latestNote?: string | null }
            preview?: { status?: string }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            goalTodoRef: taskId,
            status: 'running',
            tag: 'promoted'
        })
        expect(body.preview?.status).toBe('stopped')
        expect(body.previewRuntime?.status).toBe('stopped')
    })

    it('accepts a canonical goal todo ref alias for preview stop routes', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-stop-alias'
        const goalId = 'goal-goal-preview-stop-alias'
        const goalKey = 'goal-preview-stop-alias'
        const todoRef = 'goal-preview-stop-alias-ref'
        const dbTaskId = 'goal-preview-stop-alias-db-task'
        const sessionId = 'goal-preview-stop-alias-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Preview stop alias task',
            status: 'running',
            activeSessionId: sessionId,
            previewRuntime: {
                status: 'running',
                sessionId,
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Preview started.',
                blockedReason: null
            }
        })

        const engine = {
            previewStatusForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId: dbTaskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            previewStopForSession(id: string) {
                if (id !== sessionId) {
                    throw new Error('preview session not found')
                }
                return {
                    active: false,
                    status: 'stopped' as const,
                    taskId: dbTaskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    updatedAt: Date.now(),
                    logTail: ['stopped']
                }
            },
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: false,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host'
                        },
                        agentState: null
                    }
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/preview/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task?: { id: string; goalTodoRef: string | null; status: string; tag?: string | null }
            previewRuntime?: { status?: string; latestNote?: string | null }
            preview?: { status?: string }
        }
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'running',
            tag: 'promoted'
        })
        expect(body.preview?.status).toBe('stopped')
        expect(body.previewRuntime?.status).toBe('stopped')
    })

    it('cancels a queued preview started through a canonical goal todo ref alias without auto-running later', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-preview-cancel-alias'
        const goalId = 'goal-goal-preview-cancel-alias'
        const goalKey = 'goal-preview-cancel-alias'
        const todoRef = 'goal-preview-cancel-alias-ref'
        const dbTaskId = 'goal-preview-cancel-alias-db-task'
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
            goalKey,
            title: 'Queued Preview Alias Goal'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Queued Preview Alias Goal',
            'items:',
            `  - ref: ${todoRef}`,
            '    taskId: goal-preview-cancel-alias-db-task',
            '    kind: engineering',
            '    status: in_progress',
            '    tag: promoted',
            '    title: YAML queued preview task',
            '    description: Preview should stay canceled.'
        ].join('\n'), 'utf8')

        const sessionId = store.sessions.getOrCreateSession(
            'goal-preview-cancel-alias-session',
            { path: workspacePath, host: 'test-host' },
            null,
            'default'
        ).id
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Queued preview alias task',
            status: 'running',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let startCalls = 0
        let stopCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: true,
            metadata: {
                path: workspacePath,
                host: 'test-host'
            }
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId: dbTaskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4373',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async previewStopForSession() {
                stopCalls += 1
                return {
                    active: false,
                    status: 'stopped' as const,
                    taskId: dbTaskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: workspacePath,
                    updatedAt: Date.now(),
                    logTail: []
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${todoRef}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(startResponse.status).toBe(200)
        const startBody = await startResponse.json() as {
            previewRuntime?: { status?: string }
        }
        expect(startBody.previewRuntime?.status).toBe('queued')
        expect(startCalls).toBe(0)

        const stopResponse = await app.request(`/api/tasks/${todoRef}/preview/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(stopResponse.status).toBe(200)
        const stopBody = await stopResponse.json() as {
            preview: { status: string }
            previewRuntime?: { status?: string; latestNote?: string | null }
            task?: { id: string; goalTodoRef: string | null }
        }
        expect(stopBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef
        })
        expect(stopBody.preview.status).toBe('idle')
        expect(stopBody.previewRuntime?.status).toBe('canceled')
        expect(stopBody.previewRuntime?.latestNote).toContain('canceled')
        expect(stopCalls).toBe(0)

        session.thinking = false
        await new Promise((resolve) => setTimeout(resolve, 700))
        expect(startCalls).toBe(0)

        const runtime = store.tasks.getTaskByNamespace(dbTaskId, 'default')?.previewRuntime
        expect(runtime?.status).toBe('canceled')
    })

    it('cancels a queued merge started through a canonical goal todo ref alias without auto-running later', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-cancel-monitor-alias'
        const goalId = 'goal-goal-merge-cancel-monitor-alias'
        const goalKey = 'goal-merge-cancel-monitor-alias'
        const todoRef = 'goal-merge-cancel-monitor-alias-ref'
        const dbTaskId = 'goal-merge-cancel-monitor-alias-db-task'
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
            goalKey,
            title: 'Queued Merge Alias Goal'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Queued Merge Alias Goal',
            'items:',
            `  - ref: ${todoRef}`,
            `    taskId: ${dbTaskId}`,
            '    kind: engineering',
            '    status: in_review',
            '    tag: in_review',
            '    title: YAML queued merge task',
            '    description: Merge should stay canceled.'
        ].join('\n'), 'utf8')

        const sessionId = store.sessions.getOrCreateSession(
            'goal-merge-cancel-monitor-alias-session',
            { path: workspacePath, host: 'test-host' },
            null,
            'default'
        ).id
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Queued merge alias task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let mergeStateCalls = 0
        let mergeCalls = 0
        let sendMessageCalls = 0
        let abortCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: true,
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : null
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                mergeStateCalls += 1
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: 'merge-commit'
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
            },
            async abortSession() {
                abortCalls += 1
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${todoRef}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(startResponse.status).toBe(200)
        const startBody = await startResponse.json() as {
            skippedReason?: string | null
            task?: {
                id?: string
                goalTodoRef?: string | null
                mergeRuntime?: { status?: string | null } | null
            }
        }
        expect(startBody.skippedReason).toBe('queued')
        expect(startBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef
        })
        expect(startBody.task?.mergeRuntime?.status).toBe('queued')
        expect(mergeStateCalls).toBe(1)
        expect(mergeCalls).toBe(0)
        expect(sendMessageCalls).toBe(0)

        const cancelResponse = await app.request(`/api/tasks/${todoRef}/worktree/merge/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(cancelResponse.status).toBe(200)
        const cancelBody = await cancelResponse.json() as {
            canceled?: boolean
            task?: { id?: string; goalTodoRef?: string | null }
            mergeRuntime?: { status?: string | null }
        }
        expect(cancelBody.canceled).toBe(true)
        expect(cancelBody.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef
        })
        expect(cancelBody.mergeRuntime?.status).toBe('canceled')
        expect(abortCalls).toBe(1)

        session.thinking = false
        await new Promise((resolve) => setTimeout(resolve, 700))

        expect(mergeStateCalls).toBe(1)
        expect(mergeCalls).toBe(0)
        expect(sendMessageCalls).toBe(0)
        const runtime = store.tasks.getTaskByNamespace(dbTaskId, 'default')?.mergeRuntime
        expect(runtime?.status).toBe('canceled')
    })

    it('writes goal todo docs first when merge route blocks a goal task', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-blocked'
        const goalId = 'goal-goal-merge-route-blocked'
        const goalKey = 'goal-merge-route-blocked'
        const taskId = 'goal-merge-route-blocked-task'
        const sessionId = 'goal-merge-route-blocked-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'review',
            tag: 'in_review'
        })
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Merge route blocked task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
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
            'controller-session-merge-route-blocked',
            controllerMetadata,
            null,
            'default'
        )

        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const controllerSession = {
            id: controllerStored.id,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: controllerMetadata,
            agentState: null
        }
        const controllerMessages: string[] = []
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id === sessionId) {
                    return session
                }
                if (id === controllerSession.id) {
                    return controllerSession
                }
                return undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from('version: 1\nmerge:\n  strategy: [\n', 'utf8').toString('base64')
                }
            },
            async sendMessage(_sessionId: string, message: { text: string }) {
                controllerMessages.push(message.text)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(400)
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored?.mergeRuntime?.status).toBe('blocked')
        expect(stored?.status).toBe('review')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: merging')
        expect(todo).toContain('blockedBy:')
        expect(todo).toContain('kind: intervention')

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('merge_runtime_updated_from_tasks_api')
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]).toContain('YAML only task')
        expect(controllerMessages[0]).not.toContain('Merge route blocked task')
    })

    it('does not recreate a removed goal todo item when merge route blocks after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-docs-missing-block'
        const goalId = 'goal-goal-merge-route-docs-missing-block'
        const goalKey = 'goal-merge-route-docs-missing-block'
        const taskId = 'goal-merge-route-docs-missing-block-task'
        const sessionId = 'goal-merge-route-docs-missing-block-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'review',
            tag: 'in_review'
        })
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Merge route docs-missing blocked task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
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
            'controller-session-merge-route-docs-missing-block',
            controllerMetadata,
            null,
            'default'
        )

        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const controllerSession = {
            id: controllerStored.id,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: controllerMetadata,
            agentState: null
        }
        const controllerMessages: string[] = []
        let docsRemoved = false
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id === sessionId) {
                    return session
                }
                if (id === controllerSession.id) {
                    return controllerSession
                }
                return undefined
            },
            async readSessionFile() {
                if (!docsRemoved) {
                    docsRemoved = true
                    writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), [
                        'version: 1',
                        'goal:',
                        `  goalKey: ${goalKey}`,
                        `  goalId: ${goalId}`,
                        '  title: YAML Goal',
                        'items: []'
                    ].join('\n'), 'utf8')
                }
                return {
                    success: true,
                    content: Buffer.from('version: 1\nmerge:\n  strategy: [\n', 'utf8').toString('base64')
                }
            },
            async sendMessage(_sessionId: string, message: { text: string }) {
                controllerMessages.push(message.text)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(400)
        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored?.mergeRuntime?.status).toBe('blocked')
        expect(stored?.status).toBe('review')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${taskId}`)
        expect(todo).not.toContain('Merge route docs-missing blocked task')

        const eventsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl')
        if (existsSync(eventsPath)) {
            const events = readFileSync(eventsPath, 'utf8')
            expect(events).not.toContain('merge_runtime_updated_from_tasks_api')
        }
        expect(controllerMessages).toHaveLength(1)
        expect(controllerMessages[0]).toContain('YAML only task')
        expect(controllerMessages[0]).not.toContain('Merge route docs-missing blocked task')
    })

    it('returns a docs-projected goal task from merge kickoff responses', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-kickoff'
        const goalId = 'goal-goal-merge-route-kickoff'
        const goalKey = 'goal-merge-route-kickoff'
        const taskId = 'goal-merge-route-kickoff-task'
        const sessionId = 'goal-merge-route-kickoff-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'review',
            tag: 'in_review'
        })
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Merge kickoff goal task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        const queuedSession = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: true,
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: queuedSession
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? queuedSession : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(VALID_ACTIONS_MANIFEST)
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            skippedReason?: string | null
            task?: {
                id: string
                goalTodoRef: string | null
                status: string
                tag: string | null
                mergeRuntime?: { status?: string | null } | null
            }
        }
        expect(body.skippedReason).toBe('queued')
        expect(body.task).toMatchObject({
            id: taskId,
            goalTodoRef: taskId,
            status: 'review',
            tag: 'merging'
        })
        expect(body.task?.mergeRuntime?.status).toBe('queued')
    })

    it('accepts a canonical goal todo ref alias for merge state and merge kickoff routes', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-alias'
        const goalId = 'goal-goal-merge-route-alias'
        const goalKey = 'goal-merge-route-alias'
        const todoRef = 'goal-merge-route-alias-ref'
        const dbTaskId = 'goal-merge-route-alias-db-task'
        const sessionId = 'goal-merge-route-alias-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'review',
            tag: 'in_review'
        })
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stored merge alias task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: null
        })

        const mergeStateApp = createTestApp(store)
        const mergeStateResponse = await mergeStateApp.request(`/api/tasks/${todoRef}/worktree/merge-state`)
        expect(mergeStateResponse.status).toBe(200)
        const mergeStateBody = await mergeStateResponse.json() as {
            canMerge: boolean
            reason: string | null
            targetBranch: string | null
        }
        expect(mergeStateBody).toMatchObject({
            canMerge: false,
            reason: 'task_has_no_active_session',
            targetBranch: 'main'
        })

        store.tasks.updateTaskByNamespace(dbTaskId, 'default', {
            activeSessionId: sessionId
        })

        const queuedSession = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: true,
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: queuedSession
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? queuedSession : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(VALID_ACTIONS_MANIFEST)
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            skippedReason?: string | null
            task?: {
                id: string
                goalTodoRef: string | null
                status: string
                tag: string | null
                mergeRuntime?: { status?: string | null } | null
            }
        }
        expect(body.skippedReason).toBe('queued')
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'review',
            tag: 'merging'
        })
        expect(body.task?.mergeRuntime?.status).toBe('queued')
    })

    it('keeps the docs-backed title when queued goal merge monitor resumes from a stale overlay row', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-monitor-stale-title'
        const goalId = 'goal-goal-merge-monitor-stale-title'
        const goalKey = 'goal-merge-monitor-stale-title'
        const todoRef = 'goal-merge-monitor-stale-title-ref'
        const dbTaskId = 'goal-merge-monitor-stale-title-db-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'review',
            tag: 'in_review'
        })
        const sessionId = store.sessions.getOrCreateSession(
            'goal-merge-monitor-stale-title-session',
            {
                path: workspacePath,
                host: 'test-host',
                projectId,
                taskId: dbTaskId,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale queued merge title',
            description: 'Stale queued merge description',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let thinking = true
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            get thinking() {
                return thinking
            },
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(VALID_ACTIONS_MANIFEST)
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            async gitMergeWorktree() {
                return {
                    success: true,
                    commitHash: '3333333333333333333333333333333333333333'
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: '1111111111111111111111111111111111111111',
                    snapshotRef: '2222222222222222222222222222222222222222',
                    expectedChangeCount: 1
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: '1111111111111111111111111111111111111111',
                    snapshotRef: '2222222222222222222222222222222222222222',
                    expectedChangeCount: 1,
                    targetHead: '3333333333333333333333333333333333333333'
                }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            skippedReason?: string | null
            task?: { id: string; goalTodoRef: string | null; status: string; tag: string | null }
        }
        expect(body.skippedReason).toBe('queued')
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'review',
            tag: 'merging'
        })

        thinking = false
        const updatedTask = await waitForTaskPredicate({
            store,
            taskId: dbTaskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${todoRef}`)
        expect(todo).toContain('title: YAML only task')
        expect(todo).not.toContain('title: Stale queued merge title')
    })

    it('stops a queued goal merge monitor when the canonical todo item is removed before resume', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-monitor-removed-item'
        const goalId = 'goal-goal-merge-monitor-removed-item'
        const goalKey = 'goal-merge-monitor-removed-item'
        const todoRef = 'goal-merge-monitor-removed-item-ref'
        const dbTaskId = 'goal-merge-monitor-removed-item-db-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'review',
            tag: 'in_review'
        })
        const sessionId = store.sessions.getOrCreateSession(
            'goal-merge-monitor-removed-item-session',
            {
                path: workspacePath,
                host: 'test-host',
                projectId,
                taskId: dbTaskId,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        store.projects.updateProject(projectId, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale queued merge title',
            description: 'Stale queued merge description',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let thinking = true
        let mergeCalls = 0
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            get thinking() {
                return thinking
            },
            metadata: {
                path: workspacePath,
                host: 'test-host',
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : undefined
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(VALID_ACTIONS_MANIFEST)
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: '3333333333333333333333333333333333333333'
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: '1111111111111111111111111111111111111111',
                    snapshotRef: '2222222222222222222222222222222222222222',
                    expectedChangeCount: 1
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: '1111111111111111111111111111111111111111',
                    snapshotRef: '2222222222222222222222222222222222222222',
                    expectedChangeCount: 1,
                    targetHead: '3333333333333333333333333333333333333333'
                }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            skippedReason?: string | null
            task?: { id: string; goalTodoRef: string | null; status: string; tag: string | null }
        }
        expect(body.skippedReason).toBe('queued')
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'review',
            tag: 'merging'
        })

        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: YAML Goal',
            'items: []',
            ''
        ].join('\n'))

        thinking = false
        await new Promise((resolve) => setTimeout(resolve, 700))

        expect(mergeCalls).toBe(0)
        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.mergeRuntime?.status).toBe('queued')
        expect(stored?.worktreeMergedAt ?? null).toBeNull()

        const todo = readFileSync(todoPath, 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${todoRef}`)
        expect(todo).not.toContain('title: Stale queued merge title')
    })

    it('writes goal todo docs first when merge cancel updates a goal task runtime', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-cancel'
        const goalId = 'goal-goal-merge-route-cancel'
        const goalKey = 'goal-merge-route-cancel'
        const taskId = 'goal-merge-route-cancel-task'
        const sessionId = 'goal-merge-route-cancel-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'review',
            tag: 'merging'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Merge route cancel task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId,
            mergeRuntime: {
                status: 'queued',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now() - 1_000,
                latestNote: 'Queued for merge'
            }
        })

        let abortCalls = 0
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: true,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host',
                            worktree: {
                                basePath: workspacePath,
                                branch: 'task-branch',
                                name: 'task-branch'
                            }
                        },
                        agentState: null
                    }
                }
            },
            async abortSession() {
                abortCalls += 1
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            canceled?: boolean
            task?: {
                id: string
                goalTodoRef: string | null
                status: string
                tag: string | null
                mergeRuntime?: { status?: string | null } | null
            }
            mergeRuntime?: { status?: string }
        }
        expect(body.canceled).toBe(true)
        expect(body.mergeRuntime?.status).toBe('canceled')
        expect(body.task).toMatchObject({
            id: taskId,
            goalTodoRef: taskId,
            status: 'review',
            tag: 'in_review'
        })
        expect(body.task?.mergeRuntime?.status).toBe('canceled')
        expect(abortCalls).toBe(1)

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: in_review')
        expect(todo).not.toContain('status: merging')

        const events = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(events).toContain('merge_runtime_updated_from_tasks_api')
        expect(events).toContain('"status":"canceled"')
    })

    it('accepts a canonical goal todo ref alias for merge cancel routes', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-merge-route-cancel-alias'
        const goalId = 'goal-goal-merge-route-cancel-alias'
        const goalKey = 'goal-merge-route-cancel-alias'
        const todoRef = 'goal-merge-route-cancel-alias-ref'
        const dbTaskId = 'goal-merge-route-cancel-alias-db-task'
        const sessionId = 'goal-merge-route-cancel-alias-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId: todoRef,
            status: 'review',
            tag: 'merging'
        })
        store.tasks.createTask({
            id: dbTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Merge route cancel alias task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: sessionId,
            mergeRuntime: {
                status: 'queued',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now() - 1_000,
                latestNote: 'Queued for merge'
            }
        })

        let abortCalls = 0
        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: true,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host',
                            worktree: {
                                basePath: workspacePath,
                                branch: 'task-branch',
                                name: 'task-branch'
                            }
                        },
                        agentState: null
                    }
                }
            },
            async abortSession() {
                abortCalls += 1
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${todoRef}/worktree/merge/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            canceled?: boolean
            task?: {
                id: string
                goalTodoRef: string | null
                status: string
                tag: string | null
                mergeRuntime?: { status?: string | null } | null
            }
            mergeRuntime?: { status?: string }
        }
        expect(body.canceled).toBe(true)
        expect(body.mergeRuntime?.status).toBe('canceled')
        expect(body.task).toMatchObject({
            id: dbTaskId,
            goalTodoRef: todoRef,
            status: 'review',
            tag: 'in_review'
        })
        expect(body.task?.mergeRuntime?.status).toBe('canceled')
        expect(abortCalls).toBe(1)

        const stored = store.tasks.getTaskByNamespace(dbTaskId, 'default')
        expect(stored?.mergeRuntime?.status).toBe('canceled')
        expect(store.tasks.getTaskByNamespace(todoRef, 'default')).toBeNull()
    })

    it('returns a docs-projected goal task when attaching a session', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-attach-session'
        const goalId = 'goal-goal-attach-session'
        const goalKey = 'goal-attach-session'
        const taskId = 'goal-attach-session-task'
        const sessionId = 'goal-attach-session-session'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'running',
            tag: 'promoted'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Attach session route task',
            status: 'running',
            previewRuntime: {
                status: 'blocked',
                sessionId: 'old-session',
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
        store.sessions.getOrCreateSession(sessionId, { path: workspacePath, host: 'test-host' }, null, 'default')

        const engine = {
            resolveSessionAccess(id: string) {
                if (id !== sessionId) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace: 'default',
                        active: true,
                        thinking: false,
                        metadata: {
                            path: workspacePath,
                            host: 'test-host'
                        },
                        agentState: null
                    }
                }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/attach-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; activeSessionId: string | null; status: string; blockedReason: string | null; blockedSource: string | null }
        }
        expect(body.task).toMatchObject({
            id: taskId,
            activeSessionId: sessionId,
            status: 'running',
            blockedReason: 'Preview process exited with code 1',
            blockedSource: 'preview'
        })

        const stored = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(stored?.activeSessionId).toBe(sessionId)
        expect(stored?.status).toBe('running')
        expect(stored?.blockedReason).toBe('Preview process exited with code 1')
        expect(stored?.blockedSource).toBe('preview')
        expect(stored?.previewRuntime?.sessionId).toBe(sessionId)
    })

    it('returns a docs-projected goal task when starting a session', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-start-session'
        const goalId = 'goal-goal-start-session'
        const goalKey = 'goal-start-session'
        const taskId = 'goal-start-session-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey,
            taskId,
            status: 'planning',
            tag: 'ready'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Start session route task',
            description: 'Kick off a goal task session.',
            status: 'planning',
            workflowProfile: 'default',
            workspaceId: `${projectId}-workspace`
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-start-session',
            { path: workspacePath, host: 'localhost' },
            null,
            'default'
        )

        const engine = {
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace: 'default',
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return null
                }
                return {
                    id: spawned.id,
                    namespace: 'default',
                    active: true,
                    thinking: false,
                    metadata: {
                        path: workspacePath,
                        host: 'localhost'
                    },
                    agentState: null
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async runBash() {
                return {
                    success: true,
                    stdout: 'init ok',
                    stderr: ''
                }
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64(VALID_ACTIONS_MANIFEST)
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/unused' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/start-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            task: { id: string; goalTodoRef: string | null; status: string; tag?: string | null; activeSessionId: string | null }
            sessionId?: string
        }
        expect(body.sessionId).toBe(spawned.id)
        expect(body.task).toMatchObject({
            id: taskId,
            goalTodoRef: taskId,
            status: 'running',
            tag: 'promoted',
            activeSessionId: spawned.id
        })
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
            status: 'running',
            tag: 'promoted'
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

    it('omits deferred and candidate reservoir notes from the goal task board list', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-yaml-reservoir-notes'
        const goalId = 'goal-yaml-reservoir-notes'
        const goalKey = 'yaml-reservoir-notes'
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
            goalKey,
            title: 'Reservoir Goal'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Reservoir Goal',
            'items:',
            '  - ref: ready-task',
            '    kind: engineering',
            '    status: planned',
            '    tag: ready',
            '    title: Ready task',
            '  - ref: deferred-note',
            '    kind: planning',
            '    status: planned',
            '    tag: deferred',
            '    title: Deferred note',
            '  - ref: candidate-note',
            '    kind: planning',
            '    status: planned',
            '    tag: candidate',
            '    title: Candidate note'
        ].join('\n'), 'utf8')

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; status: string; tag?: string | null }>
        }
        expect(listBody.tasks.map((task) => task.id)).toEqual(['ready-task'])
        expect(listBody.tasks[0]).toMatchObject({
            status: 'planning',
            tag: 'ready'
        })
    })

    it('does not let a legacy DB-only goal task define the board before explicit migration', async () => {
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
            status: 'planning',
            activeSessionId: 'legacy-stale-session'
        })

        const engine = {
            resolveSessionAccess(sessionId: string) {
                if (sessionId === 'legacy-stale-session') {
                    return {
                        ok: true as const,
                        sessionId,
                        session: {
                            id: sessionId,
                            namespace: 'default',
                            active: true,
                            thinking: false,
                            metadata: {}
                        } as Session
                    }
                }
                return { ok: false as const, reason: 'not-found' as const }
            }
        } as unknown as SyncEngine
        const app = createTestApp(store, engine)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; goalTodoRef: string | null; status: string }>
        }
        expect(listBody.tasks).toEqual([])

        const detailResponse = await app.request('/api/tasks/legacy-db-only-task')
        expect(detailResponse.status).toBe(404)
        expect(await detailResponse.json()).toEqual({ error: 'Task not found' })

        const previewResponse = await app.request('/api/tasks/legacy-db-only-task/preview')
        expect(previewResponse.status).toBe(404)
        expect(await previewResponse.json()).toEqual({ error: 'Task not found' })

        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', 'yaml-backfill', 'todo.yml'))).toBe(false)
    })

    it('includes docs-only goal tasks in the unfiltered project task list', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-unfiltered-docs-goal-tasks'
        const goalId = 'goal-unfiltered-docs-goal-tasks'
        const taskId = 'docs-only-unfiltered-goal-task'
        const { workspacePath } = seedGoalTodoTask(store, {
            projectId,
            goalId,
            goalKey: 'unfiltered-docs-goal-tasks',
            taskId
        })
        store.tasks.createTask({
            id: 'plain-project-task',
            projectId,
            title: 'Plain project task',
            status: 'planning'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/projects/${projectId}/tasks`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            tasks: Array<{ id: string; goalId: string | null; goalTodoRef: string | null; status: string }>
        }
        expect(body.tasks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'plain-project-task',
                goalId: null,
                status: 'planning'
            }),
            expect.objectContaining({
                id: taskId,
                goalId,
                goalTodoRef: taskId,
                status: 'planning'
            })
        ]))

        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'unfiltered-docs-goal-tasks', 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskId}`)
        expect(todo).toContain('status: planned')
    })

    it('projects canonical stable refs with task ids and repairs legacy overlays to the stable ref', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-canonical-stable-refs'
        const goalId = 'goal-canonical-stable-refs'
        const goalKey = 'canonical-stable-refs'
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
            goalKey,
            title: 'Canonical Stable Ref Goal'
        })

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Canonical Stable Ref Goal',
            'items:',
            '  - ref: stable-ref-task',
            '    taskId: canonical-overlay-task',
            '    kind: engineering',
            '    status: planned',
            '    title: Canonical task with stable ref',
            '    description: Keep the ref stable even if the overlay id differs.',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'), 'utf8')

        store.tasks.createTask({
            id: 'canonical-overlay-task',
            projectId,
            goalId,
            title: 'Legacy overlay without goalTodoRef',
            status: 'planning'
        })

        const app = createTestApp(store)
        const listResponse = await app.request(`/api/projects/${projectId}/tasks?goalId=${goalId}`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            tasks: Array<{ id: string; goalTodoRef: string | null; title: string; status: string }>
        }
        expect(listBody.tasks).toHaveLength(1)
        expect(listBody.tasks[0]).toMatchObject({
            id: 'canonical-overlay-task',
            goalTodoRef: 'stable-ref-task',
            title: 'Canonical task with stable ref',
            status: 'planning'
        })

        const detailResponse = await app.request('/api/tasks/canonical-overlay-task')
        expect(detailResponse.status).toBe(200)
        const detailBody = await detailResponse.json() as {
            task: { id: string; goalTodoRef: string | null; title: string }
        }
        expect(detailBody.task).toMatchObject({
            id: 'canonical-overlay-task',
            goalTodoRef: 'stable-ref-task',
            title: 'Canonical task with stable ref'
        })

        const storedAfterRead = store.tasks.getTaskByNamespace('canonical-overlay-task', 'default')
        expect(storedAfterRead?.goalTodoRef).toBeNull()

        const materialized = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace: 'default',
            taskId: 'canonical-overlay-task'
        })
        expect(materialized?.goalTodoRef).toBe('stable-ref-task')

        const storedAfterWrite = store.tasks.getTaskByNamespace('canonical-overlay-task', 'default')
        expect(storedAfterWrite?.goalTodoRef).toBe('stable-ref-task')
    })

    it('keeps stale DB-only goal rows hidden from same-goal patch responses', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-stale-db-only-patch-response'
        const goalId = 'goal-stale-db-only-patch-response'
        const goalKey = 'stale-db-only-patch-response'
        const taskId = 'legacy-db-only-patch-task'
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
            goalKey,
            title: 'Stale DB-only Patch Response Goal'
        })

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Stale DB-only Patch Response Goal',
            'items: []'
        ].join('\n'), 'utf8')

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Legacy DB-only patch task',
            status: 'planning'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'running'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Task not found' })
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain(`ref: ${taskId}`)
    })
})
