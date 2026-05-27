import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import YAML from 'yaml'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createGoalsRoutes } from './goals'
import { createProjectsRoutes } from './projects'
import { createTasksRoutes } from './tasks'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goals-'))
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
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/api', createGoalsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/api', createTasksRoutes({ store, getSyncEngine: () => engine }))
    return app
}

async function createProject(app: Hono, workspacePath: string): Promise<{ id: string }> {
    const response = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            machineId: 'machine-1',
            name: 'Goal Project',
            workspaces: [{ path: workspacePath }]
        })
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { project: { id: string } }
    return body.project
}

function readGoalDecisionTopics(workspacePath: string, goalKey: string): Array<Record<string, unknown>> {
    const path = join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'decisions.yml')
    const parsed = YAML.parse(readFileSync(path, 'utf8')) as { topics?: unknown } | null
    return Array.isArray(parsed?.topics)
        ? parsed.topics as Array<Record<string, unknown>>
        : []
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('goal routes', () => {
    it('creates a goal and bootstraps project goal docs in the default workspace', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const response = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: '  Ship Goal Autopilot  ',
                description: 'Create the foundation API',
                successCriteria: '- Goal API works'
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goal: {
                id: string
                goalKey: string
                title: string
                autopilotEnabled: boolean
                deployRequiresApproval: boolean
            }
        }

        expect(body.goal.title).toBe('Ship Goal Autopilot')
        expect(body.goal.goalKey).toBe('ship-goal-autopilot')
        expect(body.goal.autopilotEnabled).toBe(true)
        expect(body.goal.deployRequiresApproval).toBe(true)

        const docsRoot = join(workspacePath, '.hopi', 'docs')
        expect(existsSync(join(workspacePath, '.hopi', 'preference.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'index.md'))).toBe(true)

        const goalDir = join(docsRoot, 'goals', body.goal.goalKey)
        expect(existsSync(join(goalDir, 'design.md'))).toBe(true)
        expect(existsSync(join(goalDir, 'todo.yml'))).toBe(true)
        expect(existsSync(join(goalDir, 'decisions.yml'))).toBe(true)
        expect(existsSync(join(goalDir, 'events.jsonl'))).toBe(true)
        const designMarkdown = readFileSync(join(goalDir, 'design.md'), 'utf8')
        expect(designMarkdown).toContain('# Design')
        expect(designMarkdown).toContain('## Problem')
        expect(designMarkdown).toContain('## Architecture')
        expect(designMarkdown).toContain('## Revision Notes')
        const todoYaml = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todoYaml).toContain('goal:')
        expect(todoYaml).toContain('goalKey: ship-goal-autopilot')
        expect(todoYaml).toContain('items:')
        expect(todoYaml).toContain('status: planned')
        expect(todoYaml).not.toContain('goals:')

        const goalFile = join(goalDir, 'goal.md')
        expect(existsSync(goalFile)).toBe(true)
        const goalMarkdown = readFileSync(goalFile, 'utf8')
        expect(goalMarkdown).toContain('goalKey: ship-goal-autopilot')
        expect(goalMarkdown).toContain('title: "Ship Goal Autopilot"')
        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: body.goal.id
        })
        expect(tasks).toHaveLength(1)
        expect(tasks[0]).toMatchObject({
            projectId: project.id,
            goalId: body.goal.id,
            title: 'Clarify goal and plan first iteration',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default',
            agentFlavor: null,
            model: null,
            permissionMode: 'safe-yolo',
            modelMode: null
        })
        expect(tasks[0]?.contract).toContain('Use the brainstorming protocol to clarify this Goal')
        expect(tasks[0]?.contract).toContain(`.hopi/docs/goals/${body.goal.goalKey}/goal.md`)
        expect(tasks[0]?.contract).toContain(`.hopi/docs/goals/${body.goal.goalKey}/design.md`)
        expect(tasks[0]?.contract).toContain('Update the design doc before creating or reshaping engineering tasks')
        expect(tasks[0]?.contract).toContain('HOPI_ACTIONS JSON packet')
        expect(tasks[0]?.contract).toContain('Involved Files / Areas')
        expect(tasks[0]?.contract).toContain('likely areas and unknowns')
        expect(tasks[0]?.contract).toContain('HOPI applies the final JSON packet')
        expect(tasks[0]?.contract).not.toContain('HOPI MCP')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('does not duplicate the initial planner task after the goals list repairs docs', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const createResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Plan One Goal'
            })
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as { goal: { id: string } }

        const goalsResponse = await app.request(`/api/projects/${project.id}/goals`)
        expect(goalsResponse.status).toBe(200)

        const tasksResponse = await app.request(`/api/projects/${project.id}/tasks?goalId=${createBody.goal.id}`)
        expect(tasksResponse.status).toBe(200)
        const tasksBody = await tasksResponse.json() as { tasks: Array<{ title: string }> }
        expect(tasksBody.tasks.filter((task) => task.title === 'Clarify goal and plan first iteration')).toHaveLength(1)
    })

    it('treats repeated goal create requests with the same client request id as one goal', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const requestBody = {
            title: 'Retry Safe Goal',
            description: 'Create once even when the client retries.',
            clientRequestId: 'create-goal-request-1'
        }

        const firstResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody)
        })
        const secondResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody)
        })

        expect(firstResponse.status).toBe(200)
        expect(secondResponse.status).toBe(200)
        const firstBody = await firstResponse.json() as { goal: { id: string; goalKey: string } }
        const secondBody = await secondResponse.json() as { goal: { id: string; goalKey: string } }
        expect(secondBody.goal).toEqual(firstBody.goal)
        expect(store.goals.listGoalsByProjectAndNamespace(project.id, 'default')).toHaveLength(1)

        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: firstBody.goal.id
        })
        expect(tasks.filter((task) => task.title === 'Clarify goal and plan first iteration')).toHaveLength(1)
    })

    it('pauses and resumes goal automation with a project resume tick', async () => {
        const store = new Store(':memory:')
        const realtimeEvents: Array<{ type: string; projectId?: string }> = []
        const ticks: Array<{ namespace: string; projectId: string }> = []
        const engine = {
            handleRealtimeEvent(event: { type: string; projectId?: string }) {
                realtimeEvents.push(event)
            },
            requestAutoRunTick(namespace: string, projectId: string) {
                ticks.push({ namespace, projectId })
            }
        } as unknown as SyncEngine
        const app = createTestApp(store, engine)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Pause Goal Automation' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as {
            goal: {
                id: string
                automationPausedAt?: number | null
            }
        }
        expect(goalBody.goal.automationPausedAt).toBeNull()
        realtimeEvents.length = 0

        const pauseResponse = await app.request(`/api/goals/${goalBody.goal.id}/automation/pause`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(pauseResponse.status).toBe(200)
        const pauseBody = await pauseResponse.json() as {
            goal: {
                id: string
                automationPausedAt?: number | null
            }
        }
        expect(typeof pauseBody.goal.automationPausedAt).toBe('number')
        expect(ticks).toEqual([])

        const resumeResponse = await app.request(`/api/goals/${goalBody.goal.id}/automation/resume`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(resumeResponse.status).toBe(200)
        const resumeBody = await resumeResponse.json() as {
            goal: {
                id: string
                automationPausedAt?: number | null
            }
        }
        expect(resumeBody.goal.automationPausedAt).toBeNull()
        expect(ticks).toEqual([{ namespace: 'default', projectId: project.id }])
        expect(realtimeEvents.filter((event) => event.type === 'project-updated').length).toBe(2)
    })

    it('creates and resolves goal decision topics', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Resolve Topic Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }
        events.length = 0

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'goal',
                title: '  Pick rollout policy  ',
                body: 'Should autopilot deploy automatically?',
                blocking: false
            })
        })
        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as {
            topic: {
                id: string
                scope: string
                title: string
                blocking: boolean
                status: string
            }
        }
        expect(topicBody.topic.scope).toBe('goal')
        expect(topicBody.topic.title).toBe('Pick rollout policy')
        expect(topicBody.topic.blocking).toBe(false)
        expect(topicBody.topic.status).toBe('waiting')
        expect(store.goalDecisionTopics.listByGoalAndNamespace(goalBody.goal.id, 'default')).toEqual([])
        expect(readGoalDecisionTopics(workspacePath, goalBody.goal.goalKey)).toContainEqual(expect.objectContaining({
            id: topicBody.topic.id,
            scope: 'goal',
            title: 'Pick rollout policy',
            status: 'waiting',
            blocking: false
        }))
        expect(events).toEqual([
            expect.objectContaining({
                type: 'project-updated',
                projectId: project.id,
                namespace: 'default'
            })
        ])
        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: ' Require human approval. ' })
        })
        expect(resolveResponse.status).toBe(200)
        const resolveBody = await resolveResponse.json() as {
            topic: {
                status: string
                resolution: string | null
            }
        }
        expect(resolveBody.topic.status).toBe('resolved')
        expect(resolveBody.topic.resolution).toBe('Require human approval.')
        expect(store.goalDecisionTopics.listByGoalAndNamespace(goalBody.goal.id, 'default')).toEqual([])
        expect(readGoalDecisionTopics(workspacePath, goalBody.goal.goalKey)).toContainEqual(expect.objectContaining({
            id: topicBody.topic.id,
            scope: 'goal',
            title: 'Pick rollout policy',
            status: 'resolved',
            resolution: 'Require human approval.'
        }))
        expect(events).toEqual([
            expect.objectContaining({
                type: 'project-updated',
                projectId: project.id,
                namespace: 'default'
            })
        ])
    })

    it('rejects decision topic creation without an explicit scope', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Scoped Decision Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }

        const response = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Missing scope',
                body: 'This should be rejected.'
            })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })

    it('allows task-scoped decision topics to target yaml-only todo refs', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Yaml Decision Target Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            `  goalKey: ${goalBody.goal.goalKey}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: Yaml Decision Target Goal',
            'items:',
            '  - ref: yaml-only-choice',
            '    status: candidate',
            '    title: Pick interaction model',
            '    body: Needs product direction.',
            ''
        ].join('\n'), 'utf8')

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'task',
                taskId: 'yaml-only-choice',
                title: 'Choose interaction model',
                body: 'Should this use tabs or a command palette?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        expect(readGoalDecisionTopics(workspacePath, goalBody.goal.goalKey)).toContainEqual(expect.objectContaining({
            scope: 'task',
            taskId: 'yaml-only-choice',
            title: 'Choose interaction model',
            blocking: true
        }))

        const taskResponse = await app.request('/api/tasks/yaml-only-choice')
        expect(taskResponse.status).toBe(200)
        const taskBody = await taskResponse.json() as { task: { status: string; blockedSource?: string | null } }
        expect(taskBody.task.status).toBe('blocked')
        expect(taskBody.task.blockedSource).toBe('decision')
    })

    it('lists and resolves decision topics from decisions.yml when the db has no topic rows', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Docs Topic Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'decisions.yml')
        writeFileSync(decisionsPath, [
            'version: 1',
            'topics:',
            '  - id: docs-topic-1',
            `    projectId: ${project.id}`,
            `    goalId: ${goalBody.goal.id}`,
            '    scope: goal',
            '    taskId: null',
            '    title: Confirm ownership',
            '    body: Which component owns this flow?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 100',
            '    updatedAt: 100',
            ''
        ].join('\n'), 'utf8')

        const listResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`)

        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as { topics: Array<{ id: string; title: string; status: string }> }
        expect(listBody.topics).toEqual([
            expect.objectContaining({
                id: 'docs-topic-1',
                title: 'Confirm ownership',
                status: 'waiting'
            })
        ])

        const resolveResponse = await app.request('/api/goal-topics/docs-topic-1/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Deck library owns it.' })
        })

        expect(resolveResponse.status).toBe(200)
        const resolveBody = await resolveResponse.json() as { topic: { id: string; status: string; resolution: string | null } }
        expect(resolveBody.topic).toMatchObject({
            id: 'docs-topic-1',
            status: 'resolved',
            resolution: 'Deck library owns it.'
        })
        expect(store.goalDecisionTopics.listByGoalAndNamespace(goalBody.goal.id, 'default')).toEqual([])
        expect(readGoalDecisionTopics(workspacePath, goalBody.goal.goalKey)).toContainEqual(expect.objectContaining({
            id: 'docs-topic-1',
            status: 'resolved',
            resolution: 'Deck library owns it.'
        }))
    })

    it('backfills legacy db-only decision topics into decisions.yml without keeping db as canonical', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Legacy Decision Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }
        store.goalDecisionTopics.create({
            id: 'legacy-db-topic',
            projectId: project.id,
            goalId: goalBody.goal.id,
            namespace: 'default',
            scope: 'goal',
            title: 'Legacy DB question',
            body: 'This was created before docs-only decisions.',
            blocking: true
        })

        const response = await app.request(`/api/goals/${goalBody.goal.id}/topics`)

        expect(response.status).toBe(200)
        const body = await response.json() as { topics: Array<{ id: string; title: string; status: string }> }
        expect(body.topics).toEqual([
            expect.objectContaining({
                id: 'legacy-db-topic',
                title: 'Legacy DB question',
                status: 'waiting'
            })
        ])
        expect(readGoalDecisionTopics(workspacePath, goalBody.goal.goalKey)).toContainEqual(expect.objectContaining({
            id: 'legacy-db-topic',
            scope: 'goal',
            title: 'Legacy DB question',
            status: 'waiting',
            blocking: true
        }))
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'decisions.yml')
        const backfilledDocument = YAML.parse(readFileSync(decisionsPath, 'utf8')) as { legacyDecisionTopicsBackfilledAt?: unknown }
        expect(typeof backfilledDocument.legacyDecisionTopicsBackfilledAt).toBe('number')

        writeFileSync(decisionsPath, [
            'version: 1',
            `legacyDecisionTopicsBackfilledAt: ${backfilledDocument.legacyDecisionTopicsBackfilledAt}`,
            'topics: []',
            ''
        ].join('\n'), 'utf8')

        const afterDeletionResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`)

        expect(afterDeletionResponse.status).toBe(200)
        const afterDeletionBody = await afterDeletionResponse.json() as { topics: Array<{ id: string }> }
        expect(afterDeletionBody.topics).toEqual([])
    })

    it('backfills a planner seed task for existing planning goals with no tasks', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'existing-goal-without-seed',
            projectId: project.id,
            namespace: 'default',
            title: 'Existing goal without seed',
            status: 'planning'
        })

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: goal.id
        })
        expect(tasks).toHaveLength(1)
        expect(tasks[0]).toMatchObject({
            goalId: goal.id,
            title: 'Clarify goal and plan first iteration',
            status: 'planning',
            source: 'planner',
            agentFlavor: null,
            model: null,
            permissionMode: 'safe-yolo',
            modelMode: null
        })
        expect(readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'goal.md'), 'utf8')).toContain(goal.title)
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${tasks[0]?.id}`)
        expect(todo).toContain('status: planned')
        expect(todo).toContain('title: Clarify goal and plan first iteration')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-added',
            projectId: project.id,
            namespace: 'default',
            taskId: tasks[0]?.id
        }))
    })

    it('marks a linked task as blocked by decision when creating a blocking decision topic', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Blocking Topic Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const task = store.tasks.createTask({
            id: 'task-needs-human-input',
            projectId: project.id,
            goalId: goalBody.goal.id,
            title: 'Needs human input',
            status: 'planning',
            workflowProfile: 'default'
        })
        events.length = 0

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'task',
                taskId: task.id,
                title: 'Clarify product direction',
                body: 'Which option should the planner choose?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        const waitingTask = store.tasks.getTaskByNamespace(task.id, 'default')
        expect(waitingTask?.status).toBe('blocked')
        expect(waitingTask?.blockedSource).toBe('decision')
        expect(waitingTask?.blockedReason).toBe('Clarify product direction: Which option should the planner choose?')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('keeps a decision-blocked task in its canonical lane after the last blocking topic is resolved', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Resume Blocked Task Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const task = store.tasks.createTask({
            id: 'task-waiting-for-answer',
            projectId: project.id,
            goalId: goalBody.goal.id,
            title: 'Waiting for answer',
            status: 'planning',
            workflowProfile: 'default'
        })

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'task',
                taskId: task.id,
                title: 'Clarify acceptance',
                body: 'Which acceptance criteria should apply?',
                blocking: true
            })
        })
        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { id: string } }
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('blocked')
        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Use the documented success criteria.' })
        })

        expect(resolveResponse.status).toBe(200)
        const resumedTask = store.tasks.getTaskByNamespace(task.id, 'default')
        expect(resumedTask?.status).toBe('planning')
        expect(resumedTask?.handoff).toContain('Resolved DecisionTopic: Clarify acceptance')
        expect(resumedTask?.handoff).toContain('Which acceptance criteria should apply?')
        expect(resumedTask?.handoff).toContain('Use the documented success criteria.')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('blocks and reactivates a goal for a goal-level blocking decision topic', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Milestone Review Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'goal',
                title: 'Review milestone',
                body: 'Is the architecture spine good enough for the next content phase?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { id: string } }
        expect(store.goals.getGoalByNamespace(goalBody.goal.id, 'default')?.status).toBe('blocked')

        const listResponse = await app.request(`/api/projects/${project.id}/goals`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            goals: Array<{
                id: string
                blockedSource?: string | null
                blockedReason?: string | null
            }>
        }
        const listedGoal = listBody.goals.find((candidate) => candidate.id === goalBody.goal.id)
        expect(listedGoal?.blockedSource).toBe('decision')
        expect(listedGoal?.blockedReason).toContain('Review milestone')

        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Move to content validation next.' })
        })

        expect(resolveResponse.status).toBe(200)
        expect(store.goals.getGoalByNamespace(goalBody.goal.id, 'default')?.status).toBe('active')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('reactivates a blocked goal after the last blocking decision topic is resolved', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Blocked Goal Decision' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        store.goals.updateGoalByNamespace(goalBody.goal.id, 'default', { status: 'blocked' })

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'goal',
                title: 'Choose route',
                body: 'Which story route should the next planner use?',
                blocking: true
            })
        })
        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { id: string } }
        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Use MainMenu as the story entry.' })
        })

        expect(resolveResponse.status).toBe(200)
        expect(store.goals.getGoalByNamespace(goalBody.goal.id, 'default')?.status).toBe('active')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('rejects topic creation when taskId belongs to another goal', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = await createProject(app, createTempWorkspace())

        const firstGoalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'First Goal' })
        })
        expect(firstGoalResponse.status).toBe(200)
        const firstGoalBody = await firstGoalResponse.json() as { goal: { id: string } }

        const secondGoalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Second Goal' })
        })
        expect(secondGoalResponse.status).toBe(200)
        const secondGoalBody = await secondGoalResponse.json() as { goal: { id: string } }

        const task = store.tasks.createTask({
            id: 'task-first-goal',
            projectId: project.id,
            title: 'Task in first goal',
            status: 'planning',
            workflowProfile: 'default',
            goalId: firstGoalBody.goal.id
        })

        const response = await app.request(`/api/goals/${secondGoalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                scope: 'task',
                taskId: task.id,
                title: 'Invalid task link',
                body: 'This task belongs to a different goal.'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Task not found' })
        expect(store.goalDecisionTopics.listByGoalAndNamespace(secondGoalBody.goal.id, 'default')).toHaveLength(0)
    })

    it('returns an empty todo response when the goal todo document is missing', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-missing-todo',
            projectId: project.id,
            namespace: 'default',
            title: 'Goal without todo',
            status: 'planning'
        })

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            exists: false,
            path: join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'todo.yml'),
            rawYaml: null,
            sections: [],
            updatedAt: null
        })
    })

    it('parses the selected goal todo reservoir from yaml', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-selected-todo',
            projectId: project.id,
            namespace: 'default',
            title: 'Selected Goal',
            status: 'planning'
        })
        const otherGoal = store.goals.createGoal({
            id: 'goal-other-todo',
            projectId: project.id,
            namespace: 'default',
            title: 'Other Goal',
            status: 'planning'
        })
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            `  - goalId: ${otherGoal.id}`,
            '    title: Other Goal',
            '    items:',
            '      - ref: ignore-other-goal',
            '        status: ready',
            '        title: Ignore other goal',
            `  - goalId: ${goal.id}`,
            '    title: Selected Goal',
            '    items:',
            '      - ref: first-executable-slice',
            '        status: ready',
            '        title: Implement first executable slice',
            '        body: "Objective: Ship the first slice."',
            '      - ref: tune-generated-task-contracts',
            '        status: candidate',
            '        title: Tune generated task contracts',
            '        body: "Notes: Keep contracts lightweight."',
            '      - ref: add-manual-todo-editing',
            '        status: deferred',
            '        title: Add manual todo editing',
            '        body: "Reason: Planner should write first."',
            '      - ref: expedition-map',
            '        status: promoted',
            '        title: Implement expedition map',
            '        taskId: task-promoted-1',
            '      - ref: clarify-goal-intent',
            '        status: done',
            '        title: Clarify goal intent',
            '        taskId: task-done-1',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            exists: boolean
            rawYaml: string | null
            updatedAt: number | null
            sections: Array<{ kind: string; title: string; body: string; taskId?: string | null }>
        }
        expect(body.exists).toBe(true)
        expect(body.rawYaml).toContain(`goalId: ${goal.id}`)
        expect(typeof body.updatedAt).toBe('number')
        expect(body.sections.map((section) => section.kind)).toEqual([
            'ready',
            'candidate',
            'candidate',
            'promoted',
            'done'
        ])
        expect(body.sections[0]).toMatchObject({
            title: 'Implement first executable slice',
            body: expect.stringContaining('Ship the first slice.'),
            taskId: 'first-executable-slice'
        })
        expect(body.sections[1]).toMatchObject({
            title: 'Tune generated task contracts',
            body: expect.stringContaining('Keep contracts lightweight.')
        })
        expect(body.sections[3]).toMatchObject({
            title: 'Implement expedition map',
            taskId: 'expedition-map'
        })
        expect(body.sections[4]).toMatchObject({
            title: 'Clarify goal intent',
            taskId: 'clarify-goal-intent'
        })
        expect(body.rawYaml).not.toContain('Ignore other goal')
    })

    it('previews docs-backed goals missing from the local database', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        const goalDir = join(docsRoot, 'goals', 'mobile-remote-control')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            'goalKey: mobile-remote-control',
            'title: Mobile remote control',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Mobile remote control',
            '',
            '## Objective',
            '',
            'Control local agent sessions from mobile.'
        ].join('\n'))
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: mobile-remote-control',
            '    items:',
            '      - ref: reconnect-indicator',
            '        status: ready',
            '        title: Add reconnect indicator',
            '      - ref: resume-affordance',
            '        status: candidate',
            '        title: Improve resume affordance',
            ''
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goal-docs/import-preview`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ goalKey: string; existsInDb: boolean; readyCount: number; candidateCount: number }>
            errors: unknown[]
        }
        expect(body.errors).toEqual([])
        expect(body.goals).toEqual([
            expect.objectContaining({
                goalKey: 'mobile-remote-control',
                existsInDb: false,
                readyCount: 1,
                candidateCount: 1
            })
        ])
    })

    it('auto-imports docs-backed goals when listing project goals', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals'), { recursive: true })
        writeFileSync(join(docsRoot, 'goals', 'mobile-remote-control.md'), [
            '---',
            'goalKey: mobile-remote-control',
            'title: Mobile remote control',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Mobile remote control',
            '',
            '## Objective',
            '',
            'Control local agent sessions from mobile.',
            '',
            '## Success Criteria',
            '',
            '- Mobile user can inspect current sessions.'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ id: string; goalKey: string; title: string; status: string }>
        }
        expect(body.goals).toEqual([
            expect.objectContaining({
                goalKey: 'mobile-remote-control',
                title: 'Mobile remote control',
                status: 'active'
            })
        ])
        const goal = store.goals.getGoalByGoalKeyAndNamespace(project.id, 'default', 'mobile-remote-control')
        expect(goal?.successCriteria).toBe('- Mobile user can inspect current sessions.')
        expect(store.tasks.listTasksByProjectAndNamespace(project.id, 'default', { goalId: goal?.id ?? 'missing' })).toEqual([])
    })

    it('relinks a legacy goal document keyed by the local goal id without overwriting goal fields', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const legacyGoal = store.goals.createGoal({
            id: 'legacy-goal-id',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'local-portable-key',
            title: 'Local goal title',
            description: 'Local DB description wins.',
            status: 'active',
            successCriteria: 'Local DB criteria wins.',
            autopilotEnabled: false,
            deployRequiresApproval: false,
            currentFocus: 'Local DB focus wins.'
        })
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals'), { recursive: true })
        writeFileSync(join(docsRoot, 'goals', 'legacy-goal-id.md'), [
            '---',
            'goalKey: legacy-goal-id',
            'title: "Document title must not overwrite"',
            'status: blocked',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Document title must not overwrite',
            '',
            '## Objective',
            '',
            'Document objective must not overwrite.',
            '',
            '## Success Criteria',
            '',
            'Document criteria must not overwrite.',
            '',
            '## Current Focus',
            '',
            'Document focus must not overwrite.'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ id: string; goalKey: string; title: string; status: string }>
        }
        expect(body.goals).toEqual([
            expect.objectContaining({
                id: legacyGoal.id,
                goalKey: 'legacy-goal-id',
                title: 'Local goal title',
                status: 'active'
            })
        ])
        expect(store.goals.listGoalsByProjectAndNamespace(project.id, 'default', { includeArchived: true })).toHaveLength(1)
        expect(store.goals.getGoalByNamespace(legacyGoal.id, 'default')).toMatchObject({
            goalKey: 'legacy-goal-id',
            title: 'Local goal title',
            description: 'Local DB description wins.',
            status: 'active',
            successCriteria: 'Local DB criteria wins.',
            autopilotEnabled: false,
            deployRequiresApproval: false,
            currentFocus: 'Local DB focus wins.'
        })
    })

    it('archives a previously imported legacy-doc duplicate without changing the canonical goal', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const canonicalGoal = store.goals.createGoal({
            id: 'legacy-goal-id',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'local-portable-key',
            title: 'Local goal title',
            description: 'Local DB description wins.',
            status: 'active',
            successCriteria: 'Local DB criteria wins.',
            autopilotEnabled: false,
            deployRequiresApproval: false,
            currentFocus: 'Local DB focus wins.'
        })
        const importedDuplicate = store.goals.createGoal({
            id: 'imported-duplicate-goal',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'legacy-goal-id',
            title: 'Document title duplicate',
            description: 'Imported duplicate description',
            status: 'planning'
        })
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals'), { recursive: true })
        writeFileSync(join(docsRoot, 'goals', 'legacy-goal-id.md'), [
            '---',
            'goalKey: legacy-goal-id',
            'title: "Document title duplicate"',
            'status: blocked',
            '---',
            '',
            '# Document title duplicate'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ id: string; goalKey: string; title: string; status: string }>
        }
        expect(body.goals).toEqual([
            expect.objectContaining({
                id: canonicalGoal.id,
                goalKey: 'legacy-goal-id',
                title: 'Local goal title',
                status: 'active'
            })
        ])
        expect(store.goals.getGoalByNamespace(canonicalGoal.id, 'default')).toMatchObject({
            goalKey: 'legacy-goal-id',
            title: 'Local goal title',
            description: 'Local DB description wins.',
            status: 'active',
            successCriteria: 'Local DB criteria wins.',
            autopilotEnabled: false,
            deployRequiresApproval: false,
            currentFocus: 'Local DB focus wins.',
            archivedAt: null
        })
        expect(store.goals.getGoalByNamespace(importedDuplicate.id, 'default')?.archivedAt).toEqual(expect.any(Number))
    })

    it('prefers legacy uuid goal docs over generated goal slug docs during fresh migration', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals'), { recursive: true })
        const legacyGoalKey = '11111111-1111-4111-8111-111111111111'
        writeFileSync(join(docsRoot, 'goals', `${legacyGoalKey}.md`), [
            '---',
            `goalKey: ${legacyGoalKey}`,
            'title: "Same Chinese Title"',
            'status: active',
            '---',
            '',
            '# Same Chinese Title',
            '',
            '## Objective',
            '',
            'Rich legacy objective should migrate.'
        ].join('\n'))
        writeFileSync(join(docsRoot, 'goals', 'goal-2.md'), [
            '---',
            'goalKey: goal-2',
            'title: "Same Chinese Title"',
            'status: active',
            '---',
            '',
            '# Same Chinese Title',
            '',
            '## Objective',
            '',
            'Generated fallback objective should be ignored.'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ id: string; goalKey: string; title: string; description: string | null }>
        }
        expect(body.goals).toEqual([
            expect.objectContaining({
                goalKey: legacyGoalKey,
                title: 'Same Chinese Title',
                description: 'Rich legacy objective should migrate.'
            })
        ])
        expect(store.goals.listGoalsByProjectAndNamespace(project.id, 'default', { includeArchived: true })).toHaveLength(1)
    })

    it('imports docs-backed goals without creating task cards', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals'), { recursive: true })
        writeFileSync(join(docsRoot, 'goals', 'mobile-remote-control.md'), [
            '---',
            'goalKey: mobile-remote-control',
            'title: Mobile remote control',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Mobile remote control',
            '',
            '## Objective',
            '',
            'Control local agent sessions from mobile.',
            '',
            '## Success Criteria',
            '',
            '- Mobile user can inspect current sessions.'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goal-docs/import`, {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            imported: Array<{ goalKey: string; goalId: string }>
        }
        expect(body.imported).toHaveLength(1)
        const goal = store.goals.getGoalByGoalKeyAndNamespace(project.id, 'default', 'mobile-remote-control')
        expect(goal).toMatchObject({
            title: 'Mobile remote control',
            description: 'Control local agent sessions from mobile.',
            successCriteria: '- Mobile user can inspect current sessions.',
            status: 'active',
            autopilotEnabled: true,
            deployRequiresApproval: true
        })
        expect(store.tasks.listTasksByProjectAndNamespace(project.id, 'default', { goalId: goal?.id ?? 'missing' })).toEqual([])
    })

    it('returns 404 when the goal belongs to another project', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const firstProject = await createProject(app, createTempWorkspace())
        const secondProject = await createProject(app, createTempWorkspace())
        const goal = store.goals.createGoal({
            id: 'goal-in-second-project',
            projectId: secondProject.id,
            namespace: 'default',
            title: 'Second project goal',
            status: 'planning'
        })

        const response = await app.request(`/api/projects/${firstProject.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Goal not found' })
    })
})
