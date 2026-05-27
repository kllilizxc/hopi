import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import { createSessionsRoutes } from './sessions'

function createTestApp(engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine))
    return app
}

function makeSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: false,
        activeAt: Date.now(),
        metadata: { path: '/tmp/workspace', flavor: 'codex' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        ...overrides
    } as Session
}

describe('sessions routes', () => {
    it('allows aborting an inactive stored session so stale loading states can be canceled', async () => {
        const session = makeSession({ active: false })
        const abortedSessionIds: string[] = []
        const engine = {
            resolveSessionAccess(sessionId: string, namespace: string) {
                if (sessionId !== session.id || namespace !== 'default') {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            async abortSession(sessionId: string) {
                abortedSessionIds.push(sessionId)
            }
        } as unknown as SyncEngine

        const app = createTestApp(engine)
        const response = await app.request(`/api/sessions/${session.id}/abort`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(abortedSessionIds).toEqual([session.id])
    })

    it('treats missing abort RPC for an inactive session as an idempotent stop', async () => {
        const session = makeSession({ active: false })
        const engine = {
            resolveSessionAccess(sessionId: string, namespace: string) {
                if (sessionId !== session.id || namespace !== 'default') {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            async abortSession() {
                throw new Error(`RPC handler not registered: ${session.id}:abort`)
            }
        } as unknown as SyncEngine

        const app = createTestApp(engine)
        const response = await app.request(`/api/sessions/${session.id}/abort`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
    })
})
