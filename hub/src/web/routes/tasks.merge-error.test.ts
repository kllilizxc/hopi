import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function seedMergeTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    sessionId: string
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Merge Project',
        defaultSessionType: 'worktree',
        worktreeTargetBranch: 'main'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: 'in_review',
        activeSessionId: options.sessionId
    })
}

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

describe('tasks merge route unexpected errors', () => {
    it('returns thrown error message for unexpected merge failures', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-message'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-message',
            taskId,
            sessionId: 'session-merge-message'
        })

        const engine = {
            resolveSessionAccess() {
                throw new Error('simulated merge crash')
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('simulated merge crash')
    })

    it('uses fallback message when thrown value has no readable message', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-fallback'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-fallback',
            taskId,
            sessionId: 'session-merge-fallback'
        })

        const engine = {
            resolveSessionAccess() {
                throw null
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('Merge failed unexpectedly')
    })

    it('maps auto-resolve runtime failures to 503 instead of bubbling 500', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-auto-resolve-runtime'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-auto-resolve-runtime',
            taskId,
            sessionId: 'session-merge-auto-resolve-runtime'
        })

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId: 'session-merge-auto-resolve-runtime',
                    session: {
                        id: 'session-merge-auto-resolve-runtime',
                        thinking: false,
                        metadata: {
                            worktree: {
                                branch: 'task-branch'
                            }
                        }
                    }
                }
            },
            async gitMergeWorktree() {
                return {
                    success: false,
                    error: 'Merge conflicts detected; manual resolution required',
                    conflictFiles: ['src/conflict.ts']
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            },
            async sendMessage() {
                return
            },
            getSessionByNamespace() {
                throw new Error('RPC socket disconnected: session-merge-auto-resolve-runtime')
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(503)
        const body = await response.json() as { error?: string; autoResolveAttempted?: boolean }
        expect(body.error).toBe('RPC socket disconnected: session-merge-auto-resolve-runtime')
        expect(body.autoResolveAttempted).toBe(true)
    })

    it('prefers stderr details over generic command-failed error text', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-command-failed-stderr'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-command-failed-stderr',
            taskId,
            sessionId: 'session-merge-command-failed-stderr'
        })

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId: 'session-merge-command-failed-stderr',
                    session: {
                        id: 'session-merge-command-failed-stderr',
                        thinking: false,
                        metadata: {
                            worktree: {
                                branch: 'task-branch'
                            }
                        }
                    }
                }
            },
            async gitMergeWorktree() {
                return {
                    success: false,
                    error: 'Command failed: git switch dev',
                    stderr: 'fatal: unexpected repository state',
                    stdout: ''
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conflictStrategy: 'manual' })
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('fatal: unexpected repository state')
    })

    it('exposes merge-state based on source-vs-target diff', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-state-no-changes'
        seedMergeTask(store, {
            namespace: 'default',
            projectId: 'project-merge-state-no-changes',
            taskId,
            sessionId: 'session-merge-state-no-changes'
        })

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId: 'session-merge-state-no-changes',
                    session: {
                        id: 'session-merge-state-no-changes',
                        thinking: false,
                        metadata: {
                            worktree: {
                                branch: 'task-branch'
                            }
                        }
                    }
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: false,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge-state`)

        expect(response.status).toBe(200)
        const body = await response.json() as {
            ok?: boolean
            canMerge?: boolean
            reason?: string
            committedChangedCount?: number | null
        }
        expect(body.ok).toBe(true)
        expect(body.canMerge).toBe(false)
        expect(body.reason).toBe('no_changes')
        expect(body.committedChangedCount).toBe(0)
    })

    it('does not short-circuit merge only from persisted merged marker', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-merge-stale-marker'
        const namespace = 'default'
        seedMergeTask(store, {
            namespace,
            projectId: 'project-merge-stale-marker',
            taskId,
            sessionId: 'session-merge-stale-marker'
        })

        store.tasks.updateTaskByNamespace(taskId, namespace, {
            worktreeMergedAt: Date.now() - 60_000,
            worktreeMergeCommit: 'old123'
        })

        let mergeCalls = 0
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId: 'session-merge-stale-marker',
                    session: {
                        id: 'session-merge-stale-marker',
                        thinking: false,
                        metadata: {
                            worktree: {
                                branch: 'task-branch'
                            }
                        }
                    }
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 0
                }
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: 'new456'
                }
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
            commitHash?: string | null
        }
        expect(body.ok).toBe(true)
        expect(body.skippedReason).toBeNull()
        expect(body.commitHash).toBe('new456')
        expect(mergeCalls).toBe(1)
    })
})
