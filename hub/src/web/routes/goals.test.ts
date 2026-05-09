import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createGoalsRoutes } from './goals'
import { createProjectsRoutes } from './projects'

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
                title: string
                autopilotEnabled: boolean
                deployRequiresApproval: boolean
            }
        }

        expect(body.goal.title).toBe('Ship Goal Autopilot')
        expect(body.goal.autopilotEnabled).toBe(true)
        expect(body.goal.deployRequiresApproval).toBe(true)

        const docsRoot = join(workspacePath, '.hopi', 'docs')
        expect(existsSync(join(docsRoot, 'index.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'todo.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'decisions.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'tech-debt.md'))).toBe(true)

        const goalFile = join(docsRoot, 'goals', `${body.goal.id}.md`)
        expect(existsSync(goalFile)).toBe(true)
        expect(readFileSync(goalFile, 'utf8')).toContain('Ship Goal Autopilot')
        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: body.goal.id
        })
        expect(tasks).toHaveLength(1)
        expect(tasks[0]).toMatchObject({
            projectId: project.id,
            goalId: body.goal.id,
            title: 'Clarify goal and plan first iteration',
            status: 'planned',
            source: 'planner',
            workflowProfile: 'default',
            agentFlavor: 'codex',
            model: 'gpt-5.5',
            permissionMode: 'safe-yolo',
            modelMode: null
        })
        expect(tasks[0]?.contract).toContain('Use the brainstorming protocol to clarify this Goal')
        expect(tasks[0]?.contract).toContain(`.hopi/docs/goals/${body.goal.id}.md`)
        expect(tasks[0]?.contract).toContain('HOPI_ACTIONS JSON packet')
        expect(tasks[0]?.contract).toContain('HOPI applies the final JSON packet')
        expect(tasks[0]?.contract).not.toContain('HOPI MCP')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId: project.id,
            namespace: 'default'
        }))
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
        const project = await createProject(app, createTempWorkspace())

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Resolve Topic Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        events.length = 0

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: '  Pick rollout policy  ',
                body: 'Should autopilot deploy automatically?',
                blocking: false
            })
        })
        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as {
            topic: {
                id: string
                title: string
                blocking: boolean
                status: string
            }
        }
        expect(topicBody.topic.title).toBe('Pick rollout policy')
        expect(topicBody.topic.blocking).toBe(false)
        expect(topicBody.topic.status).toBe('waiting')
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
        expect(events).toEqual([
            expect.objectContaining({
                type: 'project-updated',
                projectId: project.id,
                namespace: 'default'
            })
        ])
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
            status: 'planned',
            source: 'planner',
            agentFlavor: 'codex',
            model: 'gpt-5.5',
            permissionMode: 'safe-yolo',
            modelMode: null
        })
        expect(readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', `${goal.id}.md`), 'utf8')).toContain(goal.title)
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-added',
            projectId: project.id,
            namespace: 'default',
            taskId: tasks[0]?.id
        }))
    })

    it('moves a linked task to blocked when creating a blocking decision topic', async () => {
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
            status: 'planned',
            workflowProfile: 'default'
        })
        events.length = 0

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                taskId: task.id,
                title: 'Clarify product direction',
                body: 'Which option should the planner choose?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('blocked')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('returns a blocked task to planned after the last blocking decision topic is resolved', async () => {
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
            status: 'planned',
            workflowProfile: 'default'
        })

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
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
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('planned')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
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
            status: 'planned',
            workflowProfile: 'default',
            goalId: firstGoalBody.goal.id
        })

        const response = await app.request(`/api/goals/${secondGoalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
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
            path: join(workspacePath, '.hopi', 'docs', 'todo.md'),
            rawMarkdown: null,
            sections: [],
            updatedAt: null
        })
    })

    it('parses the selected goal todo reservoir from markdown', async () => {
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
        writeFileSync(join(docsRoot, 'todo.md'), [
            '# HOPI Todo',
            '',
            `## Goal \`${otherGoal.id}\` - Other Goal`,
            '',
            '### Ready candidates',
            '',
            '- [ready] Ignore other goal',
            '',
            `## Goal \`${goal.id}\` - Selected Goal`,
            '',
            '### Ready candidates',
            '',
            '#### 1. Implement first executable slice',
            '',
            '**Objective:** Ship the first slice.',
            '',
            '### Candidate reservoir',
            '',
            '- [candidate] Tune generated task contracts',
            '  - Notes: Keep contracts lightweight.',
            '',
            '### Deferred',
            '',
            '- [deferred] Add manual todo editing',
            '  - Reason: Planner should write first.',
            '',
            '### Done / promoted',
            '',
            '- [promoted] Implement expedition map -> task `task-promoted-1`',
            '- [done] Clarify goal intent -> task `task-done-1`',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            exists: boolean
            rawMarkdown: string | null
            updatedAt: number | null
            sections: Array<{ kind: string; title: string; body: string; taskId?: string | null }>
        }
        expect(body.exists).toBe(true)
        expect(body.rawMarkdown).toContain(`Goal \`${goal.id}\``)
        expect(typeof body.updatedAt).toBe('number')
        expect(body.sections.map((section) => section.kind)).toEqual([
            'ready',
            'candidate',
            'deferred',
            'promoted',
            'done'
        ])
        expect(body.sections[0]).toMatchObject({
            title: 'Implement first executable slice',
            body: expect.stringContaining('Ship the first slice.'),
            taskId: null
        })
        expect(body.sections[1]).toMatchObject({
            title: 'Tune generated task contracts',
            body: expect.stringContaining('Keep contracts lightweight.')
        })
        expect(body.sections[3]).toMatchObject({
            title: 'Implement expedition map',
            taskId: 'task-promoted-1'
        })
        expect(body.sections[4]).toMatchObject({
            title: 'Clarify goal intent',
            taskId: 'task-done-1'
        })
        expect(body.rawMarkdown).not.toContain('Ignore other goal')
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
