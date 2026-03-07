import { describe, expect, it } from 'bun:test'
import type { Session } from '@hopi/protocol/types'

import { Store } from '../store'
import { relinkTaskToSession, resolveBestUsableTaskSession } from './sessionTaskLink'
import type { SyncEngine } from './syncEngine'

function createSession(store: Store, options: {
    id: string
    namespace: string
    metadata: Session['metadata']
    active?: boolean
    updatedAt?: number
}): Session {
    const stored = store.sessions.getOrCreateSession(options.id, options.metadata, null, options.namespace)
    const updatedAt = options.updatedAt ?? Date.now()
    return {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: updatedAt,
        updatedAt,
        active: options.active ?? true,
        activeAt: options.active === false ? 0 : updatedAt,
        metadata: options.metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: updatedAt
    }
}

describe('relinkTaskToSession', () => {
    it('keeps task, session metadata, and merge runtime session in sync', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const oldSession = createSession(store, {
            id: 'session-old',
            namespace,
            metadata: { path: '/tmp/old', host: 'test', projectId, taskId: 'task-1' }
        })
        const newSession = createSession(store, {
            id: 'session-new',
            namespace,
            metadata: { path: '/tmp/new', host: 'test' }
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        const task = store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: oldSession.id,
            mergeRuntime: {
                status: 'running',
                sessionId: oldSession.id,
                updatedAt: Date.now(),
                latestNote: 'merge running'
            }
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated?.activeSessionId).toBe(newSession.id)
        expect(updated?.mergeRuntime?.sessionId).toBe(newSession.id)
        const linkedSession = store.sessions.getSessionByNamespace(newSession.id, namespace)
        expect(linkedSession?.metadata).toMatchObject({ projectId, taskId: 'task-1' })
        expect(events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const payload = event as { type?: unknown; taskId?: unknown; sessionId?: unknown }
            return payload.type === 'task-updated' || payload.type === 'session-updated'
        })).toBe(true)
    })
})

describe('resolveBestUsableTaskSession', () => {
    it('relinks to a metadata-matched session when task activeSessionId is stale', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })

        const bestSession = createSession(store, {
            id: 'session-best',
            namespace,
            metadata: {
                path: '/tmp/best',
                host: 'test',
                projectId,
                taskId: 'task-1',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale',
            mergeRuntime: {
                status: 'queued',
                updatedAt: Date.now() - 1_000,
                latestNote: 'queued'
            }
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved.ok).toBe(true)
        if (!resolved.ok) {
            return
        }
        expect(resolved.sessionId).toBe(bestSession.id)
        expect(resolved.task.activeSessionId).toBe(bestSession.id)
        expect(resolved.task.mergeRuntime?.sessionId).toBe(bestSession.id)
        expect(resolved.relinked).toBe(true)
    })
})
