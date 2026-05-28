import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { PRODUCT_PREVIEW_READY_MARKER, PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function seedPreviewTask(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    sessionId: string
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: options.namespace,
        machineId: 'machine-1',
        name: 'Preview Project'
    })

    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Preview Task',
        status: 'in_progress',
        workflowProfile: 'default',
        activeSessionId: options.sessionId
    })
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


async function waitForTranscript(options: {
    store: Store
    sessionId: string
    predicate: (transcript: string) => boolean
    timeoutMs?: number
}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 3_000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
        const transcript = JSON.stringify(options.store.messages.getMessages(options.sessionId, 50).map((message) => message.content))
        if (options.predicate(transcript)) {
            return transcript
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('Timed out waiting for transcript update')
}

async function waitForPreviewRuntime(options: {
    store: Store
    taskId: string
    predicate: (runtime: Record<string, unknown> | null) => boolean
    timeoutMs?: number
}): Promise<Record<string, unknown> | null> {
    const timeoutMs = options.timeoutMs ?? 3_000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
        const runtime = options.store.tasks.getTaskByNamespace(options.taskId, 'default')?.previewRuntime as Record<string, unknown> | null | undefined
        const normalized = runtime && typeof runtime === 'object' ? runtime : null
        if (options.predicate(normalized)) {
            return normalized
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('Timed out waiting for preview runtime update')
}

function getLatestPreviewRuntimeFromEvent(events: Array<Record<string, unknown>>, taskId: string): Record<string, unknown> | null {
    const event = [...events].reverse().find((entry) => entry.type === 'task-updated' && entry.taskId === taskId)
    if (!event || typeof event.data !== 'object' || !event.data) {
        return null
    }

    const data = event.data as Record<string, unknown>
    return typeof data.previewRuntime === 'object' && data.previewRuntime
        ? data.previewRuntime as Record<string, unknown>
        : null
}

function normalizePreviewRuntimeTextForTest(text: string, maxChars = 512): string {
    const normalized = text.trim().replace(/\s+/g, ' ')
    if (normalized.length <= maxChars) {
        return normalized
    }

    return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`
}

function buildPreviewFailureFingerprintForTest(options: {
    reason: 'preview_start_failed'
    blockedReason: string
    previewPath: { mode: 'local' | 'worktree'; rootPath: string }
}): string {
    const digest = createHash('sha1').update(JSON.stringify({
        reason: options.reason,
        blockedReason: normalizePreviewRuntimeTextForTest(options.blockedReason, 512),
        previewPath: {
            mode: options.previewPath.mode,
            rootPath: options.previewPath.rootPath
        },
        preview: null
    })).digest('hex').slice(0, 12)

    return `${options.reason}:${digest}`
}

describe('tasks preview start route', () => {
    it('auto-prompts agent to create preview.sh and retries start when command is missing', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-auto-setup'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-auto-setup',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-auto-setup',
            taskId,
            sessionId
        })

        let startCalls = 0
        let sentPrompt: { text?: string; localId?: string } = {}
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
        }

        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            async previewStartForSession() {
                startCalls += 1
                if (startCalls === 1) {
                    throw new Error(`No preview command found. Create ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH} or add package.json script preview/dev/start`)
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: `bash ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}`,
                    url: 'http://127.0.0.1:5173',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sentPrompt = payload
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'preview script ready' }
                })
            },
            getSessionByNamespace(id: string) {
                if (id !== sessionId) {
                    return null
                }
                return session
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string }
            autoSetupAttempted?: boolean
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:5173')
        expect(body.autoSetupAttempted).toBe(true)
        expect(startCalls).toBe(2)
        expect(sentPrompt?.localId?.startsWith('auto:preview_setup:')).toBe(true)
        expect(sentPrompt?.text?.includes(PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH)).toBe(true)
        expect(sentPrompt?.text?.includes(PRODUCT_PREVIEW_READY_MARKER)).toBe(true)

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 10).map((message) => message.content))
        expect(transcript).toContain('attempted preview start directly')
        expect(transcript).toContain('Preview auto-repair completed and direct retry now works.')
    })

    it('auto-repairs preview when direct start exits before ready', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-auto-repair'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-auto-repair',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-auto-repair',
            taskId,
            sessionId
        })

        let startCalls = 0
        let sendMessageCalls = 0
        let sentPrompt = ''
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                if (startCalls === 1) {
                    throw new Error('Preview process exited with code 1')
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:5173',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready']
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sendMessageCalls += 1
                sentPrompt = payload.text ?? ''
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'preview runtime repaired' }
                }, payload.localId)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string }
            autoRepairAttempted?: boolean
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:5173')
        expect(body.autoRepairAttempted).toBe(true)
        expect(startCalls).toBe(2)
        expect(sendMessageCalls).toBe(1)
        expect(sentPrompt).toContain('The preview process still failed after launch.')
        expect(sentPrompt).toContain('Preview process exited with code 1')

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 10).map((message) => message.content))
        expect(transcript).toContain('attempted preview start directly')
        expect(transcript).toContain('Preview auto-repair completed and direct retry now works.')
    })


    it('keeps monitoring after a successful response and auto-repairs late preview crashes', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-late-crash'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-late-crash',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-late-crash',
            taskId,
            sessionId
        })

        let startCalls = 0
        let statusCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                if (startCalls === 1) {
                    return {
                        active: true,
                        status: 'ready',
                        taskId,
                        sessionId,
                        mode: 'local',
                        rootPath: '/tmp/preview-root',
                        command: 'bun run dev',
                        url: 'http://127.0.0.1:5173',
                        updatedAt: Date.now(),
                        logTail: ['stdout: ready']
                    }
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:5174',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready again']
                }
            },
            async previewStatusForSession() {
                statusCalls += 1
                if (startCalls === 1) {
                    return {
                        active: false,
                        status: 'error',
                        taskId,
                        sessionId,
                        mode: 'local',
                        rootPath: '/tmp/preview-root',
                        command: 'bun run dev',
                        updatedAt: Date.now(),
                        error: 'Preview process exited with code 1',
                        logTail: ['stderr: late boom']
                    }
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:5174',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready again']
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: payload.text ?? '' }
                }, payload.localId)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string }
            autoRepairAttempted?: boolean
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:5173')
        expect(body.autoRepairAttempted).toBeUndefined()

        const transcript = await waitForTranscript({
            store,
            sessionId,
            predicate: (value) => value.includes('Preview background auto-repair completed and direct retry now works.')
        })

        expect(startCalls).toBe(2)
        expect(statusCalls).toBeGreaterThanOrEqual(1)
        expect(sendMessageCalls).toBe(1)
        expect(transcript).toContain('Preview crashed after earlier startup success.')
        expect(transcript).toContain('stderr: late boom')
    })

    it('auto-repairs preview when the process crashes shortly after starting', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-runtime-crash'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-runtime-crash',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-runtime-crash',
            taskId,
            sessionId
        })

        let startCalls = 0
        let statusCalls = 0
        let sentPrompt = ''
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                if (startCalls === 1) {
                    return {
                        active: true,
                        status: 'starting',
                        taskId,
                        sessionId,
                        mode: 'local',
                        rootPath: '/tmp/preview-root',
                        command: 'bun run dev',
                        updatedAt: Date.now(),
                        logTail: ['stdout: booting']
                    }
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready']
                }
            },
            async previewStatusForSession() {
                statusCalls += 1
                if (startCalls === 1) {
                    return {
                        active: false,
                        status: 'error',
                        taskId,
                        sessionId,
                        mode: 'local',
                        rootPath: '/tmp/preview-root',
                        command: 'bun run dev',
                        updatedAt: Date.now(),
                        error: 'Preview process exited with code 1',
                        logTail: ['stderr: boom']
                    }
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready']
                }
            },
            async sendMessage(_sessionId: string, payload: { text?: string; localId?: string }) {
                sentPrompt = payload.text ?? ''
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'runtime preview fix ready' }
                }, payload.localId)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string }
            autoRepairAttempted?: boolean
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:4173')
        expect(body.autoRepairAttempted).toBe(true)
        expect(startCalls).toBe(2)
        expect(statusCalls).toBeGreaterThanOrEqual(1)
        expect(sentPrompt).toContain('Last preview command: `bun run dev`')
        expect(sentPrompt).toContain('stderr: boom')

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 12).map((message) => message.content))
        expect(transcript).toContain('Preview auto-repair completed and direct retry now works.')
        expect(transcript).toContain('stderr: boom')
    })

    it('falls back from worktree path to local path when preview command is missing', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-local-fallback'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-local-fallback',
            {
                path: '/tmp/worktree-root',
                worktree: {
                    basePath: '/tmp/base-root',
                    worktreePath: '/tmp/worktree-root',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-local-fallback',
            taskId,
            sessionId
        })

        const attemptedRoots: string[] = []
        let sendMessageCalls = 0
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session: {
                        id: sessionId,
                        active: true,
                        thinking: false,
                        metadata: {
                            path: '/tmp/worktree-root',
                            worktree: {
                                basePath: '/tmp/base-root',
                                worktreePath: '/tmp/worktree-root',
                                branch: 'task-branch',
                                name: 'task-branch'
                            }
                        }
                    }
                }
            },
            async previewStartForSession(_sessionId: string, params: { rootPath: string; mode: 'local' | 'worktree' }) {
                attemptedRoots.push(`${params.mode}:${params.rootPath}`)
                if (params.rootPath === '/tmp/worktree-root') {
                    throw new Error(`No preview command found. Create ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH} or add package.json script preview/dev/start`)
                }
                return {
                    active: true,
                    status: 'ready',
                    taskId,
                    sessionId,
                    mode: 'local',
                    rootPath: '/tmp/base-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:5173',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string; mode?: string; rootPath?: string }
            autoSetupAttempted?: boolean
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:5173')
        expect(body.autoSetupAttempted).toBeUndefined()
        expect(attemptedRoots).toEqual([
            'worktree:/tmp/worktree-root',
            'local:/tmp/base-root'
        ])
        expect(sendMessageCalls).toBe(0)

        const transcript = JSON.stringify(store.messages.getMessages(sessionId, 10).map((message) => message.content))
        expect(transcript).toContain('Fallback succeeded after worktree preview root reported no runnable command.')
        expect(transcript).toContain('bun run dev')
    })

    it('queues preview behind a thinking session and auto-runs once the session is idle', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-queued-auto-run'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-queued-auto-run',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-queued-auto-run',
            taskId,
            sessionId
        })

        let startCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: true,
            metadata: {
                path: '/tmp/preview-root'
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
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4173',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready']
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string }
            skippedReason?: string | null
            previewRuntime?: { status?: string; latestNote?: string | null }
        }
        expect(body.preview.status).toBe('starting')
        expect(body.skippedReason).toBe('queued')
        expect(body.previewRuntime?.status).toBe('queued')
        expect(body.previewRuntime?.latestNote).toContain('auto-run preview start')
        expect(startCalls).toBe(0)

        session.thinking = false
        const runtime = await waitForPreviewRuntime({
            store,
            taskId,
            predicate: (value) => value?.status === 'ready'
        })
        expect(runtime?.status).toBe('ready')
        expect(startCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = await waitForTranscript({
            store,
            sessionId,
            predicate: (value) => value.includes('started preview directly')
        })
        expect(transcript).toContain('started preview directly')
    })

    it('waits for approval requests to clear before auto-running preview', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-approval-auto-run'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-approval-auto-run',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-approval-auto-run',
            taskId,
            sessionId
        })

        let startCalls = 0
        let sendMessageCalls = 0
        const session: {
            id: string
            active: boolean
            thinking: boolean
            metadata: { path: string }
            agentState: { requests: Record<string, { type: string }> } | null
        } = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            },
            agentState: {
                requests: {
                    'req-1': {
                        type: 'permission'
                    }
                }
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4273',
                    updatedAt: Date.now(),
                    logTail: ['stdout: ready']
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string }
            skippedReason?: string | null
            previewRuntime?: { status?: string; latestNote?: string | null }
        }
        expect(body.preview.status).toBe('starting')
        expect(body.skippedReason).toBe('approval_pending')
        expect(body.previewRuntime?.status).toBe('approval_pending')
        expect(body.previewRuntime?.latestNote).toContain('auto-run preview start')
        expect(startCalls).toBe(0)
        expect(sendMessageCalls).toBe(0)

        session.agentState = { requests: {} }
        const runtime = await waitForPreviewRuntime({
            store,
            taskId,
            predicate: (value) => value?.status === 'ready'
        })
        expect(runtime?.status).toBe('ready')
        expect(startCalls).toBe(1)
    })

    it('persists retry count and repeated blocker note when the same preview failure repeats', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-repeated-blocker'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-repeated-blocker',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-repeated-blocker',
            taskId,
            sessionId
        })

        let startCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                throw new Error('Preview process exited with code 1')
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage(_sessionId: string, payload: { localId?: string }) {
                sendMessageCalls += 1
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'preview repair attempted' }
                }, payload.localId)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as {
            error: string
            autoRepairAttempted?: boolean
            previewRuntime?: {
                status?: string
                retryCount?: number
                failureFingerprint?: string | null
                latestNote?: string | null
                blockedReason?: string | null
            }
        }
        expect(body.error).toBe('Preview process exited with code 1')
        expect(body.autoRepairAttempted).toBe(true)
        expect(body.previewRuntime?.status).toBe('blocked')
        expect(body.previewRuntime?.retryCount).toBe(1)
        expect(body.previewRuntime?.failureFingerprint?.startsWith('preview_start_failed:')).toBe(true)
        expect(body.previewRuntime?.latestNote).toContain('Same blocker repeated')
        expect(body.previewRuntime?.latestNote).toContain('retry preview')
        expect(body.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')
        expect(startCalls).toBe(2)
        expect(sendMessageCalls).toBe(1)
    })

    it('reuses the durable preview blocker fingerprint on manual retry without another repair prompt', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-durable-repeated-blocker'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-durable-repeated-blocker',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-durable-repeated-blocker',
            taskId,
            sessionId
        })

        const failureFingerprint = buildPreviewFailureFingerprintForTest({
            reason: 'preview_start_failed',
            blockedReason: 'Preview process exited with code 1',
            previewPath: {
                mode: 'local',
                rootPath: '/tmp/preview-root'
            }
        })
        store.tasks.updateTaskByNamespace(taskId, 'default', {
            previewRuntime: {
                status: 'blocked',
                sessionId,
                updatedAt: Date.now(),
                requestedAt: Date.now() - 1_000,
                startedAt: Date.now() - 900,
                completedAt: Date.now() - 800,
                retryCount: 1,
                failureFingerprint,
                latestNote: 'Preview blocked already',
                blockedReason: 'Preview process exited with code 1'
            }
        })

        let startCalls = 0
        let sendMessageCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                throw new Error('Preview process exited with code 1')
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async sendMessage() {
                sendMessageCalls += 1
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as {
            error: string
            autoRepairAttempted?: boolean
            previewRuntime?: {
                status?: string
                retryCount?: number
                failureFingerprint?: string | null
                latestNote?: string | null
                blockedReason?: string | null
            }
        }
        expect(body.error).toBe('Preview process exited with code 1')
        expect(body.autoRepairAttempted).toBeUndefined()
        expect(body.previewRuntime?.status).toBe('blocked')
        expect(body.previewRuntime?.retryCount).toBe(1)
        expect(body.previewRuntime?.failureFingerprint).toBe(failureFingerprint)
        expect(body.previewRuntime?.latestNote).toContain('Same blocker repeated with no repo progress')
        expect(body.previewRuntime?.latestNote).toContain('Inspect the linked session tool output, change the repo state or `.hopi/preview.sh`, then retry preview.')
        expect(body.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')
        expect(startCalls).toBe(1)
        expect(sendMessageCalls).toBe(0)

        const transcript = await waitForTranscript({
            store,
            sessionId,
            predicate: (value) => value.includes('attempted preview start directly')
        })
        expect(transcript).toContain('Preview process exited with code 1')
    })

    it('cancels a queued preview without auto-running it later', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-cancel-queued'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-cancel-queued',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-cancel-queued',
            taskId,
            sessionId
        })

        let startCalls = 0
        let stopCalls = 0
        const session = {
            id: sessionId,
            active: true,
            thinking: true,
            metadata: {
                path: '/tmp/preview-root'
            }
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
                return id === sessionId ? session : null
            },
            async previewStartForSession() {
                startCalls += 1
                return {
                    active: true,
                    status: 'ready' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    url: 'http://127.0.0.1:4373',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async previewStopForSession() {
                stopCalls += 1
                return {
                    active: false,
                    status: 'stopped' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    updatedAt: Date.now(),
                    logTail: []
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(startResponse.status).toBe(200)
        const startBody = await startResponse.json() as {
            previewRuntime?: { status?: string }
        }
        expect(startBody.previewRuntime?.status).toBe('queued')
        expect(startCalls).toBe(0)

        const stopResponse = await app.request(`/api/tasks/${taskId}/preview/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(stopResponse.status).toBe(200)
        const stopBody = await stopResponse.json() as {
            preview: { status: string }
            previewRuntime?: { status?: string; latestNote?: string | null }
        }
        expect(stopBody.preview.status).toBe('idle')
        expect(stopBody.previewRuntime?.status).toBe('canceled')
        expect(stopBody.previewRuntime?.latestNote).toContain('canceled')
        expect(stopCalls).toBe(0)

        session.thinking = false
        await new Promise((resolve) => setTimeout(resolve, 700))
        expect(startCalls).toBe(0)

        const runtime = store.tasks.getTaskByNamespace(taskId, 'default')?.previewRuntime
        expect(runtime?.status).toBe('canceled')
    })
})

