import { describe, expect, it } from 'bun:test'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
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
    '  strategy: squash',
    '  conflictResolution:',
    '    mode: ai',
    '    maxAttempts: 2'
].join('\n')
const VERIFY_ACTIONS_MANIFEST = [
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
    '  strategy: squash',
    '  verify:',
    '    - type: run',
    '      cwd: .',
    '      run: ["bun", "test"]',
    '    - type: snapshot_contains_changes'
].join('\n')

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
    status?: 'planning' | 'running' | 'review' | 'done' | 'blocked'
}) {
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
        status: options.status ?? 'review',
        workflowProfile: 'default',
        activeSessionId: options.sessionId
    })
}

function createSession(sessionId: string) {
    return {
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
}

function createContractResponse(manifest = VALID_ACTIONS_MANIFEST) {
    return {
        success: true,
        content: Buffer.from(manifest, 'utf8').toString('base64')
    }
}

function createMergeVerificationSnapshot() {
    return {
        success: true,
        targetBranch: 'main',
        sourceBranch: 'task-branch',
        mergeBase: MERGE_BASE,
        snapshotRef: SNAPSHOT_REF,
        expectedChangeCount: 1
    }
}

function createMergeVerificationResult() {
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

async function waitForTask(options: {
    store: Store
    taskId: string
    predicate: (task: ReturnType<Store['tasks']['getTaskByNamespace']>) => boolean
    timeoutMs?: number
}) {
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

describe('tasks merge route contract workflow', () => {
    it('lands a task with the platform merge workflow without agent handoff', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-success'
        const taskId = 'task-merge-platform-success'
        const sessionId = store.sessions.getOrCreateSession('session-merge-success', createSession('session-merge-success').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let mergeCalls = 0
        let sendMessageCalls = 0
        const session = createSession(sessionId)
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return createContractResponse()
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
            async gitMergeWorktree(_sessionId: string, params: { strategy?: string }) {
                mergeCalls += 1
                expect(params.strategy).toBe('squash')
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
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
        const body = await response.json() as { ok?: boolean; skippedReason?: string | null; commitHash?: string | null }
        expect(body.ok).toBe(true)
        expect(body.skippedReason).toBeNull()
        expect(body.commitHash).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 20).map((message) => message.content))
        expect(transcript).toContain('completed the platform merge')
    })

    it('lands a task with the default merge workflow when actions manifest is missing', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-default'
        const taskId = 'task-merge-platform-default'
        const sessionId = store.sessions.getOrCreateSession('session-merge-default', createSession('session-merge-default').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let mergeCalls = 0
        let observedStateTargetBranch = ''
        let observedMergeTargetBranch = ''
        let observedMergeStrategy = ''
        const session = createSession(sessionId)
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'ENOENT: no such file or directory'
                }
            },
            async gitMergeWorktreeState(_sessionId: string, params: { targetBranch: string }) {
                observedStateTargetBranch = params.targetBranch
                return {
                    success: true,
                    targetBranch: params.targetBranch,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot(_sessionId: string, params: { targetBranch: string }) {
                return {
                    success: true,
                    targetBranch: params.targetBranch,
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree(_sessionId: string, params: { targetBranch: string; strategy?: string }) {
                mergeCalls += 1
                observedMergeTargetBranch = params.targetBranch
                observedMergeStrategy = params.strategy ?? ''
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async sendMessage() {
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
        const body = await response.json() as { ok?: boolean; commitHash?: string | null }
        expect(body.ok).toBe(true)
        expect(body.commitHash).toBe(TARGET_HEAD)
        expect(observedStateTargetBranch).toBe('main')
        expect(observedMergeTargetBranch).toBe('main')
        expect(observedMergeStrategy).toBe('squash')
        expect(mergeCalls).toBe(1)
    })

    it('hands conflicts to the linked session, then retries platform merge after the assistant is ready', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-conflict'
        const taskId = 'task-merge-platform-conflict'
        const sessionId = store.sessions.getOrCreateSession('session-merge-conflict', createSession('session-merge-conflict').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        let mergeCalls = 0
        let sendMessageCalls = 0
        const session = createSession(sessionId)
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return createContractResponse()
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
            async gitMergeWorktree() {
                mergeCalls += 1
                if (mergeCalls === 1) {
                    return {
                        success: false,
                        error: 'Merge conflicts detected; manual resolution required',
                        conflictFiles: ['src/app.ts']
                    }
                }
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)
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
        expect(sendMessageCalls).toBe(1)

        const promptMessage = store.messages.getMessages(sessionId, 20).find((message) => message.localId?.startsWith('auto:merge_runtime:'))
        expect(promptMessage?.localId).toBeTruthy()

        if (!promptMessage?.localId) {
            throw new Error('Expected merge repair prompt')
        }

        store.messages.addMessage(sessionId, {
            role: 'assistant',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptMessage.localId
                }
            }
        }, `ready:${promptMessage.localId}`)

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(2)

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 30).map((message) => message.content))
        expect(transcript).toContain('found conflicts')
        expect(transcript).toContain('retried the platform merge')
    })

    it('restarts a retrying merge runtime when the in-memory monitor was lost', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-monitor-lost'
        const taskId = 'task-merge-monitor-lost'
        const sessionId = store.sessions.getOrCreateSession('session-merge-monitor-lost', createSession('session-merge-monitor-lost').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })
        store.tasks.updateTaskByNamespace(taskId, 'default', {
            mergeRuntime: {
                status: 'retrying',
                sessionId,
                requestedAt: Date.now() - 2_000,
                startedAt: Date.now() - 1_500,
                updatedAt: Date.now() - 1_000,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                blockedReason: null,
                failure: null
            }
        })

        const session = createSession(sessionId)
        let mergeCalls = 0
        const engine = {
            resolveSessionAccess(id: string, namespace: string) {
                return id === sessionId && namespace === 'default'
                    ? { ok: true as const, sessionId, session }
                    : { ok: false as const, reason: 'not-found' as const }
            },
            getSessionByNamespace(id: string, namespace: string) {
                return id === sessionId && namespace === 'default' ? session : undefined
            },
            async readSessionFile() {
                return createContractResponse()
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/story.ts\n' }
            },
            async archiveSession() {
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
        expect(body.skippedReason).toBeNull()

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.status).toBe('done')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(mergeCalls).toBe(1)
    })

    it('runs contract-defined merge verify commands before landing', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-verify-run'
        const taskId = 'task-merge-platform-verify-run'
        const sessionId = store.sessions.getOrCreateSession('session-merge-verify-run', createSession('session-merge-verify-run').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        const session = createSession(sessionId)
        let runBashCalls = 0
        let mergeCalls = 0
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return createContractResponse(VERIFY_ACTIONS_MANIFEST)
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                runBashCalls += 1
                expect(params.cwd).toBe('/tmp/worktree')
                expect(params.command).toContain("'bun' 'test'")
                expect(params.command).toContain(`${PRODUCT_ENV.PROJECT_ROOT}='/tmp/worktree'`)
                expect(params.command).toContain(`${PRODUCT_ENV.TASK_ID}='task-merge-platform-verify-run'`)
                expect(params.command).toContain(`${PRODUCT_ENV.MERGE_TARGET_BRANCH}='main'`)
                return {
                    success: true,
                    stdout: 'tests ok\n',
                    stderr: ''
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
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
        expect(runBashCalls).toBe(1)
        expect(mergeCalls).toBe(1)
    })

    it('auto-repairs merge verify command failures, then retries merge after the assistant is ready', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-verify-repair'
        const taskId = 'task-merge-platform-verify-repair'
        const sessionId = store.sessions.getOrCreateSession('session-merge-verify-repair', createSession('session-merge-verify-repair').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        const session = createSession(sessionId)
        let runBashCalls = 0
        let mergeCalls = 0
        let sendMessageCalls = 0
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return createContractResponse(VERIFY_ACTIONS_MANIFEST)
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                runBashCalls += 1
                expect(params.command).toContain("'bun' 'test'")
                if (runBashCalls === 1) {
                    return {
                        success: false,
                        stdout: '',
                        stderr: 'typecheck failed\n'
                    }
                }
                return {
                    success: true,
                    stdout: 'tests ok\n',
                    stderr: ''
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitMergeWorktree() {
                mergeCalls += 1
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return createMergeVerificationResult()
            },
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text }
                }, payload.localId)
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
        expect(sendMessageCalls).toBe(1)
        expect(mergeCalls).toBe(0)

        const promptMessage = store.messages.getMessages(sessionId, 20).find((message) => message.localId?.startsWith('auto:merge_runtime:'))
        expect(promptMessage?.localId).toBeTruthy()
        const transcriptBeforeReady = JSON.stringify(store.messages.getMessages(sessionId, 20).map((message) => message.content))
        expect(transcriptBeforeReady).toContain('merge verification')

        if (!promptMessage?.localId) {
            throw new Error('Expected merge verify repair prompt')
        }

        store.messages.addMessage(sessionId, {
            role: 'assistant',
            content: {
                type: 'event',
                data: {
                    type: 'ready',
                    forLocalKey: promptMessage.localId
                }
            }
        }, `ready:${promptMessage.localId}`)

        await waitForTask({
            store,
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(runBashCalls).toBe(2)
        expect(mergeCalls).toBe(1)

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 30).map((message) => message.content))
        expect(transcript).toContain('merge verification')
        expect(transcript).toContain('retried the platform merge')
    })

    it('blocks immediately when the merge workflow contract forbids conflicted paths', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-merge-platform-blocked'
        const taskId = 'task-merge-platform-blocked'
        const sessionId = store.sessions.getOrCreateSession('session-merge-blocked', createSession('session-merge-blocked').metadata, null, 'default').id
        seedMergeTask(store, { projectId, taskId, sessionId })

        const manifest = VALID_ACTIONS_MANIFEST.concat('\n    blockPaths: ["infra/**"]')
        const session = createSession(sessionId)
        let sendMessageCalls = 0
        const engine = {
            resolveSessionAccess() {
                return { ok: true, sessionId, session }
            },
            getSessionByNamespace() {
                return session
            },
            async readSessionFile() {
                return createContractResponse(manifest)
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return createMergeVerificationSnapshot()
            },
            async gitMergeWorktree() {
                return {
                    success: false,
                    error: 'Merge conflicts detected; manual resolution required',
                    conflictFiles: ['infra/main.tf']
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

        expect(response.status).toBe(500)
        expect(sendMessageCalls).toBe(0)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.status).toBe('blocked')
        expect(updatedTask?.mergeRuntime?.latestNote).toContain('blocked path')
    })
})
