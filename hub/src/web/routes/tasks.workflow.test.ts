import { describe, expect, it } from 'bun:test'
import { PRODUCT_ENV, PRODUCT_MERGE_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'

function createTestApp(store: Store, engine: SyncEngine | null = null): Hono {
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

function seedTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    status: 'planned' | 'in_progress' | 'in_review' | 'finished' | 'blocked'
    activeSessionId?: string | null
}): void {
    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Merge Task',
        status: options.status,
        workflowProfile: 'default',
        activeSessionId: options.activeSessionId ?? null
    })
}

describe('tasks workflow strategy routes', () => {
    it('defaults new task workflow phase from task strategy', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-gsd'
        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'GSD Project',
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Task 1', workflowProfile: 'gsd' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { task?: { workflowPhase?: string | null } }
        expect(body.task?.workflowPhase).toBe('discuss')
    })

    it('applies strategy patch when task moves to finished', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-gsd-finish'
        const taskId = 'task-gsd-finish'

        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'GSD Project',
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_review',
            workflowProfile: 'gsd',
            workflowPhase: 'verify'
        })

        const app = createTestApp(store)
        const response = await app.request(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'finished' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { task?: { status?: string; workflowPhase?: string | null } }
        expect(body.task?.status).toBe('finished')
        expect(body.task?.workflowPhase).toBe('done')
    })

    it('auto-starts a merge session, runs the merge script directly, and records CLI output in the session thread', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-start'
        const taskId = 'task-merge-start'
        seedProject(store, { namespace, projectId })
        seedTask(store, { namespace, projectId, taskId, status: 'in_review', activeSessionId: null })

        const spawned = store.sessions.getOrCreateSession('spawned-session', {
            path: '/tmp/workspace',
            host: 'localhost',
            projectId,
            taskId,
            worktree: {
                basePath: '/tmp/workspace',
                branch: 'task-branch',
                name: 'task-branch'
            }
        }, null, namespace)

        let runBashCalls = 0
        let sendMessageCalls = 0
        let mergeStateCalls = 0
        const engine = {
            startSession: async () => ({
                type: 'success',
                sessionId: spawned.id
            }),
            resolveSessionAccess(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return { ok: false, reason: 'not-found' }
                }
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        namespace,
                        active: true,
                        thinking: false,
                        metadata: {
                            path: '/tmp/workspace',
                            host: 'localhost',
                            worktree: {
                                basePath: '/tmp/workspace',
                                branch: 'task-branch',
                                name: 'task-branch'
                            }
                        },
                        agentState: null
                    }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return undefined
                }
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/workspace',
                        host: 'localhost',
                        worktree: {
                            basePath: '/tmp/workspace',
                            branch: 'task-branch',
                            name: 'task-branch'
                        }
                    },
                    agentState: null
                }
            },
            async gitMergeWorktreeState() {
                mergeStateCalls += 1
                if (mergeStateCalls === 1) {
                    return {
                        success: true,
                        mergeable: true,
                        sourceBranch: 'task-branch',
                        targetBranch: 'main',
                        hasWorkingTreeChanges: true,
                        committedChangedCount: 1
                    }
                }
                return {
                    success: true,
                    mergeable: false,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 0
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async runBash(_sessionId: string, payload: { command: string; cwd?: string }) {
                runBashCalls += 1
                expect(payload.cwd).toBe('/tmp/workspace')
                expect(payload.command).toContain(PRODUCT_MERGE_SCRIPT_RELATIVE_PATH)
                expect(payload.command).toContain(`${PRODUCT_ENV.PROJECT_ROOT}='/tmp/workspace'`)
                return {
                    success: true,
                    stdout: 'merge ok\n',
                    stderr: ''
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
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
        const body = await response.json() as { skippedReason?: string | null; commitHash?: string | null }
        expect(body.skippedReason).toBeNull()
        expect(body.commitHash).toBe(TARGET_HEAD)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(runBashCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = store.messages.getMessages(spawned.id, 10)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain('HOPI auto-ran')
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain('repo-truth verification passed')
    })
})
