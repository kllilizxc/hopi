import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'


const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'
const VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

function createMergeVerificationSnapshot(): {
    success: boolean
    targetBranch: string
    sourceBranch: string
    mergeBase: string
    snapshotRef: string
    expectedChangeCount: number
} {
    return {
        success: true,
        targetBranch: 'main',
        sourceBranch: 'task-branch',
        mergeBase: MERGE_BASE,
        snapshotRef: SNAPSHOT_REF,
        expectedChangeCount: 1
    }
}

function createMergeVerificationResult(): {
    success: boolean
    verified: boolean
    targetBranch: string
    mergeBase: string
    snapshotRef: string
    expectedChangeCount: number
    targetHead: string
} {
    return {
        success: true,
        verified: true,
        targetBranch: 'main',
        mergeBase: MERGE_BASE,
        snapshotRef: SNAPSHOT_REF,
        expectedChangeCount: 1,
        targetHead: TARGET_HEAD
    }
}
function seedProject(store: Store, options: { namespace: string; projectId: string }): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Merge Project',
        defaultSessionType: 'worktree',
        worktreeTargetBranch: 'main'
    })
}

function seedMergeTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    sessionId?: string | null
    status?: 'planning' | 'running' | 'review' | 'done' | 'blocked'
}): void {
    seedProject(store, {
        namespace: options.namespace,
        projectId: options.projectId
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: options.status ?? 'review',
        workflowProfile: 'default',
        activeSessionId: options.sessionId ?? null
    })
}

function seedWorktreeSession(store: Store, options: {
    namespace: string
    tag: string
    path: string
    taskId?: string
    projectId?: string
}): { id: string } {
    return store.sessions.getOrCreateSession(options.tag, {
        path: options.path,
        host: 'test-host',
        taskId: options.taskId,
        projectId: options.projectId,
        worktree: {
            basePath: options.path,
            branch: 'task-branch',
            name: `${options.tag}-worktree`
        }
    }, null, options.namespace)
}

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

function withValidContract<T extends Record<string, unknown>>(engine: T): T {
    return {
        ...engine,
        async readSessionFile() {
            return {
                success: true,
                content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
            }
        }
    }
}

