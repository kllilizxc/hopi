import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { handleTaskMovedToFinished } from './taskFinishAutomation'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) {
            return
        }
        await delay(20)
    }
    throw new Error('Timed out while waiting for condition')
}

function createActiveProjectSession(store: Store, options: {
    namespace: string
    projectId: string
}): { sessionId: string; session: Session } {
    const metadata = {
        path: '/tmp',
        host: 'test',
        projectId: options.projectId
    }
    const stored = store.sessions.getOrCreateSession(
        `tasks-route-session-${options.projectId}`,
        metadata,
        null,
        options.namespace
    )
    const now = Date.now()

    const session: Session = {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

describe('tasks improvements automation', () => {
    it('does not run duplicate improvements scans once max generated New limit is reached', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-improvements-limit'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI',
            improvementsEnabled: true,
            improvementsMaxGeneratedNew: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, { namespace, projectId })

        store.tasks.createTask({
            id: 'task-finished-a',
            projectId,
            title: 'Finish A',
            status: 'in_review',
            activeSessionId: sessionId
        })
        store.tasks.createTask({
            id: 'task-finished-b',
            projectId,
            title: 'Finish B',
            status: 'in_review',
            activeSessionId: sessionId
        })

        let sendMessageCalls = 0
        const engine = {
            async sendMessage(sid: string) {
                sendMessageCalls += 1
                await delay(60)
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: JSON.stringify([{ title: `Generated ${sendMessageCalls}` }])
                        }
                    }
                })
            },
            getSessionByNamespace(sid: string, ns: string) {
                return sid === sessionId && ns === namespace ? session : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? [session] : []
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        await Promise.all([
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-finished-a'
            }),
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-finished-b'
            })
        ])

        await waitFor(() => {
            const taskA = store.tasks.getTaskByNamespace('task-finished-a', namespace)
            const taskB = store.tasks.getTaskByNamespace('task-finished-b', namespace)
            return Boolean(taskA?.archivedAt && taskB?.archivedAt)
        })

        expect(sendMessageCalls).toBe(1)
        expect(store.tasks.countGeneratedNewTasks(projectId, namespace)).toBe(1)
    })

    it('keeps scans concurrent across different projects', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'

        store.projects.createProject({
            id: 'project-a',
            namespace,
            machineId: 'machine-1',
            name: 'Project A',
            improvementsEnabled: true,
            improvementsMaxGeneratedNew: 1
        })
        store.projects.createProject({
            id: 'project-b',
            namespace,
            machineId: 'machine-1',
            name: 'Project B',
            improvementsEnabled: true,
            improvementsMaxGeneratedNew: 1
        })

        const { sessionId: sessionAId, session: sessionA } = createActiveProjectSession(store, {
            namespace,
            projectId: 'project-a'
        })
        const { sessionId: sessionBId, session: sessionB } = createActiveProjectSession(store, {
            namespace,
            projectId: 'project-b'
        })

        store.tasks.createTask({
            id: 'task-a',
            projectId: 'project-a',
            title: 'Task A',
            status: 'finished',
            activeSessionId: sessionAId
        })
        store.tasks.createTask({
            id: 'task-b',
            projectId: 'project-b',
            title: 'Task B',
            status: 'finished',
            activeSessionId: sessionBId
        })

        let inFlight = 0
        let maxInFlight = 0
        const engine = {
            async sendMessage(sid: string) {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(60)
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: JSON.stringify([{ title: 'Generated follow-up' }])
                        }
                    }
                })
                inFlight -= 1
            },
            getSessionByNamespace(sid: string, ns: string) {
                if (ns !== namespace) return undefined
                if (sid === sessionAId) return sessionA
                if (sid === sessionBId) return sessionB
                return undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? [sessionA, sessionB] : []
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        await Promise.all([
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-a'
            }),
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-b'
            })
        ])

        expect(maxInFlight).toBe(2)
    })
})
