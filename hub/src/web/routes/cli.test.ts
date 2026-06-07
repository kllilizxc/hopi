import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { createConfiguration, getConfiguration } from '../../configuration'
import { Store } from '../../store'
import { getDocsRoot, getGoalEventsPath, getGoalPlannerMailPath, getGoalPlanningRequestsPath } from '../../sync/goals/goalDocPaths'
import { parseGoalPlanningRequests } from '../../sync/goals/goalPlanningRequests'
import { readGoalTodo, upsertGoalTodoTaskState } from '../../sync/goals/goalTodo'
import type { SyncEngine } from '../../sync/syncEngine'
import { buildTaskMergeRuntime } from '../../utils/taskActionRuntime'
import { createGoalsRoutes } from './goals'
import { createProjectsRoutes } from './projects'
import { createCliRoutes } from './cli'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-cli-routes-'))
    tempDirs.push(path)
    return path
}

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

function decodeBase64(value: string): string {
    return Buffer.from(value, 'base64').toString('utf8')
}

async function ensureCliApiToken(): Promise<string> {
    try {
        return getConfiguration().cliApiToken
    } catch {
        const configHome = createTempWorkspace()
        process.env[PRODUCT_ENV.HOME] = configHome
        process.env.CLI_API_TOKEN = 'test-cli-token'
        const configuration = await createConfiguration()
        return configuration.cliApiToken
    }
}

function createTestEngine() {
    const files = new Map<string, string>()
    const realtimeEvents: unknown[] = []
    const ticks: Array<{ namespace: string; projectId: string }> = []

    const engine = {
        getSessionsByNamespace() {
            return []
        },
        handleRealtimeEvent(event: unknown) {
            realtimeEvents.push(event)
        },
        requestAutoRunTick(namespace: string, projectId: string) {
            ticks.push({ namespace, projectId })
        },
        async readFileOnMachine(_machineId: string, path: string) {
            const content = files.get(path)
            if (content === undefined) {
                return { success: false, error: 'not found' }
            }
            return { success: true, content: encodeBase64(content) }
        },
        async writeFileOnMachine(
            _machineId: string,
            path: string,
            request: { content?: string }
        ) {
            files.set(path, decodeBase64(request.content ?? ''))
            return { success: true, hash: 'hash' }
        }
    } as unknown as SyncEngine

    return { engine, files, realtimeEvents, ticks }
}

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('/api/*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/api', createGoalsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/cli', createCliRoutes({ store, getSyncEngine: () => engine }))
    return app
}

async function createProject(app: Hono, workspacePath: string): Promise<{ id: string }> {
    const response = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            machineId: 'machine-1',
            name: 'CLI Goal Project',
            workspaces: [{ path: workspacePath }]
        })
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { project: { id: string } }
    return body.project
}