describe('tasks preview runtime route contract', () => {
    it('includes durable previewRuntime on successful start and get responses', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-runtime-success'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-runtime-success',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-runtime-success',
            taskId,
            sessionId
        })

        const realtimeEvents: Array<Record<string, unknown>> = []
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
        }
        const readyPreview = {
            active: true,
            status: 'ready' as const,
            taskId,
            sessionId,
            mode: 'local' as const,
            rootPath: '/tmp/preview-root',
            command: 'bun run dev',
            url: 'http://127.0.0.1:4173',
            updatedAt: Date.now(),
            logTail: ['stdout: ready']
        }
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            async previewStartForSession() {
                return readyPreview
            },
            async previewStatusForSession() {
                return {
                    ...readyPreview,
                    updatedAt: Date.now()
                }
            },
            handleRealtimeEvent(event: Record<string, unknown>) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(startResponse.status).toBe(200)
        const startBody = await startResponse.json() as {
            preview: { status: string; url?: string }
            previewRuntime?: { status?: string; sessionId?: string | null; latestNote?: string | null }
        }
        expect(startBody.preview.status).toBe('ready')
        expect(startBody.preview.url).toBe('http://127.0.0.1:4173')
        expect(startBody.previewRuntime?.status).toBe('ready')
        expect(startBody.previewRuntime?.sessionId).toBe(sessionId)
        expect(startBody.previewRuntime?.latestNote).toContain('ready')

        const getResponse = await app.request(`/api/tasks/${taskId}/preview`)
        expect(getResponse.status).toBe(200)
        const getBody = await getResponse.json() as {
            preview: { status: string; url?: string }
            previewRuntime?: { status?: string }
        }
        expect(getBody.preview.status).toBe('ready')
        expect(getBody.previewRuntime?.status).toBe('ready')

        expect(getLatestPreviewRuntimeFromEvent(realtimeEvents, taskId)?.status).toBe('ready')
    })

    it('treats preview as ready when startup logs already contain the ready marker', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-ready-marker'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-ready-marker',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-ready-marker',
            taskId,
            sessionId
        })

        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
        }
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            async previewStartForSession() {
                return {
                    active: true,
                    status: 'starting' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: `bash ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}`,
                    updatedAt: Date.now(),
                    logTail: [`stdout: ${PRODUCT_PREVIEW_READY_MARKER}http://127.0.0.1:4174`]
                }
            },
            async previewStatusForSession() {
                return {
                    active: true,
                    status: 'starting' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: `bash ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}`,
                    updatedAt: Date.now(),
                    logTail: [`stdout: ${PRODUCT_PREVIEW_READY_MARKER}http://127.0.0.1:4174`]
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            preview: { status: string; url?: string; port?: number }
            previewRuntime?: { status?: string; latestNote?: string | null }
        }
        expect(body.preview.status).toBe('ready')
        expect(body.preview.url).toBe('http://127.0.0.1:4174')
        expect(body.preview.port).toBe(4174)
        expect(body.previewRuntime?.status).toBe('ready')
        expect(body.previewRuntime?.latestNote).toContain('http://127.0.0.1:4174')
    })

    it('persists blocked previewRuntime when start and repair both fail', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-runtime-blocked'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-runtime-blocked',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-runtime-blocked',
            taskId,
            sessionId
        })

        const realtimeEvents: Array<Record<string, unknown>> = []
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
        }
        const failingPreview = {
            active: false,
            status: 'error' as const,
            taskId,
            sessionId,
            mode: 'local' as const,
            rootPath: '/tmp/preview-root',
            command: 'bun run dev',
            updatedAt: Date.now(),
            error: 'Preview process exited with code 1',
            logTail: ['stderr: boom']
        }
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            async previewStartForSession() {
                return {
                    ...failingPreview,
                    updatedAt: Date.now()
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            getSessionByNamespace(id: string) {
                return id === sessionId ? session : null
            },
            async sendMessage(_sessionId: string, payload: { localId?: string }) {
                store.messages.addMessage(sessionId, {
                    role: 'assistant',
                    content: { type: 'text', text: 'preview repair attempted' }
                }, payload.localId)
            },
            handleRealtimeEvent(event: Record<string, unknown>) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const startResponse = await app.request(`/api/tasks/${taskId}/preview/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(startResponse.status).toBe(500)
        const startBody = await startResponse.json() as {
            error: string
            autoRepairAttempted?: boolean
            previewRuntime?: { status?: string; blockedReason?: string | null; latestNote?: string | null }
        }
        expect(startBody.error).toContain('Preview process exited with code 1')
        expect(startBody.autoRepairAttempted).toBe(true)
        expect(startBody.previewRuntime?.status).toBe('blocked')
        expect(startBody.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')
        expect(startBody.previewRuntime?.latestNote).toContain('retry preview')
        const blockedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(blockedTask?.status).toBe('blocked')
        expect(blockedTask?.blockedReason).toBe('Preview process exited with code 1')

        const getResponse = await app.request(`/api/tasks/${taskId}/preview`)
        expect(getResponse.status).toBe(200)
        const getBody = await getResponse.json() as {
            preview: { status: string }
            previewRuntime?: { status?: string; blockedReason?: string | null }
        }
        expect(getBody.preview.status).toBe('idle')
        expect(getBody.previewRuntime?.status).toBe('blocked')
        expect(getBody.previewRuntime?.blockedReason).toBe('Preview process exited with code 1')

        expect(getLatestPreviewRuntimeFromEvent(realtimeEvents, taskId)?.status).toBe('blocked')
        const latestTaskUpdatedEvent = [...realtimeEvents].reverse().find((entry) => (
            entry.type === 'task-updated'
            && entry.taskId === taskId
            && typeof entry.data === 'object'
            && entry.data
        ))
        const latestTaskUpdatedData = latestTaskUpdatedEvent?.data as Record<string, unknown> | undefined
        expect(latestTaskUpdatedData?.status).toBe('blocked')
        expect(latestTaskUpdatedData?.blockedReason).toBe('Preview process exited with code 1')
    })

    it('returns stopped previewRuntime on stop and keeps it on preview get', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-runtime-stopped'
        const sessionId = store.sessions.getOrCreateSession(
            'session-preview-runtime-stopped',
            { path: '/tmp/preview-root' },
            null,
            'default'
        ).id
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-runtime-stopped',
            taskId,
            sessionId
        })

        const realtimeEvents: Array<Record<string, unknown>> = []
        const session = {
            id: sessionId,
            active: true,
            thinking: false,
            metadata: {
                path: '/tmp/preview-root'
            }
        }
        const engine = {
            resolveSessionAccess() {
                return {
                    ok: true,
                    sessionId,
                    session
                }
            },
            async previewStopForSession() {
                return {
                    active: false,
                    status: 'stopped' as const,
                    taskId,
                    sessionId,
                    mode: 'local' as const,
                    rootPath: '/tmp/preview-root',
                    command: 'bun run dev',
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            async previewStatusForSession() {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            },
            handleRealtimeEvent(event: Record<string, unknown>) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const stopResponse = await app.request(`/api/tasks/${taskId}/preview/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(stopResponse.status).toBe(200)
        const stopBody = await stopResponse.json() as {
            preview: { status: string }
            previewRuntime?: { status?: string; latestNote?: string | null }
        }
        expect(stopBody.preview.status).toBe('stopped')
        expect(stopBody.previewRuntime?.status).toBe('stopped')
        expect(stopBody.previewRuntime?.latestNote).toContain('stopped')

        const getResponse = await app.request(`/api/tasks/${taskId}/preview`)
        expect(getResponse.status).toBe(200)
        const getBody = await getResponse.json() as {
            preview: { status: string }
            previewRuntime?: { status?: string }
        }
        expect(getBody.preview.status).toBe('idle')
        expect(getBody.previewRuntime?.status).toBe('stopped')

        expect(getLatestPreviewRuntimeFromEvent(realtimeEvents, taskId)?.status).toBe('stopped')
    })
})
