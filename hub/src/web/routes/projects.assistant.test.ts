import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { Session } from '@hopi/protocol/types'
import { Store, type StoredSession } from '../../store'
import { createProjectAssistantIntervention } from '../../sync/projectAssistant'
import type { SyncEngine } from '../../sync/syncEngine'
import { createGoalsRoutes } from './goals'
import { createProjectsRoutes } from './projects'

function runtimeSession(stored: StoredSession): Session {
    return {
        id: stored.id,
        namespace: stored.namespace,
        seq: stored.seq,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        active: true,
        activeAt: stored.activeAt ?? stored.createdAt,
        metadata: stored.metadata as Session['metadata'],
        metadataVersion: stored.metadataVersion,
        agentState: null,
        agentStateVersion: stored.agentStateVersion,
        thinking: false,
        thinkingAt: 0
    }
}

function engineFor(store: Store): SyncEngine {
    const sessions = new Map<string, Session>()
    return {
        async spawnSession(
            machineId: string,
            directory: string,
            agent?: string,
            model?: string,
            _yolo?: boolean,
            _sessionType?: string,
            _worktreeName?: string,
            _resumeSessionId?: string,
            _worktreeWorkspacePaths?: string[],
            _worktreeTargetBranch?: string,
            sessionTag?: string
        ) {
            const stored = store.sessions.getOrCreateSession(
                sessionTag ?? `assistant-route-${sessions.size + 1}`,
                {
                    path: directory,
                    host: 'localhost',
                    machineId,
                    flavor: agent,
                    model,
                    startedFromRunner: true
                },
                null,
                'default'
            )
            sessions.set(stored.id, runtimeSession(stored))
            return { type: 'success' as const, sessionId: stored.id }
        },
        async waitForSessionActive() {
            return true
        },
        async sendMessage(sessionId: string, payload: { text: string; localId?: string | null }) {
            store.messages.addMessage(sessionId, {
                role: 'user',
                content: {
                    type: 'text',
                    text: payload.text
                }
            }, payload.localId ?? undefined)
        },
        getSessionByNamespace(sessionId: string) {
            return sessions.get(sessionId) ?? null
        },
        handleRealtimeEvent(event: { sessionId?: string; namespace?: string }) {
            if (!event.sessionId) return
            const stored = store.sessions.getSessionByNamespace(event.sessionId, event.namespace ?? 'default')
            if (stored) {
                sessions.set(stored.id, runtimeSession(stored))
            }
        }
    } as unknown as SyncEngine
}

