import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'

import { Store } from '../store'
import { runImprovementsScan } from './improvementsScan'
import type { SyncEngine } from './syncEngine'

function createActiveProjectSession(store: Store, options: {
    namespace: string
    projectId: string
}): { sessionId: string; session: Session } {
    const stored = store.sessions.getOrCreateSession(
        'scan-session',
        { path: '/tmp', host: 'test', projectId: options.projectId },
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
        metadata: {
            path: '/tmp',
            host: 'test',
            projectId: options.projectId
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

describe('runImprovementsScan', () => {
    it('creates New tasks from codex agent JSON response', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            label: 'HOPI',
            path: '/Users/realizer/Code/hopi'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished',
            projectId,
            title: 'Ship archived style refresh',
            status: 'finished',
            sortKey: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, { namespace, projectId })

        const engine = {
            async sendMessage(sid: string, _payload: { text: string; localId?: string | null }) {
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: JSON.stringify([
                                {
                                    title: '统一归档态视觉规范',
                                    description: '收敛 archived 的灰色 token',
                                    workspacePath: '/Users/realizer/Code/hopi',
                                    workspaceLabel: 'HOPI'
                                },
                                {
                                    title: '增加归档样式回归用例',
                                    description: '补充亮/暗主题回归检查',
                                    workspacePath: '/Users/realizer/Code/hopi',
                                    workspaceLabel: 'HOPI'
                                }
                            ])
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

        const result = await runImprovementsScan({
            store,
            engine,
            namespace,
            project: {
                id: projectId,
                name: 'HOPI',
                improvementsMaxGeneratedNew: 5
            },
            finishedTask,
            targetSessionId: sessionId,
            maxToCreate: 5
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.createdTaskIds.length).toBe(2)

        const generated = store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            .filter((task) => task.source === 'improvements_scan')

        expect(generated.length).toBe(2)
        expect(generated.every((task) => task.status === 'new')).toBe(true)
        expect(generated.every((task) => task.workspaceId === workspaceId)).toBe(true)
    })

    it('creates New tasks from claude output assistant JSON response', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-2'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished-2',
            projectId,
            title: 'Finalize archived kanban card',
            status: 'finished',
            sortKey: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, { namespace, projectId })

        const engine = {
            async sendMessage(sid: string, _payload: { text: string; localId?: string | null }) {
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'output',
                        data: {
                            type: 'assistant',
                            message: {
                                content: [
                                    { type: 'text', text: '[{"title":"优化归档卡片可读性","description":"提升浅色/深色主题对比"}]' }
                                ]
                            }
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

        const result = await runImprovementsScan({
            store,
            engine,
            namespace,
            project: {
                id: projectId,
                name: 'HOPI',
                improvementsMaxGeneratedNew: 5
            },
            finishedTask,
            targetSessionId: sessionId,
            maxToCreate: 5
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.createdTaskIds.length).toBe(1)
        const created = store.tasks.getTaskByNamespace(result.createdTaskIds[0]!, namespace)
        expect(created?.title).toBe('优化归档卡片可读性')
        expect(created?.status).toBe('new')
        expect(created?.source).toBe('improvements_scan')
    })
})
