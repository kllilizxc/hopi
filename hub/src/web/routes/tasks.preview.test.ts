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
        let sentPrompt: { text?: string; localId?: string } | null = null
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
    })

    it('returns normal preview error without auto-prompt for non-command failures', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-no-auto-setup'
        const sessionId = 'session-preview-no-auto-setup'
        seedPreviewTask(store, {
            namespace: 'default',
            projectId: 'project-preview-no-auto-setup',
            taskId,
            sessionId
        })

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
                            path: '/tmp/preview-root'
                        }
                    }
                }
            },
            async previewStartForSession() {
                throw new Error('Preview process exited with code 1')
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
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('Preview process exited with code 1')
        expect(sendMessageCalls).toBe(0)
    })

    it('falls back from worktree path to local path when preview command is missing', async () => {
        const store = new Store(':memory:')
        const taskId = 'task-preview-local-fallback'
        const sessionId = 'session-preview-local-fallback'
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
    })
})
