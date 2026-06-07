import { describe, expect, it } from 'bun:test'
import type { Session } from '@hopi/protocol/types'
import { SyncEngine } from './syncEngine'

function createInactiveSession(overrides?: {
    permissionMode?: Session['permissionMode']
    modelMode?: Session['modelMode']
    flavor?: 'claude' | 'codex' | 'gemini' | 'opencode'
}): Session {
    const now = Date.now()
    const flavor = overrides?.flavor ?? 'codex'
    const metadata: Session['metadata'] = {
        path: '/workspace',
        host: 'machine-host',
        machineId: 'machine-1',
        flavor
    }
    if (flavor === 'codex') {
        metadata.codexSessionId = 'resume-token'
    } else if (flavor === 'gemini') {
        metadata.geminiSessionId = 'resume-token'
    } else if (flavor === 'opencode') {
        metadata.opencodeSessionId = 'resume-token'
    } else {
        metadata.claudeSessionId = 'resume-token'
    }

    return {
        id: 'session-old',
        namespace: 'default',
        seq: 1,
        createdAt: now - 2_000,
        updatedAt: now - 1_000,
        active: false,
        activeAt: now - 1_000,
        metadata,
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
    linkedTasks?: Array<{
        permissionMode?: Session['permissionMode'] | null
        modelMode?: Session['modelMode'] | null
    }>
}) {
    const spawnCalls: unknown[][] = []
    const applyCalls: Array<{ sessionId: string; patch: { permissionMode?: Session['permissionMode']; modelMode?: Session['modelMode'] } }> = []
    const mergeCalls: Array<{ oldSessionId: string; newSessionId: string; namespace: string }> = []

    const engine = {
        store: {
            tasks: {
                listTasksByActiveSessionIdAndNamespace(sessionId: string) {
                    if (sessionId !== options.session.id) {
                        return []
                    }
                    return (options.linkedTasks ?? []).map((task, index) => ({
                        id: `task-${index + 1}`,
                        projectId: `project-${index + 1}`,
                        permissionMode: task.permissionMode ?? null,
                        modelMode: task.modelMode ?? null
                    }))
                }
            }
        },
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

    it('falls back to linked task mode when inactive session mode is missing', async () => {
        const session = createInactiveSession()
        const { engine, spawnCalls, applyCalls } = createResumeHarness({
            session,
            spawnedSessionId: 'session-new',
            linkedTasks: [{ permissionMode: 'safe-yolo' }]
        })

        const result = await (SyncEngine.prototype.resumeSession as any).call(engine, session.id, session.namespace)

        expect(result).toEqual({ type: 'success', sessionId: 'session-new' })
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0]?.[4]).toBeUndefined()
        expect(applyCalls).toHaveLength(1)
        expect(applyCalls[0]?.patch.permissionMode).toBe('safe-yolo')
    })
})

describe('SyncEngine.writeFileOnMachine', () => {
    it('delegates machine file writes to the RPC gateway', async () => {
        const calls: Array<{
            machineId: string
            path: string
            options: {
                content: string
                cwd?: string
                expectedHash?: string | null
                createParents?: boolean
                overwrite?: boolean
            }
        }> = []
        const engine = {
            rpcGateway: {
                async writeFileOnMachine(machineId: string, path: string, options: {
                    content: string
                    cwd?: string
                    expectedHash?: string | null
                    createParents?: boolean
                    overwrite?: boolean
                }) {
                    calls.push({ machineId, path, options })
                    return { success: true, path, hash: 'next-hash' }
                }
            }
        } as unknown as SyncEngine

        const result = await (SyncEngine.prototype.writeFileOnMachine as any).call(
            engine,
            'machine-1',
            '/workspace/.hopi/docs/goals/example/planner-mail.yml',
            {
                content: 'Ym9keQ==',
                cwd: '/workspace',
                createParents: true,
                overwrite: true
            }
        )

        expect(result).toEqual({ success: true, path: '/workspace/.hopi/docs/goals/example/planner-mail.yml', hash: 'next-hash' })
        expect(calls).toEqual([{
            machineId: 'machine-1',
            path: '/workspace/.hopi/docs/goals/example/planner-mail.yml',
            options: {
                content: 'Ym9keQ==',
                cwd: '/workspace',
                createParents: true,
                overwrite: true
            }
        }])
    })
})
