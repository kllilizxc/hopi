import { describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'

import { Store } from '../store'
import { runImprovementsScan } from './improvementsScan'
import type { SyncEngine } from './syncEngine'

function createActiveProjectSession(store: Store, options: {
    namespace: string
    projectId: string
    locale?: string
}): { sessionId: string; session: Session } {
    const metadata = {
        path: '/tmp',
        host: 'test',
        projectId: options.projectId,
        ...(options.locale ? { locale: options.locale } : {})
    }

    const stored = store.sessions.getOrCreateSession(
        'scan-session',
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
                                    priority: 'high',
                                    workspacePath: '/Users/realizer/Code/hopi',
                                    workspaceLabel: 'HOPI'
                                },
                                {
                                    title: '增加归档样式回归用例',
                                    description: '补充亮/暗主题回归检查',
                                    priority: 'low',
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
        const first = generated.find((task) => task.title === '统一归档态视觉规范')
        const second = generated.find((task) => task.title === '增加归档样式回归用例')
        expect(first?.priority).toBe('high')
        expect(second?.priority).toBe('low')
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
        expect(created?.priority).toBe('medium')
        expect(created?.source).toBe('improvements_scan')
    })

    it('adds session locale instruction to improvements prompt', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-3'
        let capturedPrompt = ''

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished-3',
            projectId,
            title: 'Finalize release notes',
            status: 'finished',
            sortKey: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, {
            namespace,
            projectId,
            locale: 'zh_CN.UTF-8'
        })

        const engine = {
            async sendMessage(sid: string, payload: { text: string; localId?: string | null }) {
                capturedPrompt = payload.text
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: '[]'
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
        expect(capturedPrompt).toContain('system language for this session (zh-CN)')
        expect(capturedPrompt).toContain('Suggest up to 3 follow-up improvement tasks.')
        expect(capturedPrompt).toContain('Focus on necessary, high-impact follow-ups only; fewer is better.')
        expect(capturedPrompt).toContain('"priority":"high|medium|low"')
        expect(capturedPrompt).toContain('"category":"feature|architecture"')
        expect(capturedPrompt).toContain('split close to 50/50')
        expect(capturedPrompt).toContain('Include a "priority" for each item using ONLY')
        expect(capturedPrompt).toContain('Include a "category" for each item using ONLY')
    })

    it('prefers request locale override over session metadata locale', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-locale-override'
        let capturedPrompt = ''

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished-locale-override',
            projectId,
            title: 'Complete polish pass',
            status: 'finished',
            sortKey: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, {
            namespace,
            projectId,
            locale: 'en-US'
        })

        const engine = {
            async sendMessage(sid: string, payload: { text: string; localId?: string | null }) {
                capturedPrompt = payload.text
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: '[]'
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
            maxToCreate: 5,
            preferredLocale: 'zh-CN'
        })

        expect(result.ok).toBe(true)
        expect(capturedPrompt).toContain('system language for this session (zh-CN)')
        expect(capturedPrompt).not.toContain('system language for this session (en-US)')
    })

    it('keeps generated tasks mixed across feature and architecture categories', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-4'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished-4',
            projectId,
            title: 'Ship project board refresh',
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
                                    title: 'Add board filtering presets',
                                    category: 'feature'
                                },
                                {
                                    title: 'Support archived task quick actions',
                                    category: 'feature'
                                },
                                {
                                    title: 'Refactor task query service boundaries',
                                    category: 'architecture'
                                },
                                {
                                    title: 'Split sync engine task handlers',
                                    category: 'architecture'
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

        const created = store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            .filter((task) => task.source === 'improvements_scan')

        expect(result.createdTaskIds.length).toBe(3)
        expect(created.length).toBe(3)

        const titles = created.map((task) => task.title)
        expect(titles).toContain('Add board filtering presets')
        expect(titles).toContain('Refactor task query service boundaries')
    })

    it('caps created tasks to 3 even when the scan asks for more', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-5'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI'
        })

        const finishedTask = store.tasks.createTask({
            id: 'task-finished-5',
            projectId,
            title: 'Ship baseline refactor',
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
                                { title: 'Task A' },
                                { title: 'Task B' },
                                { title: 'Task C' },
                                { title: 'Task D' },
                                { title: 'Task E' }
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
                improvementsMaxGeneratedNew: 10
            },
            finishedTask,
            targetSessionId: sessionId,
            maxToCreate: 10
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.createdTaskIds.length).toBe(3)
    })
})
