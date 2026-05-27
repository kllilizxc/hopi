import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createGoalsRoutes } from './goals'
import { createProjectsRoutes } from './projects'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-assistant-'))
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
            name: 'Goal Assistant Project',
            workspaces: [{ path: workspacePath }]
        })
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { project: { id: string } }
    return body.project
}

async function createGoal(app: Hono, projectId: string, title = 'Assistant Goal'): Promise<{ id: string; goalKey: string }> {
    const response = await app.request(`/api/projects/${projectId}/goals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title })
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { goal: { id: string; goalKey: string } }
    return body.goal
}

function readGoalEvents(workspacePath: string, goalKey: string): Array<Record<string, unknown>> {
    const path = join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('goal assistant commands', () => {
    it('creates a visible planner-role task for request_planning and appends a server-authored event', async () => {
        const store = new Store(':memory:')
        const realtimeEvents: Array<{ type: string; taskId?: string }> = []
        const engine = {
            handleRealtimeEvent(event: { type: string; taskId?: string }) {
                realtimeEvents.push(event)
            }
        } as SyncEngine
        const app = createTestApp(store, engine)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Plan Assistant Work')

        const response = await app.request(`/api/goals/${goal.id}/assistant-commands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                command: 'request_planning',
                intent: 'Break the onboarding work into two independent implementation tasks.',
                relatedTaskIds: [],
                urgency: 'high',
                initiator: {
                    kind: 'cto_assistant',
                    sessionId: 'assistant-session',
                    messageSeq: 42
                }
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: true
            commandId: string
            task: { id: string; lane: string; role?: string | null; source?: string | null }
        }
        expect(body.task).toMatchObject({
            lane: 'planned',
            role: 'planner',
            source: 'cto_assistant'
        })

        const storedTask = store.tasks.getTaskByNamespace(body.task.id, 'default') as unknown as {
            status: string
            role?: string | null
            source?: string | null
            contract?: string | null
        }
        expect(storedTask).toMatchObject({
            status: 'planning',
            role: 'planner',
            source: 'cto_assistant'
        })
        expect(storedTask.contract).toContain('Break the onboarding work into two independent implementation tasks.')
        expect(storedTask.contract).toContain('Read goal.md, design.md, todo.yml, decisions.yml, events.jsonl')
        expect(storedTask.contract).toContain('Update design.md before creating or reshaping substantial engineering tasks')
        expect(realtimeEvents).toContainEqual(expect.objectContaining({
            type: 'task-added',
            taskId: body.task.id
        }))

        expect(readGoalEvents(workspacePath, goal.goalKey)).toContainEqual(expect.objectContaining({
            writer: 'hopi_server',
            action: 'planner_task_created',
            entity: { type: 'task', id: body.task.id },
            after: expect.objectContaining({
                lane: 'planned',
                role: 'planner',
                source: 'cto_assistant'
            }),
            reason: 'Break the onboarding work into two independent implementation tasks.',
            initiator: {
                kind: 'cto_assistant',
                sessionId: 'assistant-session',
                messageSeq: 42
            },
            source: { kind: 'command', id: body.commandId }
        }))
    })

    it('answers a decision topic through the assistant command without changing the task lane', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Answer Decision Goal')
        const task = store.tasks.createTask({
            id: 'task-needs-decision',
            projectId: project.id,
            goalId: goal.id,
            title: 'Needs decision',
            status: 'planning',
            role: 'generator',
            source: 'manual',
            workflowProfile: 'default'
        } as Parameters<typeof store.tasks.createTask>[0])
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'decisions.yml')
        writeFileSync(decisionsPath, [
            'version: 1',
            'topics:',
            '  - id: docs-assistant-topic',
            `    projectId: ${project.id}`,
            `    goalId: ${goal.id}`,
            `    taskId: ${task.id}`,
            '    title: Choose scope',
            '    body: Should this include the settings page?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 100',
            '    updatedAt: 100',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/goals/${goal.id}/assistant-commands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                command: 'answer_decision_topic',
                topicId: 'docs-assistant-topic',
                answer: 'Exclude settings for this slice.',
                reason: 'User explicitly chose the smaller scope.',
                initiator: {
                    kind: 'cto_assistant',
                    sessionId: 'assistant-session',
                    messageSeq: 43
                }
            })
        })

        expect(response.status).toBe(200)
        const resolvedTask = store.tasks.getTaskByNamespace(task.id, 'default')
        expect(resolvedTask?.status).toBe('planning')
        expect(resolvedTask?.blockedReason).toBeNull()
        expect(resolvedTask?.handoff).toContain('Resolved DecisionTopic: Choose scope')
        expect(resolvedTask?.handoff).toContain('Exclude settings for this slice.')
        expect(store.goalDecisionTopics.listByGoalAndNamespace(goal.id, 'default')).toEqual([])
        const decisionsYaml = readFileSync(decisionsPath, 'utf8')
        expect(decisionsYaml).toContain('id: docs-assistant-topic')
        expect(decisionsYaml).toContain('status: resolved')
        expect(decisionsYaml).toContain('resolution: Exclude settings for this slice.')

        expect(readGoalEvents(workspacePath, goal.goalKey)).toContainEqual(expect.objectContaining({
            writer: 'hopi_server',
            action: 'decision_topic_resolved',
            entity: { type: 'decision_topic', id: 'docs-assistant-topic' },
            reason: 'User explicitly chose the smaller scope.',
            after: expect.objectContaining({
                status: 'resolved',
                taskId: task.id
            })
        }))
    })

    it('does not reactivate a blocked goal when answering a task-scoped decision topic', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Task Decision Does Not Unblock Goal')
        store.goals.updateGoalByNamespace(goal.id, 'default', { status: 'blocked' })
        const task = store.tasks.createTask({
            id: 'task-scoped-decision',
            projectId: project.id,
            goalId: goal.id,
            title: 'Task scoped decision',
            status: 'planning',
            role: 'generator',
            source: 'manual',
            workflowProfile: 'default'
        } as Parameters<typeof store.tasks.createTask>[0])
        const decisionsPath = join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'decisions.yml')
        writeFileSync(decisionsPath, [
            'version: 1',
            'topics:',
            '  - id: docs-task-topic',
            `    projectId: ${project.id}`,
            `    goalId: ${goal.id}`,
            '    scope: task',
            `    taskId: ${task.id}`,
            '    title: Choose task scope',
            '    body: Should this include the settings page?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 100',
            '    updatedAt: 100',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/goals/${goal.id}/assistant-commands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                command: 'answer_decision_topic',
                topicId: 'docs-task-topic',
                answer: 'Keep it task-local.',
                initiator: { kind: 'cto_assistant' }
            })
        })

        expect(response.status).toBe(200)
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('blocked')
    })

    it('inspects goal state with canonical lanes, derived blockers, recent events, and preference memory', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const workspacePath = createTempWorkspace()
        const project = await createProject(app, workspacePath)
        const goal = await createGoal(app, project.id, 'Inspect Goal State')
        writeFileSync(join(workspacePath, '.hopi', 'preference.md'), 'Prefer small autonomous batches.\n', 'utf8')
        const task = store.tasks.createTask({
            id: 'task-derived-blocker',
            projectId: project.id,
            goalId: goal.id,
            title: 'Blocked by decision',
            status: 'planning',
            role: 'generator',
            source: 'manual',
            workflowProfile: 'default'
        } as Parameters<typeof store.tasks.createTask>[0])
        writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'decisions.yml'), [
            'version: 1',
            'topics:',
            '  - id: inspect-doc-topic',
            `    projectId: ${project.id}`,
            `    goalId: ${goal.id}`,
            `    taskId: ${task.id}`,
            '    title: Pick content route',
            '    body: Which route should be implemented?',
            '    status: waiting',
            '    blocking: true',
            '    resolution: null',
            '    createdAt: 100',
            '    updatedAt: 100',
            ''
        ].join('\n'), 'utf8')

        const response = await app.request(`/api/goals/${goal.id}/assistant-commands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                command: 'inspect_goal_state'
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: true
            state: {
                preferenceMarkdown: string
                designMarkdown: string
                tasks: Array<{ id: string; lane: string; blockers: Array<{ kind: string; topicId?: string }> }>
                openDecisionTopics: Array<{ title: string }>
                recentEvents: Array<{ action: string }>
            }
        }
        expect(body.state.preferenceMarkdown).toBe('Prefer small autonomous batches.\n')
        expect(body.state.designMarkdown).toContain('# Design: Inspect Goal State')
        expect(body.state.designMarkdown).toContain('## Architecture')
        expect(body.state.tasks).toContainEqual(expect.objectContaining({
            id: task.id,
            lane: 'planned',
            blockers: [expect.objectContaining({ kind: 'decision' })]
        }))
        expect(body.state.openDecisionTopics).toContainEqual(expect.objectContaining({
            title: 'Pick content route'
        }))
        expect(Array.isArray(body.state.recentEvents)).toBe(true)
    })
})
