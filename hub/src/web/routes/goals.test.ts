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

function parseEventLog(raw: string): Array<Record<string, unknown>> {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
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
        expect(existsSync(join(docsRoot, 'index.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'decisions.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'tech-debt.md'))).toBe(true)
        expect(existsSync(join(workspacePath, '.hopi', 'preference.md'))).toBe(true)

        const goalDir = join(docsRoot, 'goals', body.goal.goalKey)
        expect(existsSync(join(goalDir, 'design.md'))).toBe(true)
        expect(existsSync(join(goalDir, 'todo.yml'))).toBe(true)
        expect(existsSync(join(goalDir, 'decisions.yml'))).toBe(true)
        expect(existsSync(join(goalDir, 'planning-requests.yml'))).toBe(true)
        expect(existsSync(join(goalDir, 'events.jsonl'))).toBe(true)
        expect(existsSync(join(goalDir, 'write-trace.jsonl'))).toBe(true)

        const goalFile = join(goalDir, 'goal.md')
        expect(existsSync(goalFile)).toBe(true)
        const goalMarkdown = readFileSync(goalFile, 'utf8')
        expect(goalMarkdown).toContain('goalKey: ship-goal-autopilot')
        expect(goalMarkdown).toContain('title: "Ship Goal Autopilot"')
        const eventsLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('goal_created_from_goals_api')
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

    it('migrates a legacy docs preference file to the repo-level canonical path during bootstrap', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const legacyDocsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(legacyDocsRoot, { recursive: true })
        writeFileSync(join(legacyDocsRoot, 'preference.md'), '# Preferences\n\n- Prefer reviewer summaries with file links.\n')
        const project = await createProject(app, workspacePath)

        const response = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Bootstrap Legacy Preference Goal' })
        })

        expect(response.status).toBe(200)
        expect(readFileSync(join(workspacePath, '.hopi', 'preference.md'), 'utf8')).toContain('Prefer reviewer summaries with file links.')
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

    it('rejects automation pause and resume for stale DB-only goals', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = await createProject(app, createTempWorkspace())
        const goal = store.goals.createGoal({
            id: 'goal-stale-automation-route',
            projectId: project.id,
            namespace: 'default',
            title: 'Stale Automation Goal',
            status: 'planning'
        })

        const pauseResponse = await app.request(`/api/goals/${goal.id}/automation/pause`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(pauseResponse.status).toBe(404)
        expect(await pauseResponse.json()).toEqual({ error: 'Goal not found' })

        const resumeResponse = await app.request(`/api/goals/${goal.id}/automation/resume`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(resumeResponse.status).toBe(404)
        expect(await resumeResponse.json()).toEqual({ error: 'Goal not found' })

        expect(store.goals.getGoalByNamespace(goal.id, 'default')).toMatchObject({
            title: 'Stale Automation Goal',
            automationPausedAt: null
        })
    })

    it('returns docs-backed goal fields from automation pause and resume responses', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Overlay Goal Response' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as {
            goal: {
                id: string
                goalKey: string
            }
        }

        const goalFile = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'goal.md')
        writeFileSync(goalFile, [
            '---',
            `goalKey: ${goalBody.goal.goalKey}`,
            'title: "Goal Title From Docs"',
            'status: active',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Goal Title From Docs',
            '',
            '## Objective',
            '',
            'Goal description from docs.',
            '',
            '## Success Criteria',
            '',
            '- Goal response overlays docs.',
            '',
            '## Current Focus',
            '',
            'Docs-backed current focus.',
            ''
        ].join('\n'))

        const pauseResponse = await app.request(`/api/goals/${goalBody.goal.id}/automation/pause`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(pauseResponse.status).toBe(200)
        const pauseBody = await pauseResponse.json() as {
            goal: {
                title: string
                status: string
                description: string | null
                currentFocus: string | null
                automationPausedAt?: number | null
            }
        }
        expect(pauseBody.goal).toMatchObject({
            title: 'Goal Title From Docs',
            status: 'active',
            description: 'Goal description from docs.',
            currentFocus: 'Docs-backed current focus.'
        })
        expect(typeof pauseBody.goal.automationPausedAt).toBe('number')

        const resumeResponse = await app.request(`/api/goals/${goalBody.goal.id}/automation/resume`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(resumeResponse.status).toBe(200)
        const resumeBody = await resumeResponse.json() as {
            goal: {
                title: string
                status: string
                description: string | null
                currentFocus: string | null
                automationPausedAt?: number | null
            }
        }
        expect(resumeBody.goal).toMatchObject({
            title: 'Goal Title From Docs',
            status: 'active',
            description: 'Goal description from docs.',
            currentFocus: 'Docs-backed current focus.',
            automationPausedAt: null
        })
        const eventsLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('goal_automation_paused_from_goals_api')
        expect(eventsLog).toContain('goal_automation_resumed_from_goals_api')
    })

    it('updates goal-owned docs when patching durable goal fields', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const createResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Original Goal Title' })
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as { goal: { id: string; goalKey: string } }
        const goalFile = join(workspacePath, '.hopi', 'docs', 'goals', createBody.goal.goalKey, 'goal.md')
        writeFileSync(goalFile, [
            '---',
            `goalKey: ${createBody.goal.goalKey}`,
            'title: "Docs Before Patch"',
            'status: blocked',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Docs Before Patch',
            '',
            '## Objective',
            '',
            'Goal description from docs before patch.',
            '',
            '## Success Criteria',
            '',
            '- Preserve docs-backed event snapshots.',
            '',
            '## Current Focus',
            '',
            'Manual docs focus before patch.',
            ''
        ].join('\n'))

        const patchResponse = await app.request(`/api/goals/${createBody.goal.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Renamed Goal Title',
                description: 'Documented objective from route patch.',
                status: 'active',
                successCriteria: '- Route patch updates the durable goal doc.',
                autopilotEnabled: false,
                deployRequiresApproval: false,
                currentFocus: 'Patch route file-native sync'
            })
        })

        expect(patchResponse.status).toBe(200)
        const goalDoc = readFileSync(goalFile, 'utf8')
        expect(goalDoc).toContain('title: Renamed Goal Title')
        expect(goalDoc).toContain('status: active')
        expect(goalDoc).toContain('autopilotEnabled: false')
        expect(goalDoc).toContain('deployRequiresApproval: false')
        expect(goalDoc).toContain('# Renamed Goal Title')
        expect(goalDoc).toContain('Documented objective from route patch.')
        expect(goalDoc).toContain('- Route patch updates the durable goal doc.')
        expect(goalDoc).toContain('Patch route file-native sync')
        const eventsLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', createBody.goal.goalKey, 'events.jsonl'), 'utf8')
        expect(eventsLog).toContain('goal_updated_from_goals_api')
        const goalUpdatedEvent = [...parseEventLog(eventsLog)]
            .reverse()
            .find((event: Record<string, unknown>) => event.action === 'goal_updated_from_goals_api')
        expect(goalUpdatedEvent?.before).toMatchObject({
            status: 'blocked',
            title: 'Docs Before Patch',
            currentFocus: 'Manual docs focus before patch.'
        })
        expect(goalUpdatedEvent?.after).toMatchObject({
            status: 'active',
            title: 'Renamed Goal Title'
        })
        expect(typeof (goalUpdatedEvent?.after as Record<string, unknown> | undefined)?.currentFocus).toBe('string')
        expect(String((goalUpdatedEvent?.after as Record<string, unknown>).currentFocus)).toContain('Patch route file-native sync')

        const todoResponse = await app.request(`/api/projects/${project.id}/goals/${createBody.goal.id}/todo`)
        expect(todoResponse.status).toBe(200)
        const todoBody = await todoResponse.json() as {
            board: {
                goal: {
                    title: string | null
                }
            }
        }
        expect(todoBody.board.goal.title).toBe('Renamed Goal Title')
    })

    it('rejects goal patches for stale DB-only goals', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = await createProject(app, createTempWorkspace())
        const goal = store.goals.createGoal({
            id: 'goal-stale-patch-route',
            projectId: project.id,
            namespace: 'default',
            title: 'Stale Patch Goal',
            status: 'planning'
        })

        const response = await app.request(`/api/goals/${goal.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Should Not Patch',
                status: 'blocked'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Goal not found' })
        expect(store.goals.getGoalByNamespace(goal.id, 'default')).toMatchObject({
            title: 'Stale Patch Goal',
            status: 'planning'
        })
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
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'decisions.yml')
        const createdDecisions = readFileSync(decisionsPath, 'utf8')
        expect(createdDecisions).not.toContain('legacyDecisionTopicsBackfilledAt:')
        expect(createdDecisions).toContain('title: Pick rollout policy')
        expect(createdDecisions).toContain('status: waiting')
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
        const resolvedDecisions = readFileSync(decisionsPath, 'utf8')
        expect(resolvedDecisions).toContain('status: resolved')
        expect(resolvedDecisions).toContain('resolution: Require human approval.')
        expect(events).toEqual([
            expect.objectContaining({
                type: 'project-updated',
                projectId: project.id,
                namespace: 'default'
            })
        ])
    })

    it('returns an empty docs-first topic list when decisions.yml has no topics', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Backfill Decision Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }

        const response = await app.request(`/api/goals/${goalBody.goal.id}/topics`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            topics: Array<{
                id: string
                title: string
                body: string
                status: string
            }>
        }
        expect(body.topics).toEqual([])

        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'decisions.yml')
        const decisions = readFileSync(decisionsPath, 'utf8')
        expect(decisions).toContain('decisions: []')
    })

    it('rejects stale DB-only goals when listing decision topics', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-stale-topics-list',
            projectId: project.id,
            namespace: 'default',
            title: 'Stale Topics Goal',
            status: 'planning'
        })

        const response = await app.request(`/api/goals/${goal.id}/topics`)

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Goal not found' })
    })

    it('does not resolve unknown docs-first decision topics through the API', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Resolve Legacy Decision Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string; goalKey: string } }

        const response = await app.request('/api/goal-topics/topic-missing/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Need explicit migration first.' })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Topic not found' })
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goalBody.goal.goalKey, 'decisions.yml')
        const decisions = readFileSync(decisionsPath, 'utf8')
        expect(decisions).not.toContain('topic-missing')
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
        expect(todo).toContain('kind: planning')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('title: Clarify goal and plan first iteration')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('goal_planner_seed_backfilled')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-added',
            projectId: project.id,
            namespace: 'default',
            taskId: tasks[0]?.id
        }))
    })

    it('does not backfill a planner seed task when a planning goal already has docs-only todo items', async () => {
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
            id: 'existing-goal-with-docs-work',
            projectId: project.id,
            namespace: 'default',
            title: 'Existing goal with docs work',
            status: 'planning'
        })

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal.goalKey}`,
            `  goalId: ${goal.id}`,
            `  title: ${goal.title}`,
            'items:',
            '  - ref: docs-only-planning-task',
            '    kind: engineering',
            '    status: planned',
            '    title: Existing docs-only work',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: goal.id
        })
        expect(tasks).toHaveLength(0)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: docs-only-planning-task')
        expect(todo).not.toContain('Clarify goal and plan first iteration')
    })

    it('still backfills a planner seed task when docs-only todo items are reservoir candidate notes', async () => {
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
            id: 'existing-goal-with-reservoir-notes',
            projectId: project.id,
            namespace: 'default',
            title: 'Existing goal with reservoir notes',
            status: 'planning'
        })

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal.goalKey}`,
            `  goalId: ${goal.id}`,
            `  title: ${goal.title}`,
            'items:',
            '  - ref: reservoir-note',
            '    kind: planning',
            '    status: planned',
            '    tag: candidate',
            '    title: Maybe later',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))

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
            source: 'planner'
        })
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: reservoir-note')
        expect(todo).toContain('tag: candidate')
        expect(todo).toContain(`ref: ${tasks[0]?.id}`)
    })

    it('still backfills a planner seed task when only stale DB goal rows exist', async () => {
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
            id: 'existing-goal-with-db-only-task',
            projectId: project.id,
            namespace: 'default',
            title: 'Existing goal with DB-only task',
            status: 'planning'
        })

        store.tasks.createTask({
            id: 'db-only-goal-task',
            projectId: project.id,
            goalId: goal.id,
            goalTodoRef: null,
            title: 'Stale DB-only task',
            status: 'planning',
            workflowProfile: 'default'
        })

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const tasks = store.tasks.listTasksByProjectAndNamespace(project.id, 'default', {
            goalId: goal.id
        })
        expect(tasks).toHaveLength(2)
        const plannerSeed = tasks.find((task) => task.source === 'planner')
        expect(plannerSeed).toMatchObject({
            goalId: goal.id,
            title: 'Clarify goal and plan first iteration',
            status: 'planning'
        })
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${plannerSeed?.id}`)
        expect(todo).toContain('title: Clarify goal and plan first iteration')
        expect(todo).not.toContain('Stale DB-only task')
    })

    it('preserves the linked task lane when creating a blocking decision topic', async () => {
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
            body: JSON.stringify({ title: 'Blocking Topic Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const goal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(goal).not.toBeNull()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id)
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal?.goalKey ?? goalBody.goal.id}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: Blocking Topic Goal',
            'items:',
            '  - ref: task-needs-human-input',
            '    kind: engineering',
            '    status: planned',
            '    title: Needs human input',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        const task = store.tasks.createTask({
            id: 'task-needs-human-input',
            projectId: project.id,
            goalId: goalBody.goal.id,
            goalTodoRef: 'task-needs-human-input',
            title: 'Needs human input',
            status: 'planning',
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
        const blockedTask = store.tasks.getTaskByNamespace(task.id, 'default')
        expect(blockedTask?.status).toBe('planning')
        expect(blockedTask?.goalTodoRef).toBe(task.id)
        expect(blockedTask?.blockedReason).toBe('Which option should the planner choose?')
        expect(blockedTask?.blockedSource).toBe('decision')
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id, 'todo.yml'), 'utf8')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id, 'events.jsonl'), 'utf8')
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('status: blocked')
        expect(todo).toContain('kind: decision')
        expect(todo).not.toContain('kind: decision_topic')
        expect(eventLog).toContain('todo_item_blocked_by_decision')
        expect(eventLog).toContain('source":"createGoalDecisionTopic"')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('creates blocking decision topics for docs-only goal todo items', async () => {
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
            body: JSON.stringify({ title: 'Docs-only blocking topic goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const goal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(goal).not.toBeNull()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id)
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal?.goalKey ?? goalBody.goal.id}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: Docs-only blocking topic goal',
            'items:',
            '  - ref: docs-only-decision-task',
            '    kind: engineering',
            '    status: planned',
            '    title: Docs-only task waiting for an answer',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        expect(store.tasks.getTaskByNamespace('docs-only-decision-task', 'default')).toBeNull()
        events.length = 0

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                taskId: 'docs-only-decision-task',
                title: 'Clarify docs-only task',
                body: 'Which implementation path should this docs-only task take?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { taskId: string | null } }
        expect(topicBody.topic.taskId).toBe('docs-only-decision-task')
        const blockedTask = store.tasks.getTaskByNamespace('docs-only-decision-task', 'default')
        expect(blockedTask?.status).toBe('planning')
        expect(blockedTask?.goalTodoRef).toBe('docs-only-decision-task')
        expect(blockedTask?.blockedReason).toBe('Which implementation path should this docs-only task take?')
        expect(blockedTask?.blockedSource).toBe('decision')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(todo).toContain('ref: docs-only-decision-task')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('kind: decision')
        expect(eventLog).toContain('todo_item_blocked_by_decision')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: 'docs-only-decision-task',
            projectId: project.id,
            namespace: 'default'
        }))
    })

    it('rejects topic creation when the goal only exists as a stale DB-only row', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-stale-topic-create',
            projectId: project.id,
            namespace: 'default',
            title: 'Stale Topic Create Goal',
            status: 'planning'
        })

        const response = await app.request(`/api/goals/${goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Need a decision',
                body: 'Should not create decisions for stale DB-only goals.'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Goal not found' })
    })

    it('returns a blocked task to planned after the last blocking decision topic is resolved', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const ticks: Array<{ namespace: string; projectId: string }> = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            },
            requestAutoRunTick(namespace: string, projectId: string) {
                ticks.push({ namespace, projectId })
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Resume Blocked Task Goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const goal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(goal).not.toBeNull()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id)
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal?.goalKey ?? goalBody.goal.id}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: Resume Blocked Task Goal',
            'items:',
            '  - ref: task-waiting-for-answer',
            '    kind: engineering',
            '    status: planned',
            '    title: Waiting for answer',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        const task = store.tasks.createTask({
            id: 'task-waiting-for-answer',
            projectId: project.id,
            goalId: goalBody.goal.id,
            goalTodoRef: 'task-waiting-for-answer',
            title: 'Waiting for answer',
            status: 'planning',
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
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('planning')
        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Use the documented success criteria.' })
        })

        expect(resolveResponse.status).toBe(200)
        const resumedTask = store.tasks.getTaskByNamespace(task.id, 'default')
        expect(resumedTask?.status).toBe('planning')
        expect(resumedTask?.goalTodoRef).toBe(task.id)
        expect(resumedTask?.blockedReason).toBeNull()
        expect(resumedTask?.blockedSource).toBeNull()
        expect(resumedTask?.handoff).toContain('Resolved DecisionTopic: Clarify acceptance')
        expect(resumedTask?.handoff).toContain('Which acceptance criteria should apply?')
        expect(resumedTask?.handoff).toContain('Use the documented success criteria.')
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id, 'todo.yml'), 'utf8')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id, 'events.jsonl'), 'utf8')
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('kind: decision')
        expect(eventLog).toContain('todo_item_unblocked_from_decision')
        expect(eventLog).toContain('source":"resolveGoalDecisionTopic"')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: task.id,
            projectId: project.id,
            namespace: 'default'
        }))
        expect(ticks).toContainEqual({
            namespace: 'default',
            projectId: project.id
        })
    })

    it('resolves blocking decision topics for docs-only goal todo items', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const ticks: Array<{ namespace: string; projectId: string }> = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            },
            requestAutoRunTick(namespace: string, projectId: string) {
                ticks.push({ namespace, projectId })
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'docs-only-resolve-goal',
            projectId: project.id,
            namespace: 'default',
            title: 'Docs-only resolve goal',
            status: 'planning'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal.goalKey}`,
            `  goalId: ${goal.id}`,
            `  title: ${goal.title}`,
            'items:',
            '  - ref: docs-only-blocked-task',
            '    kind: engineering',
            '    status: planned',
            '    title: Docs-only blocked task',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []',
            '    blockedBy:',
            '      - kind: decision',
            '        summary: Which docs-only approach should we choose?',
            '        updatedAt: 1'
        ].join('\n'))
        writeFileSync(join(goalDir, 'decisions.yml'), [
            'version: 1',
            'decisions:',
            '  - id: docs-only-topic',
            '    scope: task',
            '    taskId: docs-only-blocked-task',
            '    title: Clarify docs-only approach',
            '    body: Which docs-only approach should we choose?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 1',
            '    updatedAt: 1'
        ].join('\n'))
        expect(store.tasks.getTaskByNamespace('docs-only-blocked-task', 'default')).toBeNull()
        events.length = 0

        const resolveResponse = await app.request('/api/goal-topics/docs-only-topic/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Use the docs-first task projection path.' })
        })

        expect(resolveResponse.status).toBe(200)
        const resumedTask = store.tasks.getTaskByNamespace('docs-only-blocked-task', 'default')
        expect(resumedTask?.status).toBe('planning')
        expect(resumedTask?.goalTodoRef).toBe('docs-only-blocked-task')
        expect(resumedTask?.blockedReason).toBeNull()
        expect(resumedTask?.blockedSource).toBeNull()
        expect(resumedTask?.handoff).toContain('Resolved DecisionTopic: Clarify docs-only approach')
        expect(resumedTask?.handoff).toContain('Use the docs-first task projection path.')
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('kind: decision')
        expect(eventLog).toContain('todo_item_unblocked_from_decision')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task-updated',
            taskId: 'docs-only-blocked-task',
            projectId: project.id,
            namespace: 'default'
        }))
        expect(ticks).toContainEqual({
            namespace: 'default',
            projectId: project.id
        })
    })

    it('blocks and reactivates a goal for a goal-level blocking decision topic', async () => {
        const store = new Store(':memory:')
        const events: unknown[] = []
        const ticks: Array<{ namespace: string; projectId: string }> = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            },
            requestAutoRunTick(namespace: string, projectId: string) {
                ticks.push({ namespace, projectId })
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

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
                title: 'Review milestone',
                body: 'Is the architecture spine good enough for the next content phase?',
                blocking: true
            })
        })

        expect(topicResponse.status).toBe(200)
        const topicBody = await topicResponse.json() as { topic: { id: string } }
        expect(store.goals.getGoalByNamespace(goalBody.goal.id, 'default')?.status).toBe('blocked')
        const goalAfterBlock = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalAfterBlock?.goalKey ?? goalBody.goal.id, 'goal.md'), 'utf8')).toContain('status: blocked')
        const blockedEventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalAfterBlock?.goalKey ?? goalBody.goal.id, 'events.jsonl'), 'utf8')
        expect(blockedEventLog).toContain('goal_blocked_by_decision')
        expect(blockedEventLog).toContain('source":"createGoalDecisionTopic"')
        events.length = 0

        const resolveResponse = await app.request(`/api/goal-topics/${topicBody.topic.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution: 'Move to content validation next.' })
        })

        expect(resolveResponse.status).toBe(200)
        const activeGoal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(activeGoal?.status).toBe('active')
        expect(readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', activeGoal?.goalKey ?? goalBody.goal.id, 'goal.md'), 'utf8')).toContain('status: active')
        const resolvedEventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', activeGoal?.goalKey ?? goalBody.goal.id, 'events.jsonl'), 'utf8')
        expect(resolvedEventLog).toContain('goal_unblocked_from_decision')
        expect(resolvedEventLog).toContain('source":"resolveGoalDecisionTopic"')
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId: project.id,
            namespace: 'default'
        }))
        expect(ticks).toContainEqual({
            namespace: 'default',
            projectId: project.id
        })
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
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Blocked Goal Decision' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const goal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(goal).not.toBeNull()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id)
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal?.goalKey ?? goalBody.goal.id}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: Blocked Goal Decision',
            'items:',
            '  - ref: task-waiting-for-goal-answer',
            '    kind: planning',
            '    status: planned',
            '    title: Plan after answer',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        store.goals.updateGoalByNamespace(goalBody.goal.id, 'default', { status: 'blocked' })

        const task = store.tasks.createTask({
            id: 'task-waiting-for-goal-answer',
            projectId: project.id,
            goalId: goalBody.goal.id,
            goalTodoRef: 'task-waiting-for-goal-answer',
            title: 'Plan after answer',
            status: 'planning',
            source: 'planner',
            workflowProfile: 'default'
        })

        const topicResponse = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                taskId: task.id,
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
                taskId: task.id,
                title: 'Invalid task link',
                body: 'This task belongs to a different goal.'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Task not found' })
    })

    it('rejects topic creation when taskId only exists as a stale DB-only goal row', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        const goalResponse = await app.request(`/api/projects/${project.id}/goals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'DB-only decision topic goal' })
        })
        expect(goalResponse.status).toBe(200)
        const goalBody = await goalResponse.json() as { goal: { id: string } }
        const goal = store.goals.getGoalByNamespace(goalBody.goal.id, 'default')
        expect(goal).toBeTruthy()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal?.goalKey ?? goalBody.goal.id)
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goal?.goalKey ?? goalBody.goal.id}`,
            `  goalId: ${goalBody.goal.id}`,
            '  title: DB-only decision topic goal',
            'items: []'
        ].join('\n'))

        store.tasks.createTask({
            id: 'db-only-decision-task',
            projectId: project.id,
            goalId: goalBody.goal.id,
            title: 'DB-only stale decision task',
            status: 'planning',
            workflowProfile: 'default'
        })

        const response = await app.request(`/api/goals/${goalBody.goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                taskId: 'db-only-decision-task',
                title: 'Invalid stale DB-only task link',
                body: 'This should not create a docs-backed decision topic.'
            })
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Task not found' })
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('db-only-decision-task')
    })

    it('rejects decision topic reads when the goal project has no docs-backed workspace', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = store.projects.createProject({
            id: 'project-no-workspace-topics',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Goal Project'
        })
        const goal = store.goals.createGoal({
            id: 'goal-no-workspace-topics',
            projectId: project.id,
            namespace: 'default',
            title: 'Goal without workspace',
            status: 'planning'
        })

        const response = await app.request(`/api/goals/${goal.id}/topics`)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Workspace docs root unavailable'
        })
    })

    it('rejects decision topic creation when the goal project has no docs-backed workspace', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const project = store.projects.createProject({
            id: 'project-no-workspace-create-topic',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Goal Project'
        })
        const goal = store.goals.createGoal({
            id: 'goal-no-workspace-create-topic',
            projectId: project.id,
            namespace: 'default',
            title: 'Goal without workspace',
            status: 'planning'
        })

        const response = await app.request(`/api/goals/${goal.id}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Decide next direction',
                body: 'Need a durable decision before more work starts.'
            })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Workspace docs root unavailable'
        })
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
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goal.goalKey}`,
            `title: "${goal.title}"`,
            'status: planning',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            `# ${goal.title}`,
            '',
            '## Objective',
            '',
            'Keep the goal docs-backed even when todo.yml is missing.',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            board: {
                goal: {
                    goalKey: goal.goalKey,
                    goalId: goal.id,
                    title: goal.title
                },
                items: []
            },
            tasks: []
        })
    })

    it('rejects stale DB-only goals when reading the selected goal todo board', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-stale-selected-todo',
            projectId: project.id,
            namespace: 'default',
            title: 'Stale Selected Goal',
            status: 'planning'
        })

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Goal not found' })
    })

    it('ignores a legacy goal-local todo.yml when reading the selected goal todo board', async () => {
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
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        const goalDir = join(docsRoot, 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goals:',
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
            board: {
                goal: { goalId: string | null; title: string | null }
                items: Array<{ ref: string; status: string; tag?: string | null; title: string; taskId: string | null }>
            }
            tasks: Array<{ goalTodoRef: string | null; status: string }>
        }
        expect(body.board.goal).toMatchObject({
            goalId: goal.id,
            title: 'Selected Goal'
        })
        expect(body.board.items).toEqual([])
        expect(body.tasks).toEqual([])
        expect(readFileSync(join(goalDir, 'todo.yml'), 'utf8')).toContain('goals:')
    })

    it('ignores legacy root todo.yml when the goal-local todo document is missing', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'goal-root-legacy-ignored',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'goal-root-legacy-ignored',
            title: 'Selected Goal',
            status: 'planning'
        })
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        const goalDir = join(docsRoot, 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goal.goalKey}`,
            `title: "${goal.title}"`,
            'status: planning',
            'autopilotEnabled: true',
            'deployRequiresApproval: true',
            '---',
            '',
            `# ${goal.title}`,
            '',
            '## Objective',
            '',
            'Ensure root legacy todo.yml stays ignored.',
            ''
        ].join('\n'), 'utf8')
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            `  - goalId: ${goal.id}`,
            '    title: Selected Goal',
            '    items:',
            '      - ref: legacy-root-item',
            '        status: ready',
            '        title: Should not be read implicitly'
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/projects/${project.id}/goals/${goal.id}/todo`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            board: { items: unknown[] }
            tasks: unknown[]
        }
        expect(body.board.items).toEqual([])
        expect(body.tasks).toEqual([])
    })

    it('ignores a legacy goal-local todo.yml when previewing docs-backed goals missing from the local database', async () => {
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
                readyCount: 0,
                candidateCount: 0
            })
        ])
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('goals:')
        expect(todo).toContain('status: ready')
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

    it('hides stale DB-only goals without canonical docs when listing project goals', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)

        store.goals.createGoal({
            id: 'legacy-db-only-goal',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'legacy-db-only-goal',
            title: 'Legacy DB-only goal',
            status: 'active'
        })

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{ id: string; goalKey: string; title: string }>
        }
        expect(body.goals).toEqual([])
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-db-only-goal', 'goal.md'))).toBe(false)
    })

    it('prefers canonical goal.md metadata over stale DB goal fields when listing goals', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = store.goals.createGoal({
            id: 'docs-backed-goal',
            projectId: project.id,
            namespace: 'default',
            goalKey: 'docs-backed-goal',
            title: 'DB Goal Title',
            description: 'DB objective should stay stale.',
            status: 'planning',
            successCriteria: 'DB criteria should stay stale.',
            autopilotEnabled: true,
            deployRequiresApproval: true,
            currentFocus: 'DB focus should stay stale.'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goal.goalKey}`,
            'title: "Goal Doc Title"',
            'status: blocked',
            'autopilotEnabled: false',
            'deployRequiresApproval: false',
            '---',
            '',
            '# Goal Doc Title',
            '',
            '## Objective',
            '',
            'Goal doc objective should drive the route response.',
            '',
            '## Success Criteria',
            '',
            '- Goal doc criteria should drive the route response.',
            '',
            '## Current Focus',
            '',
            'Goal doc focus should drive the route response.',
            ''
        ].join('\n'))

        const response = await app.request(`/api/projects/${project.id}/goals`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            goals: Array<{
                id: string
                goalKey: string
                title: string
                status: string
                description: string | null
                successCriteria: string | null
                currentFocus: string | null
                autopilotEnabled: boolean
                deployRequiresApproval: boolean
            }>
        }
        expect(body.goals).toEqual([
            expect.objectContaining({
                id: goal.id,
                goalKey: goal.goalKey,
                title: 'Goal Doc Title',
                status: 'blocked',
                description: 'Goal doc objective should drive the route response.',
                successCriteria: '- Goal doc criteria should drive the route response.',
                currentFocus: 'Goal doc focus should drive the route response.',
                autopilotEnabled: false,
                deployRequiresApproval: false
            })
        ])
        expect(store.tasks.listTasksByProjectAndNamespace(project.id, 'default', { goalId: goal.id })).toEqual([])
        expect(store.goals.getGoalByNamespace(goal.id, 'default')).toMatchObject({
            title: 'DB Goal Title',
            description: 'DB objective should stay stale.',
            status: 'planning',
            successCriteria: 'DB criteria should stay stale.',
            autopilotEnabled: true,
            deployRequiresApproval: true,
            currentFocus: 'DB focus should stay stale.'
        })
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