async function createGoal(app: Hono, projectId: string, title: string): Promise<{ id: string; goalKey: string }> {
    const response = await app.request(`/api/projects/${projectId}/goals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title })
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { goal: { id: string; goalKey: string } }
    return body.goal
}

function buildCliHeaders(token: string): Record<string, string> {
    return {
        authorization: `Bearer ${token}:default`,
        'content-type': 'application/json'
    }
}

function parseEventLog(raw: string): Array<Record<string, unknown>> {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function writeGoalDocStatus(workspacePath: string, goalKey: string, status: 'planning' | 'active' | 'blocked'): void {
    writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'goal.md'), [
        '---',
        `goalKey: ${goalKey}`,
        'title: "Docs Goal Status"',
        `status: ${status}`,
        'autopilotEnabled: true',
        'deployRequiresApproval: true',
        '---',
        '',
        '# Docs Goal Status',
        '',
        '## Objective',
        '',
        'Reflect canonical goal metadata from docs.',
        '',
        '## Success Criteria',
        '',
        '- Goal route responses use canonical docs state.',
        ''
    ].join('\n'))
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('cli goal assistant routes', () => {
    it('materializes projected todo tasks for planned lane requests without creating DB intents', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine, ticks } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Projected Todo Task Goal')
        const storedProject = store.projects.getProjectByNamespace(project.id, 'default')
        const storedGoal = store.goals.getGoalByNamespace(goal.id, 'default')
        const defaultWorkspace = storedProject?.defaultWorkspaceId
            ? store.workspaces.getWorkspace(storedProject.defaultWorkspaceId)
            : null

        expect(storedProject).toBeTruthy()
        expect(storedGoal).toBeTruthy()
        expect(defaultWorkspace).toBeTruthy()

        upsertGoalTodoTaskState({
            project: storedProject!,
            goal: storedGoal!,
            defaultWorkspace,
            taskId: 'todo-only-task',
            status: 'blocked',
            taskKind: 'engineering',
            title: 'Todo Only Task',
            body: 'Investigate the scheduler regression.',
            blocked: {
                kind: 'runtime',
                summary: 'Last session failed before handoff.',
                updatedAt: Date.now()
            }
        })
        expect(store.tasks.getTaskByNamespace('todo-only-task', 'default')).toBeNull()

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/task-lane-requests`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken),
                body: JSON.stringify({
                    taskId: 'todo-only-task',
                    lane: 'planned',
                    message: 'Retry after fixing the scheduler regression.'
                })
            }
        )

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: true
            requestId: string
            taskId: string
            lane: 'planned'
            message: string
        }
        expect(body).toMatchObject({
            ok: true,
            taskId: 'todo-only-task',
            lane: 'planned',
            message: 'Retry after fixing the scheduler regression.'
        })
        expect(body.requestId.length).toBeGreaterThan(0)

        const task = store.tasks.getTaskByNamespace('todo-only-task', 'default')
        expect(task).toMatchObject({
            id: 'todo-only-task',
            goalTodoRef: 'todo-only-task',
            status: 'planning',
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            mergeRuntime: null
        })

        const todo = readGoalTodo({
            project: storedProject!,
            goal: storedGoal!,
            defaultWorkspace
        })
        const item = todo.board.items.find((candidate) => candidate.ref === 'todo-only-task')
        expect(item).toMatchObject({
            ref: 'todo-only-task',
            status: 'planned'
        })
        expect(item?.blockedBy).toEqual([])
        const projectedEvents = parseEventLog(
            readFileSync(getGoalEventsPath(getDocsRoot(defaultWorkspace)!, storedGoal!.goalKey), 'utf8')
        )
        expect(projectedEvents.at(-1)).toMatchObject({
            writer: 'goal-assistant',
            action: 'todo_item_lane_requested',
            reason: 'User requested this todo item return to the planned lane.'
        })
        expect(ticks).toContainEqual({ namespace: 'default', projectId: project.id })
    })

    it('requeues merge-blocked tasks into the merging lane and syncs canonical board state', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine, ticks } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Merge Retry Goal')
        const storedProject = store.projects.getProjectByNamespace(project.id, 'default')
        const storedGoal = store.goals.getGoalByNamespace(goal.id, 'default')
        const defaultWorkspace = storedProject?.defaultWorkspaceId
            ? store.workspaces.getWorkspace(storedProject.defaultWorkspaceId)
            : null
        const seededTask = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: goal.id
        })[0]

        expect(storedProject).toBeTruthy()
        expect(storedGoal).toBeTruthy()
        expect(defaultWorkspace).toBeTruthy()
        expect(seededTask).toBeTruthy()

        store.tasks.updateTaskByNamespace(seededTask!.id, 'default', {
            status: 'blocked',
            blockedReason: 'Merge conflict on target branch.',
            blockedSource: 'merge',
            mergeRuntime: buildTaskMergeRuntime({
                current: seededTask!.mergeRuntime,
                activeSessionId: seededTask!.activeSessionId,
                status: 'blocked',
                latestNote: 'Merge conflict on target branch.',
                blockedReason: 'Merge conflict on target branch.'
            })
        })

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/task-lane-requests`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken),
                body: JSON.stringify({
                    taskId: seededTask!.id,
                    lane: 'merging',
                    message: 'Retry merge after rebasing onto the latest target branch.'
                })
            }
        )

        expect(response.status).toBe(200)
        const updatedTask = store.tasks.getTaskByNamespace(seededTask!.id, 'default')
        expect(updatedTask).toMatchObject({
            id: seededTask!.id,
            status: 'review',
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            mergeRuntime: {
                status: 'waiting',
                latestNote: 'Retry merge after rebasing onto the latest target branch.'
            }
        })

        const todo = readGoalTodo({
            project: storedProject!,
            goal: storedGoal!,
            defaultWorkspace
        })
        const item = todo.board.items.find((candidate) => candidate.ref === updatedTask?.goalTodoRef)
        expect(item).toMatchObject({
            ref: updatedTask?.goalTodoRef,
            status: 'merging'
        })
        const mergeEvents = parseEventLog(
            readFileSync(getGoalEventsPath(getDocsRoot(defaultWorkspace)!, storedGoal!.goalKey), 'utf8')
        )
        expect(mergeEvents.at(-1)).toMatchObject({
            writer: 'goal-assistant',
            action: 'todo_item_lane_requested',
            reason: 'User requested a merge retry for this todo item.'
        })
        expect(ticks).toContainEqual({ namespace: 'default', projectId: project.id })
    })

    it('writes planning requests to planning-requests.yml without importing legacy planner-mail entries', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine, files, ticks } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Planner Mail Goal')
        const storedProject = store.projects.getProjectByNamespace(project.id, 'default')
        const storedGoal = store.goals.getGoalByNamespace(goal.id, 'default')
        const defaultWorkspace = storedProject?.defaultWorkspaceId
            ? store.workspaces.getWorkspace(storedProject.defaultWorkspaceId)
            : null
        const docsRoot = getDocsRoot(defaultWorkspace)
        const seededTask = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: goal.id
        })[0]

        expect(storedGoal).toBeTruthy()
        expect(docsRoot).toBeTruthy()
        expect(seededTask).toBeTruthy()

        files.set(getGoalPlannerMailPath(docsRoot!, storedGoal!.goalKey), [
            'version: 1',
            'mail:',
            '    - id: legacy-mail-1',
            '      body: Legacy planner follow-through',
            '      relatedTaskIds: []',
            '      createdAt: 111',
            '      status: pending'
        ].join('\n'))

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/planning-requests`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken),
                body: JSON.stringify({
                    body: 'Split the current scope into a follow-up implementation task.',
                    relatedTaskIds: [seededTask!.id]
                })
            }
        )

        expect(response.status).toBe(200)
        const body = await response.json() as { ok: true; planningRequestId: string }
        expect(body.ok).toBe(true)

        const planningRequestsPath = getGoalPlanningRequestsPath(docsRoot!, storedGoal!.goalKey)
        const document = parseGoalPlanningRequests(files.get(planningRequestsPath))
        expect(document.requests).toHaveLength(1)
        expect(document.requests[0]).toMatchObject({
            id: body.planningRequestId,
            body: 'Split the current scope into a follow-up implementation task.',
            relatedTaskIds: [seededTask!.id],
            status: 'pending'
        })
        const planningEvents = parseEventLog(files.get(getGoalEventsPath(docsRoot!, storedGoal!.goalKey)) ?? '')
        expect(planningEvents.at(-1)).toMatchObject({
            writer: 'goal-assistant',
            action: 'planning_request_appended',
            reason: 'User requested planner follow-through for this Goal.'
        })
        expect(ticks).toContainEqual({ namespace: 'default', projectId: project.id })
    })

    it('keeps the legacy planner-mail alias writing to planning-requests.yml', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine, files } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Planner Mail Alias Goal')
        const storedProject = store.projects.getProjectByNamespace(project.id, 'default')
        const storedGoal = store.goals.getGoalByNamespace(goal.id, 'default')
        const defaultWorkspace = storedProject?.defaultWorkspaceId
            ? store.workspaces.getWorkspace(storedProject.defaultWorkspaceId)
            : null
        const docsRoot = getDocsRoot(defaultWorkspace)

        expect(storedGoal).toBeTruthy()
        expect(docsRoot).toBeTruthy()

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/planner-mail`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken),
                body: JSON.stringify({
                    body: 'Legacy alias still lands in planning requests.'
                })
            }
        )

        expect(response.status).toBe(200)
        const body = await response.json() as { ok: true; planningRequestId: string }
        expect(body.ok).toBe(true)

        const planningRequestsPath = getGoalPlanningRequestsPath(docsRoot!, storedGoal!.goalKey)
        const document = parseGoalPlanningRequests(files.get(planningRequestsPath))
        expect(document.requests).toHaveLength(1)
        expect(document.requests[0]).toMatchObject({
            id: body.planningRequestId,
            body: 'Legacy alias still lands in planning requests.',
            status: 'pending'
        })
    })

    it('rejects stale DB-only goals with no canonical docs from goal-assistant snapshot routes', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        store.goals.createGoal({
            id: 'goal-stale-db-only',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'stale-db-only',
            title: 'Stale DB Only Goal',
            status: 'active'
        })

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/goal-stale-db-only/snapshot`,
            {
                method: 'GET',
                headers: buildCliHeaders(cliApiToken)
            }
        )

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toMatchObject({
            error: 'Goal not found'
        })
    })

    it('returns docs-backed goal status from decision resolution responses', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Decision Resolution Response Goal')
        const storedProject = store.projects.getProjectByNamespace(project.id, 'default')
        const storedGoal = store.goals.getGoalByNamespace(goal.id, 'default')
        const defaultWorkspace = storedProject?.defaultWorkspaceId
            ? store.workspaces.getWorkspace(storedProject.defaultWorkspaceId)
            : null
        const task = store.tasks.createTask({
            id: 'decision-resolution-task',
            projectId: project.id,
            goalId: goal.id,
            title: 'Need a routing decision',
            status: 'planning',
            workflowProfile: 'default'
        })

        expect(storedProject).toBeTruthy()
        expect(storedGoal).toBeTruthy()
        expect(defaultWorkspace).toBeTruthy()

        upsertGoalTodoTaskState({
            project: storedProject!,
            goal: storedGoal!,
            defaultWorkspace,
            taskId: task.id,
            status: 'planning',
            taskKind: 'engineering',
            title: task.title,
            body: task.description
        })

        const topicResponse = await app.request(`/api/goals/${goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                taskId: task.id,
                title: 'Choose route',
                body: 'Which route should the planner take?',
                blocking: true
            })
        })
        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { id: string } }
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('planning')

        writeGoalDocStatus(workspacePath, goal.goalKey, 'active')

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/decision-topic-resolutions`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken),
                body: JSON.stringify({
                    topicId: topicBody.topic.id,
                    resolution: 'Use the mainline route.'
                })
            }
        )

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: true
            goalStatus: string
            goalAutomationPaused: boolean
        }
        expect(body).toMatchObject({
            ok: true,
            goalStatus: 'active',
            goalAutomationPaused: false
        })
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('planning')
    })

    it('returns docs-backed goal status from automation resume responses', async () => {
        const cliApiToken = await ensureCliApiToken()
        const store = new Store(':memory:')
        const { engine } = createTestEngine()
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Automation Resume Response Goal')

        const pauseResponse = await app.request(`/api/goals/${goal.id}/automation/pause`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(pauseResponse.status).toBe(200)
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.automationPausedAt).not.toBeNull()
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('planning')

        writeGoalDocStatus(workspacePath, goal.goalKey, 'active')

        const response = await app.request(
            `/cli/goal-assistant/projects/${project.id}/goals/${goal.id}/automation-resume`,
            {
                method: 'POST',
                headers: buildCliHeaders(cliApiToken)
            }
        )

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: true
            goalStatus: string
            goalAutomationPaused: boolean
        }
        expect(body).toMatchObject({
            ok: true,
            goalStatus: 'active',
            goalAutomationPaused: false
        })
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('planning')
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.automationPausedAt).toBeNull()
    })
})
