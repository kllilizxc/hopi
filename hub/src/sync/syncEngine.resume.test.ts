import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { SyncEngine } from './syncEngine'

function createInactiveSession(overrides?: {
    permissionMode?: Session['permissionMode']
    modelMode?: Session['modelMode']
}): Session {
    const now = Date.now()
    return {
        id: 'session-old',
        namespace: 'default',
        seq: 1,
        createdAt: now - 2_000,
        updatedAt: now - 1_000,
        active: false,
        activeAt: now - 1_000,
        metadata: {
            path: '/workspace',
            host: 'machine-host',
            machineId: 'machine-1',
            flavor: 'codex',
            codexSessionId: 'resume-token'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now - 1_000,
        permissionMode: overrides?.permissionMode,
        modelMode: overrides?.modelMode
    }
}

function createResumeHarness(options: {
    session: Session
    spawnedSessionId: string
}) {
    const spawnCalls: unknown[][] = []
    const applyCalls: Array<{ sessionId: string; patch: { permissionMode?: Session['permissionMode']; modelMode?: Session['modelMode'] } }> = []
    const mergeCalls: Array<{ oldSessionId: string; newSessionId: string; namespace: string }> = []

    const engine = {
        sessionCache: {
            resolveSessionAccess(sessionId: string, namespace: string) {
                if (sessionId !== options.session.id || namespace !== options.session.namespace) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return { ok: true, sessionId: options.session.id, session: options.session }
            },
            async mergeSessions(oldSessionId: string, newSessionId: string, namespace: string) {
                mergeCalls.push({ oldSessionId, newSessionId, namespace })
            }
        },
        machineCache: {
            getOnlineMachinesByNamespace(namespace: string) {
                if (namespace !== options.session.namespace) return []
                return [{ id: 'machine-1', metadata: { host: 'machine-host' } }]
            }
        },
        rpcGateway: {
            async spawnSession(...args: unknown[]) {
                spawnCalls.push(args)
                return { type: 'success' as const, sessionId: options.spawnedSessionId }
            }
        },
        async waitForSessionActive(sessionId: string) {
            return sessionId === options.spawnedSessionId
        },
        async applySessionConfigWithRetry(
            sessionId: string,
            patch: { permissionMode?: Session['permissionMode']; modelMode?: Session['modelMode'] }
        ) {
            applyCalls.push({ sessionId, patch })
        }
    } as unknown as SyncEngine

    return { engine, spawnCalls, applyCalls, mergeCalls }
}

describe('SyncEngine.resumeSession', () => {
    it('reapplies safe-yolo mode after resuming an inactive session', async () => {
        const session = createInactiveSession({ permissionMode: 'safe-yolo' })
        const { engine, spawnCalls, applyCalls, mergeCalls } = createResumeHarness({
            session,
            spawnedSessionId: 'session-new'
        })

        const result = await (SyncEngine.prototype.resumeSession as any).call(engine, session.id, session.namespace)

        expect(result).toEqual({ type: 'success', sessionId: 'session-new' })
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0]?.[4]).toBeUndefined()
        expect(applyCalls).toHaveLength(1)
        expect(applyCalls[0]).toEqual({
            sessionId: 'session-new',
            patch: {
                permissionMode: 'safe-yolo',
                modelMode: undefined
            }
        })
        expect(mergeCalls).toEqual([{
            oldSessionId: 'session-old',
            newSessionId: 'session-new',
            namespace: 'default'
        }])
    })

    it('resumes yolo sessions with yolo spawn flag and reapplies mode', async () => {
        const session = createInactiveSession({ permissionMode: 'yolo' })
        const { engine, spawnCalls, applyCalls } = createResumeHarness({
            session,
            spawnedSessionId: 'session-new'
        })

        const result = await (SyncEngine.prototype.resumeSession as any).call(engine, session.id, session.namespace)

        expect(result).toEqual({ type: 'success', sessionId: 'session-new' })
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0]?.[4]).toBe(true)
        expect(applyCalls).toHaveLength(1)
        expect(applyCalls[0]?.patch.permissionMode).toBe('yolo')
    })
})
