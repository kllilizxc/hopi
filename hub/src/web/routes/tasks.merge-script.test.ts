import { describe, expect, it } from 'bun:test'
import { PRODUCT_ENV, PRODUCT_MERGE_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'

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

function createMergeVerificationSnapshot(overrides?: Partial<{
    success: boolean
    targetBranch: string
    sourceBranch: string
    mergeBase: string
    snapshotRef: string
    expectedChangeCount: number
    error: string
}>): {
    success: boolean
    targetBranch?: string
    sourceBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    error?: string
} {
    return {
        success: true,
        targetBranch: 'main',
        sourceBranch: 'task-branch',
        mergeBase: MERGE_BASE,
        snapshotRef: SNAPSHOT_REF,
        expectedChangeCount: 1,
        ...overrides
    }
}

function createMergeVerificationResult(overrides?: Partial<{
    success: boolean
    verified: boolean
    targetBranch: string
    mergeBase: string
    snapshotRef: string
    expectedChangeCount: number
    targetHead: string
    error: string
}>): {
    success: boolean
    verified?: boolean
    targetBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    targetHead?: string
    error?: string
} {
    return {
        success: true,
        verified: true,
        targetBranch: 'main',
        mergeBase: MERGE_BASE,
        snapshotRef: SNAPSHOT_REF,
        expectedChangeCount: 1,
        targetHead: TARGET_HEAD,
        ...overrides
    }
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
    it('auto-runs the merge script directly and persists verified success without agent handoff', async () => {
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

        let mergeStateCalls = 0
        let captureCalls = 0
        let verifyCalls = 0
        let runBashCalls = 0
        let sendMessageCalls = 0
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
            async gitCaptureWorktreeMergeSnapshot() {
                captureCalls += 1
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult()
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string; timeout?: number }) {
                runBashCalls += 1
                expect(params.cwd).toBe('/tmp/worktree')
                expect(params.command).toContain(PRODUCT_MERGE_SCRIPT_RELATIVE_PATH)
                expect(params.command).toContain(`${PRODUCT_ENV.PROJECT_ROOT}='/tmp/worktree'`)
                expect(params.command).toContain(`${PRODUCT_ENV.TASK_ID}='${taskId}'`)
                expect(params.command).toContain(`${PRODUCT_ENV.TASK_PROJECT_ID}='${projectId}'`)
                expect(params.command).toContain(`${PRODUCT_ENV.MERGE_TARGET_BRANCH}='main'`)
                expect(params.command).toContain(`${PRODUCT_ENV.MERGE_SOURCE_BRANCH}='task-branch'`)
                expect(params.command).toContain(`${PRODUCT_ENV.WORKTREE_BASE_PATH}='/tmp/base'`)
                expect(params.command).toContain(`${PRODUCT_ENV.WORKTREE_PATH}='/tmp/worktree'`)
                return {
                    success: true,
                    stdout: 'merge ok\n',
                    stderr: ''
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
                throw new Error('sendMessage should not run after direct merge success')
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
        expect(body.commitHash).toBe(TARGET_HEAD)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergedAt).toBeTypeOf('number')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeStateCalls).toBe(2)
        expect(captureCalls).toBe(1)
        expect(verifyCalls).toBe(1)
        expect(runBashCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = store.messages.getMessages(sessionId, 10)
        expect(transcript).toHaveLength(1)
        expect(JSON.stringify(transcript[0]?.content)).toContain('HOPI auto-ran')
        expect(JSON.stringify(transcript[0]?.content)).toContain('repo-truth verification passed')
    })

    it('hands off to the agent with captured CLI output and no hidden backend retry when direct merge fails', async () => {
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

        let promptText = ''
        let gitMergeWorktreeCalls = 0
        let runBashCalls = 0
        let verifyCalls = 0
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
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult()
            },
            async gitMergeWorktree() {
                gitMergeWorktreeCalls += 1
                return {
                    success: true,
                    commitHash: 'unexpected'
                }
            },
            async runBash() {
                runBashCalls += 1
                return {
                    success: false,
                    stdout: '',
                    stderr: 'script exploded',
                    error: 'script exploded'
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
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('running')
        expect(promptText).toContain('HOPI already attempted the repo merge script directly before this prompt.')
        expect(promptText).toContain('script exploded')
        expect(promptText).toContain('Retry command after repairs:')
        expect(promptText).toContain('Do not assume `git checkout main` inside the task worktree is safe')
        expect(promptText).toContain(`${PRODUCT_ENV.WORKTREE_BASE_PATH}`)

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.worktreeMergedAt).toBeNull()
        expect(updatedTask?.mergeRuntime?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('Same blocker repeated with no repo progress')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('change the repo state or `.hopi/merge.sh`')
        expect(gitMergeWorktreeCalls).toBe(0)
        expect(runBashCalls).toBe(1)
        expect(verifyCalls).toBe(0)

        const transcript = store.messages.getMessages(sessionId, 10)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain('script exploded')
    })


    it('marks merge complete after an idle assistant summary even without a ready event', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-summary-success'
        const taskId = 'task-merge-summary-success'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-summary-success',
            {
                path: '/tmp/worktree-summary-success',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-summary-success',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId, status: 'in_progress' })

        let mergeStateCalls = 0
        let captureCalls = 0
        let verifyCalls = 0
        let runBashCalls = 0
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree-summary-success',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-summary-success',
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
                return mergeStateCalls <= 2
                    ? {
                        success: true,
                        sourceBranch: 'task-branch',
                        hasWorkingTreeChanges: true,
                        committedChangedCount: 2,
                        mergeable: true
                    }
                    : {
                        success: true,
                        sourceBranch: 'task-branch',
                        hasWorkingTreeChanges: false,
                        committedChangedCount: 0,
                        mergeable: false
                    }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                captureCalls += 1
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult()
            },
            async runBash() {
                runBashCalls += 1
                return {
                    success: false,
                    stdout: '',
                    stderr: 'script exploded',
                    error: 'script exploded'
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
                        content: { type: 'text', text: 'Summary\n\nMerge script repaired and merge completed successfully.' }
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
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded',
            timeoutMs: 1_000
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergedAt).toBeTypeOf('number')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(captureCalls).toBe(1)
        expect(verifyCalls).toBe(1)
        expect(runBashCalls).toBe(1)
    })


    it('waits for a thinking session, then auto-runs the merge script directly once it becomes free', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script-queued'
        const taskId = 'task-merge-script-queued'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script-queued',
            {
                path: '/tmp/worktree-queued',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-queued',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId, status: 'in_progress' })

        let captureCalls = 0
        let verifyCalls = 0
        let runBashCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: true,
            metadata: {
                path: '/tmp/worktree-queued',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-queued',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: null
        }

        setTimeout(() => {
            session.thinking = false
        }, 20)

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
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: runBashCalls === 0 ? 1 : 0,
                    mergeable: runBashCalls === 0
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                captureCalls += 1
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult()
            },
            async runBash() {
                runBashCalls += 1
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
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('queued')
        expect(runBashCalls).toBe(0)

        await waitForTask({
            store,
            taskId,
            predicate: (task) => Boolean(task?.worktreeMergedAt),
            timeoutMs: 2_000
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(runBashCalls).toBe(1)
        expect(captureCalls).toBe(1)
        expect(verifyCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = store.messages.getMessages(sessionId, 10)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain(PRODUCT_MERGE_SCRIPT_RELATIVE_PATH)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain('merge ok')
    })

    it('waits for approval requests to clear, then auto-runs the merge script directly without agent handoff', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-script-approval'
        const taskId = 'task-merge-script-approval'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-script-approval',
            {
                path: '/tmp/worktree-approval',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-approval',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedMergeTask(store, { projectId, taskId, sessionId, status: 'in_progress' })

        let captureCalls = 0
        let verifyCalls = 0
        let runBashCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            namespace: 'default',
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/worktree-approval',
                host: 'test-host',
                worktree: {
                    basePath: '/tmp/base-approval',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            agentState: {
                requests: {
                    req1: { id: 'req1' }
                } as Record<string, { id: string }>
            }
        }

        setTimeout(() => {
            session.agentState = { requests: {} }
        }, 20)

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
                    targetBranch: 'main',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: runBashCalls === 0 ? 1 : 0,
                    mergeable: runBashCalls === 0
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                captureCalls += 1
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult()
            },
            async runBash() {
                runBashCalls += 1
                return {
                    success: true,
                    stdout: 'merge ok after approval\n',
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
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('approval_pending')
        expect(runBashCalls).toBe(0)

        await waitForTask({
            store,
            taskId,
            predicate: (task) => Boolean(task?.worktreeMergedAt),
            timeoutMs: 2_000
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(runBashCalls).toBe(1)
        expect(captureCalls).toBe(1)
        expect(verifyCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = store.messages.getMessages(sessionId, 10)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain(PRODUCT_MERGE_SCRIPT_RELATIVE_PATH)
        expect(JSON.stringify(transcript.map((message) => message.content))).toContain('merge ok after approval')
    })

    it('hands off to the agent when direct merge finishes but repo-truth verification still cannot prove success', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-verification-blocked'
        const taskId = 'task-merge-verification-blocked'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-verification-blocked',
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
        let verifyCalls = 0
        let runBashCalls = 0
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
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                verifyCalls += 1
                return createMergeVerificationResult({
                    verified: false,
                    error: 'Target branch does not contain the expected worktree changes'
                })
            },
            async runBash() {
                runBashCalls += 1
                return {
                    success: true,
                    stdout: 'merge ok\n',
                    stderr: ''
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
        const body = await response.json() as { skippedReason?: string | null }
        expect(body.skippedReason).toBe('running')
        expect(promptText).toContain('repo-truth verification failed')
        expect(promptText).toContain('HOPI already attempted the repo merge script directly before this prompt.')

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.worktreeMergedAt).toBeNull()
        expect(updatedTask?.mergeRuntime?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('Same blocker repeated with no repo progress')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('verify the target branch manually')
        expect(runBashCalls).toBe(1)
        expect(verifyCalls).toBe(2)
    })

    it('increments retry count when a blocked merge is retried into the same verified blocker', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-retry-count'
        const taskId = 'task-merge-retry-count'
        const sessionId = store.sessions.getOrCreateSession(
            'session-merge-retry-count',
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
        store.tasks.updateTaskByNamespace(taskId, 'default', {
            mergeRuntime: {
                status: 'blocked',
                sessionId,
                updatedAt: Date.now() - 5_000,
                requestedAt: Date.now() - 10_000,
                startedAt: Date.now() - 9_000,
                completedAt: Date.now() - 5_000,
                retryCount: 1,
                failureFingerprint: 'verification_failed:seed',
                latestNote: 'Previous merge blocker.',
                blockedReason: 'Target branch does not contain the expected worktree changes'
            }
        })

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
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult({
                    verified: false,
                    error: 'Target branch does not contain the expected worktree changes'
                })
            },
            async runBash() {
                return {
                    success: true,
                    stdout: 'merge ok\n',
                    stderr: ''
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

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'blocked' && task?.mergeRuntime?.retryCount === 2
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.retryCount).toBe(2)
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('Same blocker repeated with no repo progress')
        expect(updatedTask?.mergeRuntime?.failureFingerprint).toContain('verification_failed:')
    })

})