function createTestApp(store: Store): Hono {
    const app = new Hono()
    const engine = engineFor(store)
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

async function createProjectAndGoal(app: Hono, workspacePath: string): Promise<{ projectId: string; goalId: string }> {
    const projectResponse = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            machineId: 'machine-1',
            name: 'Assistant Route Project',
            workspaces: [{ path: workspacePath }]
        })
    })
    expect(projectResponse.status).toBe(200)
    const projectBody = await projectResponse.json() as { project: { id: string } }

    const goalResponse = await app.request(`/api/projects/${projectBody.project.id}/goals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Ship UI' })
    })
    expect(goalResponse.status).toBe(200)
    const goalBody = await goalResponse.json() as { goal: { id: string } }
    return { projectId: projectBody.project.id, goalId: goalBody.goal.id }
}

describe('project assistant routes', () => {
    it('creates and lists project assistant sessions', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const { projectId, goalId } = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))

        const createResponse = await app.request(`/api/projects/${projectId}/assistant-sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'normal', goalId })
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as { session: { id: string; kind: string; goalId: string } }
        expect(createBody.session.kind).toBe('normal')
        expect(createBody.session.goalId).toBe(goalId)

        const listResponse = await app.request(`/api/projects/${projectId}/assistant-sessions`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as { sessions: Array<{ id: string }>; pendingCount: number }
        expect(listBody.sessions.map((session) => session.id)).toContain(createBody.session.id)
        expect(listBody.pendingCount).toBe(0)
    })

    it('does not expose briefing as a separate assistant session kind', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const { projectId, goalId } = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))

        const response = await app.request(`/api/projects/${projectId}/assistant-sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'briefing', goalId })
        })

        expect(response.status).toBe(400)
    })

    it('writes planner mail and no longer exposes goal preference route', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const root = mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-'))
        const { projectId, goalId } = await createProjectAndGoal(app, root)

        const mailResponse = await app.request(`/api/projects/${projectId}/assistant-mail`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                goalId,
                kind: 'idea',
                body: 'Try a denser review queue.',
                source: { sessionId: 'assistant-session-1', messageId: 'message-1' }
            })
        })
        expect(mailResponse.status).toBe(200)
        const mailBody = await mailResponse.json() as { mail: { status: string } }
        expect(mailBody.mail.status).toBe('unread')

        const preferenceResponse = await app.request(`/api/projects/${projectId}/assistant-preferences`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                goalId,
                category: 'ui_product_choice',
                autonomy: 'auto_decide_and_report',
                instruction: 'Let the model decide lightweight table copy.',
                source: { sessionId: 'assistant-session-1', messageId: 'message-2' }
            })
        })
        expect(preferenceResponse.status).toBe(404)

        expect(readFileSync(join(root, '.hopi/docs/goals/ship-ui/operator/planner-mail.yml'), 'utf8')).toContain('denser review queue')
    })

    it('resolves pending intervention sessions through the assistant route', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const { projectId, goalId } = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId,
            goalId,
            interventionKey: 'goal:ship-ui:decision',
            interventionKind: 'decision_needed',
            title: 'Choose table density',
            body: 'Need a decision on density.',
            suggestedActions: [{ id: 'compact', label: 'Use compact density', recommended: true }]
        })

        const response = await app.request(`/api/projects/${projectId}/assistant-interventions/${intervention.session.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actionId: 'compact',
                note: 'Use compact density.'
            })
        })
        expect(response.status).toBe(200)

        const listResponse = await app.request(`/api/projects/${projectId}/assistant-sessions`)
        const listBody = await listResponse.json() as { sessions: Array<{ interventionStatus: string }>; pendingCount: number }
        expect(listBody.pendingCount).toBe(0)
        expect(listBody.sessions[0]?.interventionStatus).toBe('resolved')
    })

    it('activates a pending intervention without creating a different conversation', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const { projectId, goalId } = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId,
            goalId,
            interventionKey: 'goal:ship-ui:activate',
            interventionKind: 'decision_needed',
            title: 'Choose scope',
            body: 'Need a decision on scope.',
            suggestedActions: [{ id: 'answer', label: 'Answer', recommended: true }]
        })

        const response = await app.request(`/api/projects/${projectId}/assistant-sessions/${intervention.session.id}/activate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { session: { id: string } }
        expect(body.session.id).toBe(intervention.session.id)
        const messages = store.messages.getMessages(intervention.session.id, 10)
        expect(messages.some((message) => message.localId?.startsWith('auto:assistant:activation:'))).toBe(true)
    })

    it('does not resolve an intervention through another project route', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const first = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))
        const second = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: first.projectId,
            goalId: first.goalId,
            interventionKey: 'goal:first:decision',
            interventionKind: 'decision_needed',
            title: 'Choose first project direction',
            body: 'Need a decision for the first project.',
            suggestedActions: [{ id: 'answer', label: 'Answer', recommended: true }]
        })

        const response = await app.request(`/api/projects/${second.projectId}/assistant-interventions/${intervention.session.id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actionId: 'answer',
                note: 'Wrong project.'
            })
        })
        expect(response.status).toBe(404)

        const listResponse = await app.request(`/api/projects/${first.projectId}/assistant-sessions`)
        const listBody = await listResponse.json() as { sessions: Array<{ interventionStatus: string }>; pendingCount: number }
        expect(listBody.pendingCount).toBe(1)
        expect(listBody.sessions[0]?.interventionStatus).toBe('pending')
    })

    it('opens an assistant intervention when a blocking decision topic is created', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)
        const { projectId, goalId } = await createProjectAndGoal(app, mkdtempSync(join(tmpdir(), 'hopi-assistant-routes-')))

        const topicResponse = await app.request(`/api/goals/${goalId}/topics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Choose table density',
                body: 'Pick compact or comfortable density.',
                blocking: true
            })
        })
        expect(topicResponse.status).toBe(200)

        const listResponse = await app.request(`/api/projects/${projectId}/assistant-sessions`)
        const listBody = await listResponse.json() as {
            sessions: Array<{ interventionKind: string; interventionStatus: string; pending: boolean }>
            pendingCount: number
        }
        expect(listBody.pendingCount).toBe(1)
        expect(listBody.sessions[0]).toMatchObject({
            interventionKind: 'decision_needed',
            interventionStatus: 'pending',
            pending: true
        })
    })
})
