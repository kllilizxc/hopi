import { describe, expect, it } from 'bun:test'
import type { TaskInitRuntime, TaskSessionStartFailure } from '@hopi/protocol/types'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

const VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    '      expose: primary',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

function withValidActionsManifest<T extends Record<string, unknown>>(engine: T): T {
    return {
        ...engine,
        async readSessionFile() {
            return {
                success: true,
                content: encodeBase64(VALID_ACTIONS_MANIFEST)
            }
        }
    }
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

function seedStartTask(store: Store, options: {
    projectId: string
    taskId: string
    workspaceId: string
    machineId: string
}): void {
    store.projects.createProject({
        id: options.projectId,
        namespace: 'default',
        machineId: options.machineId,
        name: 'Init Project'
    })
    store.workspaces.createWorkspace({
        id: options.workspaceId,
        projectId: options.projectId,
        path: '/tmp/workspace'
    })
    store.tasks.createTask({
        id: options.taskId,
        projectId: options.projectId,
        title: 'Init Task',
        description: 'Repair init then continue task work.',
        status: 'planning',
        workflowProfile: 'default',
        workspaceId: options.workspaceId,
        subTasks: [
            { content: 'Check init script', status: 'pending' }
        ]
    })
}



describe('tasks start-session route', () => {
    it('rejects Codex-style permission overrides when starting a Claude task session', async () => {
        const store = new Store(':memory:')
        const machineId = 'machine-claude-permission-check'
        const projectId = 'project-claude-permission-check'
        const workspaceId = 'workspace-claude-permission-check'
        const taskId = 'task-claude-permission-check'
        seedStartTask(store, {
            projectId,
            taskId,
            workspaceId,
            machineId
        })
        store.projects.updateProject(projectId, 'default', {
            defaultAgentFlavor: 'claude'
        })

        const engine = withValidActionsManifest({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace: 'default',
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return null
            },
            async spawnSession() {
                throw new Error('spawnSession should not be called')
            },
            async waitForSessionActive() {
                return false
            },
            async applySessionConfig() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/start-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                permissionMode: 'yolo'
            })
        })

        expect(response.status).toBe(400)
        const body = await response.json() as { error?: string }
        expect(body.error).toBe('Invalid permissionMode for task agent flavor')
    })

    it('keeps successful init quiet and sends kickoff without an extra init note', async () => {
        const store = new Store(':memory:')
        const machineId = 'machine-init-success'
        const projectId = 'project-init-success'
        const workspaceId = 'workspace-init-success'
        const taskId = 'task-init-success'
        seedStartTask(store, {
            projectId,
            taskId,
            workspaceId,
            machineId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-success',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            'default'
        )

        let sentPrompt: { text?: string; localId?: string } = {}
        const engine = withValidActionsManifest({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace: 'default',
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return null
                }
                return {
                    id: spawned.id,
                    namespace: 'default',
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/workspace',
                        host: 'localhost'
                    },
                    agentState: null
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async runBash() {
                return {
                    success: true,
                    stdout: 'init ok',
                    stderr: ''
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/unused' }
            },
            async sendMessage(sessionId: string, payload: { text?: string; localId?: string }) {
                sentPrompt = payload
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text ?? '' }
                }, payload.localId)
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/start-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            sessionId?: string
            task?: { initRuntime?: TaskInitRuntime | null }
            initRecoveryAttempted?: boolean
        }
        expect(body.sessionId).toBe(spawned.id)
        expect(body.task?.initRuntime?.status).toBe('succeeded')
        expect(body.task?.initRuntime?.sessionId).toBe(spawned.id)
        expect(body.task?.initRuntime?.latestNote ?? null).toBeNull()
        expect(body.task?.initRuntime?.failure ?? null).toBeNull()
        expect(body.initRecoveryAttempted).toBe(false)
        expect(sentPrompt.localId?.startsWith('auto:kickoff:')).toBe(true)
        expect(sentPrompt.text).not.toContain(`HOPI ran setup workflow from \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\``)

        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(1)
        const transcript = JSON.stringify(messages.map((message) => message.content))
        expect(transcript).not.toContain(`HOPI ran setup workflow from \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\``)
    })

    it('keeps the session alive and hands init failures back into the agent flow', async () => {
        const store = new Store(':memory:')
        const machineId = 'machine-init-handoff'
        const projectId = 'project-init-handoff'
        const workspaceId = 'workspace-init-handoff'
        const taskId = 'task-init-handoff'
        seedStartTask(store, {
            projectId,
            taskId,
            workspaceId,
            machineId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-handoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            'default'
        )

        let archiveCalls = 0
        let sentPrompt: { text?: string; localId?: string } = {}
        const engine = withValidActionsManifest({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace: 'default',
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return null
                }
                return {
                    id: spawned.id,
                    namespace: 'default',
                    active: true,
                    thinking: false,
                    metadata: {
                        path: '/tmp/workspace',
                        host: 'localhost'
                    },
                    agentState: null
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async runBash() {
                return {
                    success: false,
                    error: 'init failed',
                    stdout: 'checking deps\n',
                    stderr: 'init failed'
                }
            },
            async archiveSession() {
                archiveCalls += 1
            },
            async uploadFile() {
                return { success: true, path: '/tmp/unused' }
            },
            async sendMessage(sessionId: string, payload: { text?: string; localId?: string }) {
                sentPrompt = payload
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text ?? '' }
                }, payload.localId)
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/start-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            sessionId?: string
            task?: { initRuntime?: TaskInitRuntime | null }
            initRecoveryAttempted?: boolean
            initRecoveryError?: TaskSessionStartFailure
        }
        expect(body.sessionId).toBe(spawned.id)
        expect(body.task?.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed'
        })
        expect(body.task?.initRuntime?.failure).toMatchObject({
            code: 'init_script_failed',
            blockedReason: 'init failed',
            retry: {
                count: 0,
                action: 'manual_fix_then_retry_start',
                available: true
            }
        })
        expect(body.task?.initRuntime?.latestNote).toContain('Setup workflow failed')
        expect(body.initRecoveryAttempted).toBe(false)
        expect(body.initRecoveryError).toBeUndefined()
        expect(archiveCalls).toBe(0)
        expect(sentPrompt.localId).toBeUndefined()
        expect(sentPrompt.text).toBeUndefined()

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.status).toBe('running')
        expect(updatedTask?.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed'
        })
        expect(updatedTask?.initRuntime?.failure?.code).toBe('init_script_failed')

        const transcript = JSON.stringify(store.messages.getMessages(spawned.id, 10).map((message) => message.content))
        expect(transcript).toContain(`HOPI ran setup workflow from \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`, but it failed before kickoff.`)
        expect(transcript).toContain('init failed')
    })

    it('returns a structured error when session startup throws unexpectedly', async () => {
        const store = new Store(':memory:')
        const machineId = 'machine-start-throws'
        const projectId = 'project-start-throws'
        const workspaceId = 'workspace-start-throws'
        const taskId = 'task-start-throws'
        seedStartTask(store, {
            projectId,
            taskId,
            workspaceId,
            machineId
        })

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace: 'default',
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                throw new Error('RPC socket disconnected: spawn failed')
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/start-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(500)
        const body = await response.json() as { error?: TaskSessionStartFailure }
        expect(body.error).toMatchObject({
            code: 'unexpected_error',
            message: 'RPC socket disconnected: spawn failed',
            retry: {
                count: 0,
                action: 'retry_start',
                available: true
            }
        })

        const task = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(task?.status).toBe('planning')
        expect(task?.activeSessionId ?? null).toBeNull()
    })
})
