import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session } from '@hopi/protocol/types'
import { Store, type StoredSession } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createSessionsRoutes } from './sessions'

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

function createTestApp(store: Store): {
    app: Hono
    appliedConfigs: Array<{ sessionId: string; permissionMode?: string }>
} {
    const appliedConfigs: Array<{ sessionId: string; permissionMode?: string }> = []
    const engine = {
        resolveSessionAccess(sessionId: string, namespace: string) {
            const session = store.sessions.getSessionByNamespace(sessionId, namespace)
            if (!session) {
                return { ok: false as const, reason: 'not-found' as const }
            }
            return { ok: true as const, sessionId, session: runtimeSession(session) }
        },
        getSessionsByNamespace() {
            return []
        },
        async applySessionConfig(sessionId: string, patch: { permissionMode?: string }) {
            appliedConfigs.push({ sessionId, permissionMode: patch.permissionMode })
        }
    } as unknown as SyncEngine

    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine))
    return { app, appliedConfigs }
}

describe('operator console session routes', () => {
    it('rejects permission escalation for Project Assistant operator console sessions', async () => {
        const store = new Store(':memory:')
        const { app, appliedConfigs } = createTestApp(store)
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
                flavor: 'codex'
            },
            null,
            'default'
        )

        const response = await app.request(`/api/sessions/${session.id}/permission-mode`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'yolo' })
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Operator console sessions cannot change permission mode'
        })
        expect(appliedConfigs).toEqual([])
    })

    it('rejects upload writes for Project Assistant operator console sessions', async () => {
        const store = new Store(':memory:')
        const { app } = createTestApp(store)
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
                flavor: 'codex'
            },
            null,
            'default'
        )

        const response = await app.request(`/api/sessions/${session.id}/upload`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                filename: 'notes.txt',
                content: Buffer.from('hello').toString('base64'),
                mimeType: 'text/plain'
            })
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            success: false,
            error: 'Operator console sessions cannot upload files'
        })
    })
})
