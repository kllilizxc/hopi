import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
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
    status?: 'planned' | 'in_progress' | 'in_review' | 'finished' | 'blocked'
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Merge Project',
        defaultSessionType: 'worktree',
        worktreeTargetBranch: 'main'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: options.status ?? 'in_progress',
        workflowProfile: 'default',
        activeSessionId: options.sessionId
    })
}

async function waitForTask(options: {
    store: Store
    taskId: string
    predicate: (task: ReturnType<Store['tasks']['getTaskByNamespace']>) => boolean
    timeoutMs?: number
}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 2_000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
        const task = options.store.tasks.getTaskByNamespace(options.taskId, 'default')
        if (options.predicate(task)) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('Timed out waiting for task update')
}

describe('tasks merge route conversation kickoff', () => {
    it('sends a merge prompt that prefers .hopi/merge.sh and persists success after ready', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script'
        const taskId = 'task-merge-script'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script',
            {
                path: '/tmp/worktree',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId, status: 'in_progress' })

        let promptText = ''
        let mergeStateCalls = 0
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace() {
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
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                promptText = payload.text
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)

                setTimeout(() => {
                    store.messages.addMessage(sessionId, {
                        role: 'assistant',
                        content: { type: 'event', data: { type: 'ready', forLocalKey: payload.localId } }
                    })
                }, 10)
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok?: boolean
            skippedReason?: string | null
        }
        expect(body.ok).toBe(true)
        expect(body.skippedReason).toBe('running')
        expect(promptText).toContain('.hopi/merge.sh')
        expect(promptText).toContain('workspace sandbox')

        await waitForTask({
            store,
            taskId,
            predicate: (task) => Boolean(task?.worktreeMergedAt)
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergedAt).toBeTypeOf('number')
    })

    it('marks the merge runtime blocked when the conversation finishes but branch is still mergeable', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script-blocked'
        const taskId = 'task-merge-script-blocked'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script-blocked',
            {
                path: '/tmp/worktree',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId, status: 'in_progress' })

        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            getSessionByNamespace() {
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
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)

                setTimeout(() => {
                    store.messages.addMessage(sessionId, {
                        role: 'assistant',
                        content: { type: 'event', data: { type: 'ready', forLocalKey: payload.localId } }
                    })
                }, 10)
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('running')

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.worktreeMergedAt).toBeNull()
        expect(updatedTask?.mergeRuntime?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('still mergeable')
    })
})
