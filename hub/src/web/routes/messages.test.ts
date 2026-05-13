import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store, type StoredSession } from '../../store'
import { createProjectAssistantIntervention } from '../../sync/projectAssistant'
import type { SyncEngine } from '../../sync/syncEngine'
import { createMessagesRoutes } from './messages'

function toRouteSession(session: StoredSession) {
    return {
        id: session.id,
        namespace: session.namespace,
        seq: session.seq,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        active: session.active,
        activeAt: session.activeAt ?? session.createdAt,
        metadata: session.metadata,
        metadataVersion: session.metadataVersion,
        agentState: null,
        agentStateVersion: session.agentStateVersion,
        thinking: false,
        thinkingAt: 0
    }
}

function createTestApp(store: Store, options?: { activeSessionIds?: Set<string> }): {
    app: Hono
    sent: Array<{
        sessionId: string
        text: string
        allowedTools?: string[] | null
        disallowedTools?: string[] | null
    }>
} {
    const sent: Array<{
        sessionId: string
        text: string
        allowedTools?: string[] | null
        disallowedTools?: string[] | null
    }> = []
    const engine = {
        resolveSessionAccess(sessionId: string, namespace: string) {
            const session = store.sessions.getSessionByNamespace(sessionId, namespace)
            if (!session) {
                return { ok: false as const, reason: 'not-found' as const }
            }
            const routeSession = toRouteSession(session)
            if (options?.activeSessionIds?.has(sessionId)) {
                routeSession.active = true
            }
            return { ok: true as const, sessionId, session: routeSession }
        },
        getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }) {
            const messages = store.messages.getMessages(sessionId, options.limit, options.beforeSeq ?? undefined)
            return {
                messages: messages.map((message) => ({
                    id: message.id,
                    seq: message.seq,
                    localId: message.localId,
                    content: message.content,
                    createdAt: message.createdAt
                })),
                page: {
                    limit: options.limit,
                    beforeSeq: options.beforeSeq,
                    nextBeforeSeq: null,
                    hasMore: false
                }
            }
        },
        async sendMessage(sessionId: string, payload: {
            text: string
            localId?: string | null
            allowedTools?: string[] | null
            disallowedTools?: string[] | null
        }) {
            sent.push({
                sessionId,
                text: payload.text,
                allowedTools: payload.allowedTools,
                disallowedTools: payload.disallowedTools
            })
            store.messages.addMessage(sessionId, {
                role: 'user',
                content: {
                    type: 'text',
                    text: payload.text
                }
            }, payload.localId ?? undefined)
        }
    } as unknown as SyncEngine

    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createMessagesRoutes({ getSyncEngine: () => engine, store }))
    return { app, sent }
}

describe('messages routes', () => {
    it('rejects inactive project assistant sessions like normal sessions', async () => {
        const store = new Store(':memory:')
        const { app, sent } = createTestApp(store)
        const session = store.sessions.getOrCreateSession(
            'assistant-session',
            {
                path: '/tmp/workspace',
                host: 'hopi',
                projectId: 'project-1',
                name: 'Project Assistant',
                hopiAssistant: true,
                assistantKind: 'normal'
            },
            null,
            'default'
        )

        const response = await app.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Use the shorter scope.', localId: 'local-1' })
        })

        expect(response.status).toBe(409)
        expect(sent).toEqual([])
        const messages = store.messages.getMessages(session.id, 10)
        expect(messages).toHaveLength(0)
    })

    it('still rejects inactive non-assistant sessions', async () => {
        const store = new Store(':memory:')
        const { app, sent } = createTestApp(store)
        const session = store.sessions.getOrCreateSession(
            'agent-session',
            {
                path: '/tmp/workspace',
                host: 'localhost',
                name: 'Agent Session'
            },
            null,
            'default'
        )

        const response = await app.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'hello' })
        })

        expect(response.status).toBe(409)
        expect(sent).toEqual([])
    })

    it('sends operator console assistant messages with restricted tool metadata', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'assistant-session',
            {
                path: '/tmp/workspace',
                host: 'hopi',
                projectId: 'project-1',
                name: 'Project Assistant',
                hopiAssistant: true,
                assistantKind: 'normal',
                capabilityProfile: 'operator_console',
                flavor: 'claude'
            },
            null,
            'default'
        )
        const { app, sent } = createTestApp(store, {
            activeSessionIds: new Set([session.id])
        })

        const response = await app.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Record that preference.', localId: 'local-1' })
        })

        expect(response.status).toBe(200)
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({
            sessionId: session.id,
            text: 'Record that preference.'
        })
        expect(sent[0]?.disallowedTools).toContain('Bash')
        expect(sent[0]?.disallowedTools).toContain('Write')
        expect(sent[0]?.disallowedTools).toContain('Edit')
        expect(sent[0]?.disallowedTools).toContain('MultiEdit')
        expect(sent[0]?.disallowedTools).toContain('Task')
    })

    it('does not treat inactive synthetic intervention replies as hidden decision resolution', async () => {
        const store = new Store(':memory:')
        const { app } = createTestApp(store)
        const namespace = 'default'
        const projectId = 'project-decision-reply'
        const goalId = 'goal-decision-reply'
        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Goal',
            status: 'blocked'
        })
        const topic = store.goalDecisionTopics.create({
            id: 'topic-1',
            projectId,
            goalId,
            namespace,
            taskId: null,
            title: 'Choose scope',
            body: 'Which scope should be used?',
            blocking: true
        })
        const intervention = createProjectAssistantIntervention({
            store,
            namespace,
            projectId,
            goalId,
            taskId: null,
            interventionKey: `decision-topic:${topic.id}`,
            interventionKind: 'decision_needed',
            title: topic.title,
            body: topic.body,
            suggestedActions: [
                {
                    id: 'answer_decision',
                    label: 'Answer decision',
                    recommended: true
                }
            ]
        })

        const response = await app.request(`/api/sessions/${intervention.session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Use the shorter first-release scope.' })
        })

        expect(response.status).toBe(409)
        expect(store.goalDecisionTopics.getByNamespace(topic.id, namespace)?.status).toBe('waiting')
        expect(store.goalDecisionTopics.getByNamespace(topic.id, namespace)?.resolution).toBeNull()
        expect(store.goals.getGoalByNamespace(goalId, namespace)?.status).toBe('blocked')
        const resolvedSession = store.sessions.getSessionByNamespace(intervention.session.id, namespace)
        expect(resolvedSession?.metadata).toMatchObject({ interventionStatus: 'pending' })
    })
})