describe('tasks merge route runtime behavior', () => {
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

    it('resumes stale linked sessions and relinks task state without clearing merge markers', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-resume-relink'
        const staleSession = seedWorktreeSession(store, {
            namespace,
            tag: 'session-stale',
            path: '/tmp/stale'
        })
        const resumedSession = seedWorktreeSession(store, {
            namespace,
            tag: 'session-resumed',
            path: '/tmp/resumed'
        })
        const taskId = 'task-merge-resume-relink'

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: staleSession.id
        })

        const mergedAt = Date.now() - 60_000
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'commit-before-relink',
            mergedDiffSnapshot: {
                files: [],
                capturedAt: mergedAt
            }
        })

        let resumeCalls = 0
        const engine = withValidContract({
            resolveSessionAccess(sessionId: string) {
                if (sessionId === staleSession.id) {
                    return {
                        ok: true,
                        sessionId,
                        session: {
                            id: sessionId,
                            namespace,
                            active: false,
                            thinking: false,
                            metadata: {
                                path: '/tmp/stale',
                                host: 'test-host',
                                worktree: {
                                    basePath: '/tmp/stale',
                                    branch: 'task-branch',
                                    name: 'stale-worktree'
                                }
                            },
                            agentState: null
                        }
                    }
                }

                if (sessionId === resumedSession.id) {
                    return {
                        ok: true,
                        sessionId,
                        session: {
                            id: sessionId,
                            namespace,
                            active: true,
                            thinking: false,
                            metadata: {
                                path: '/tmp/resumed',
                                host: 'test-host',
                                worktree: {
                                    basePath: '/tmp/resumed',
                                    branch: 'task-branch',
                                    name: 'resumed-worktree'
                                }
                            },
                            agentState: null
                        }
                    }
                }

                return { ok: false, reason: 'not-found' }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== resumedSession.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/resumed',
                        host: 'test-host',
                        worktree: {
                            basePath: '/tmp/resumed',
                            branch: 'task-branch',
                            name: 'resumed-worktree'
                        }
                    },
                    agentState: null
                }
            },
            async resumeSession() {
                resumeCalls += 1
                return { type: 'success', sessionId: resumedSession.id }
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
            },
            handleRealtimeEvent() {}
        }) as unknown as SyncEngine

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
            mergedAt?: number | null
        }
        expect(body.ok).toBe(true)
        expect(body.skippedReason).toBe('already_merged')
        expect(body.mergedAt).toBe(mergedAt)
        expect(resumeCalls).toBe(1)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(resumedSession.id)
        expect(updatedTask?.worktreeMergedAt).toBe(mergedAt)
        expect(updatedTask?.worktreeMergeCommit).toBe('commit-before-relink')
    })

    it('relinks drifted tasks to the best usable backlink session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-drift-relink'
        const taskId = 'task-merge-drift-relink'
        const backlinkSession = seedWorktreeSession(store, {
            namespace,
            tag: 'session-backlink',
            path: '/tmp/backlink',
            taskId,
            projectId
        })

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: 'missing-session-id'
        })

        const engine = withValidContract({
            resolveSessionAccess(sessionId: string) {
                if (sessionId === backlinkSession.id) {
                    return {
                        ok: true,
                        sessionId,
                        session: {
                            id: sessionId,
                            namespace,
                            active: true,
                            thinking: false,
                            metadata: {
                                path: '/tmp/backlink',
                                host: 'test-host',
                                projectId,
                                taskId,
                                worktree: {
                                    basePath: '/tmp/backlink',
                                    branch: 'task-branch',
                                    name: 'backlink-worktree'
                                }
                            },
                            agentState: null
                        }
                    }
                }

                return { ok: false, reason: 'not-found' }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== backlinkSession.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/backlink',
                        host: 'test-host',
                        projectId,
                        taskId,
                        worktree: {
                            basePath: '/tmp/backlink',
                            branch: 'task-branch',
                            name: 'backlink-worktree'
                        }
                    },
                    agentState: null
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
            },
            handleRealtimeEvent() {}
        }) as unknown as SyncEngine

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
        expect(body.skippedReason).toBe('no_changes')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(backlinkSession.id)
    })

    it('finishes an in-review task when merge retry finds no committed changes', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-no-changes-finish'
        const taskId = 'task-merge-no-changes-finish'
        const session = seedWorktreeSession(store, {
            namespace,
            tag: 'session-no-changes-finish',
            path: '/tmp/no-changes-finish',
            taskId,
            projectId
        })

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: session.id,
            status: 'review'
        })

        const engine = withValidContract({
            resolveSessionAccess(sessionId: string) {
                if (sessionId !== session.id) {
                    return { ok: false, reason: 'not-found' }
                }
                return {
                    ok: true as const,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: {
                            path: '/tmp/no-changes-finish',
                            host: 'test-host',
                            projectId,
                            taskId,
                            worktree: {
                                basePath: '/tmp/no-changes-finish',
                                branch: 'task-branch',
                                name: 'no-changes-finish-worktree'
                            }
                        },
                        agentState: null
                    }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== session.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/no-changes-finish',
                        host: 'test-host',
                        projectId,
                        taskId,
                        worktree: {
                            basePath: '/tmp/no-changes-finish',
                            branch: 'task-branch',
                            name: 'no-changes-finish-worktree'
                        }
                    },
                    agentState: null
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
            },
            handleRealtimeEvent() {}
        }) as unknown as SyncEngine

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
            mergedAt?: number | null
        }
        expect(body.ok).toBe(true)
        expect(body.skippedReason).toBe('no_changes')
        expect(body.mergedAt).toBeNumber()

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.status).toBe('done')
        expect(updatedTask?.finishedAt).toBeNumber()
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergedAt).toBeNumber()
    })

    it('queues merge behind a thinking session and keeps durable runtime state', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-queued'
        const taskId = 'task-merge-queued'
        const session = seedWorktreeSession(store, {
            namespace,
            tag: 'session-queued',
            path: '/tmp/queued'
        })

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: session.id
        })

        let sendMessageCalls = 0
        const engine = withValidContract({
            resolveSessionAccess(sessionId: string) {
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: true,
                        metadata: {
                            path: '/tmp/queued',
                            host: 'test-host',
                            worktree: {
                                basePath: '/tmp/queued',
                                branch: 'task-branch',
                                name: 'queued-worktree'
                            }
                        },
                        agentState: null
                    }
                }
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: true,
                    metadata: {
                        path: '/tmp/queued',
                        host: 'test-host',
                        worktree: {
                            basePath: '/tmp/queued',
                            branch: 'task-branch',
                            name: 'queued-worktree'
                        }
                    },
                    agentState: null
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
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async sendMessage(sessionId: string, payload: { text: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)
            },
            handleRealtimeEvent() {}
        }) as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('queued')
        expect(sendMessageCalls).toBe(0)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.mergeRuntime?.status).toBe('queued')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('queued behind')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('platform merge')
    })

    it('marks merge approval-pending when the linked session is waiting for permission', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-approval'
        const taskId = 'task-merge-approval'
        const session = seedWorktreeSession(store, {
            namespace,
            tag: 'session-approval',
            path: '/tmp/approval'
        })

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: session.id
        })

        const requests = { req1: { id: 'req1' } }
        let sendMessageCalls = 0
        const engine = withValidContract({
            resolveSessionAccess(sessionId: string) {
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: {
                            path: '/tmp/approval',
                            host: 'test-host',
                            worktree: {
                                basePath: '/tmp/approval',
                                branch: 'task-branch',
                                name: 'approval-worktree'
                            }
                        },
                        agentState: { requests }
                    }
                }
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/approval',
                        host: 'test-host',
                        worktree: {
                            basePath: '/tmp/approval',
                            branch: 'task-branch',
                            name: 'approval-worktree'
                        }
                    },
                    agentState: { requests }
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
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async sendMessage(sessionId: string, payload: { text: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)
            },
            handleRealtimeEvent() {}
        }) as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('approval_pending')
        expect(sendMessageCalls).toBe(0)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.mergeRuntime?.status).toBe('approval_pending')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('platform merge')
    })

    it('cancels queued merge runtime and aborts the linked session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-cancel'
        const taskId = 'task-merge-cancel'
        const session = seedWorktreeSession(store, {
            namespace,
            tag: 'session-cancel',
            path: '/tmp/cancel'
        })

        seedMergeTask(store, {
            namespace,
            projectId,
            taskId,
            sessionId: session.id
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            mergeRuntime: {
                status: 'queued',
                sessionId: session.id,
                updatedAt: Date.now(),
                requestedAt: Date.now() - 1_000,
                latestNote: 'Queued already'
            }
        })

        let abortCalls = 0
        const engine = {
            resolveSessionAccess(sessionId: string) {
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: true,
                        metadata: {
                            path: '/tmp/cancel',
                            host: 'test-host',
                            worktree: {
                                basePath: '/tmp/cancel',
                                branch: 'task-branch',
                                name: 'cancel-worktree'
                            }
                        },
                        agentState: null
                    }
                }
            },
            async abortSession() {
                abortCalls += 1
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merge/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { canceled?: boolean }
        expect(body.canceled).toBe(true)
        expect(abortCalls).toBe(1)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.mergeRuntime?.status).toBe('canceled')
    })
})
