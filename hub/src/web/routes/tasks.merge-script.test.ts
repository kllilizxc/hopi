import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createTasksRoutes({
        store,
        getSyncEngine: () => engine
    }))
    return app
}

function seedMergeTask(store: Store, options: {
    projectId: string
    taskId: string
    sessionId: string
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Merge Project',
        worktreeTargetBranch: 'main'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: 'in_progress',
        activeSessionId: options.sessionId
    })
}

describe('tasks merge route with custom merge script', () => {
    it('runs .hopi/merge.sh when present and skips built-in merge RPC', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script'
        const taskId = 'task-merge-script'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script',
            {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let mergeStateCalls = 0
        let gitMergeCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: {}
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id !== sessionId) {
                    return null
                }
                return session
            },
            async gitMergeWorktreeState() {
                mergeStateCalls += 1
                if (mergeStateCalls === 1) {
                    return {
                        success: true,
                        sourceBranch: 'task-branch',
                        hasWorkingTreeChanges: true,
                        committedChangedCount: 2,
                        mergeable: true
                    }
                }
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0,
                    mergeable: false
                }
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                const marker = params.command.match(/echo '([^']+)'/)?.[1] ?? ''
                return {
                    success: true,
                    stdout: marker,
                    stderr: ''
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'merge script done' }
                }, payload.localId)
            },
            async gitMergeWorktree() {
                gitMergeCalls += 1
                return {
                    success: true,
                    commitHash: 'unexpected'
                }
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: boolean
            commitHash: string | null
            skippedReason: string | null
            mergedAt: number | null
        }
        expect(body.ok).toBe(true)
        expect(body.commitHash).toBeNull()
        expect(body.skippedReason).toBeNull()
        expect(typeof body.mergedAt).toBe('number')
        expect(sendMessageCalls).toBe(1)
        expect(gitMergeCalls).toBe(0)

        const updated = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updated?.worktreeMergedAt).toBeTypeOf('number')
        expect(updated?.worktreeMergeCommit).toBeNull()
    })

    it('returns error when .hopi/merge.sh fails', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script-fail'
        const taskId = 'task-merge-script-fail'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script-fail',
            {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let gitMergeCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: {}
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id !== sessionId) {
                    return null
                }
                return session
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 2,
                    mergeable: true
                }
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                const marker = params.command.match(/echo '([^']+)'/)?.[1] ?? ''
                return {
                    success: true,
                    stdout: marker,
                    stderr: ''
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'merge failed' }
                }, payload.localId)
            },
            async gitMergeWorktree() {
                gitMergeCalls += 1
                return {
                    success: true,
                    commitHash: 'unexpected'
                }
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error: string }
        expect(body.error).toContain('.hopi/merge.sh')
        expect(gitMergeCalls).toBe(0)

        const updated = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updated?.worktreeMergedAt).toBeNull()
    })

    it('falls back to worktree base path when merge script is missing in worktree path', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script-fallback'
        const taskId = 'task-merge-script-fallback'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script-fallback',
            {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let mergeStateCalls = 0
        let gitMergeCalls = 0
        const runBashCwds: string[] = []
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: {}
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace(id: string) {
                if (id !== sessionId) {
                    return null
                }
                return session
            },
            async gitMergeWorktreeState() {
                mergeStateCalls += 1
                if (mergeStateCalls === 1) {
                    return {
                        success: true,
                        sourceBranch: 'task-branch',
                        hasWorkingTreeChanges: true,
                        committedChangedCount: 2,
                        mergeable: true
                    }
                }
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0,
                    mergeable: false
                }
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                const cwd = params.cwd ?? ''
                runBashCwds.push(cwd)
                const marker = params.command.match(/echo '([^']+)'/)?.[1] ?? ''
                if (cwd === '/tmp/worktree') {
                    return { success: true, stdout: '', stderr: '' }
                }
                return {
                    success: true,
                    stdout: marker,
                    stderr: ''
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'merge script done' }
                }, payload.localId)
            },
            async gitMergeWorktree() {
                gitMergeCalls += 1
                return {
                    success: true,
                    commitHash: 'unexpected'
                }
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok: boolean
            commitHash: string | null
            skippedReason: string | null
            mergedAt: number | null
        }
        expect(body.ok).toBe(true)
        expect(body.commitHash).toBeNull()
        expect(body.skippedReason).toBeNull()
        expect(typeof body.mergedAt).toBe('number')
        expect(runBashCwds).toEqual(['/tmp/worktree', '/tmp/base'])
        expect(sendMessageCalls).toBe(1)
        expect(gitMergeCalls).toBe(0)
    })
})
