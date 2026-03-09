import { describe, expect, it } from 'bun:test'
import type { TaskInitRuntime } from '@hopi/protocol/types'
import { PRODUCT_INIT_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
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
        status: 'planned',
        workflowProfile: 'default',
        workspaceId: options.workspaceId,
        subTasks: [
            { content: 'Check init script', status: 'pending' }
        ]
    })
}



describe('tasks start-session route', () => {
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
        const engine = {
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
        } as unknown as SyncEngine

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
        expect(body.initRecoveryAttempted).toBe(false)
        expect(sentPrompt.localId?.startsWith('auto:kickoff:')).toBe(true)
        expect(sentPrompt.text).not.toContain('System note: Ran `.hopi/init.sh` successfully before this prompt.')

        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(1)
        const transcript = JSON.stringify(messages.map((message) => message.content))
        expect(transcript).not.toContain('auto-ran `.hopi/init.sh`')
        expect(transcript).not.toContain('Init script completed successfully.')
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
        const engine = {
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
        } as unknown as SyncEngine

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
            initRecoveryError?: string
        }
        expect(body.sessionId).toBe(spawned.id)
        expect(body.task?.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed',
            retryCount: 1
        })
        expect(body.task?.initRuntime?.latestNote).toContain('Same blocker repeated')
        expect(body.initRecoveryAttempted).toBe(true)
        expect(body.initRecoveryError).toBeUndefined()
        expect(archiveCalls).toBe(0)
        expect(sentPrompt.localId?.startsWith('auto:init_setup:')).toBe(true)
        expect(sentPrompt.text).toContain(PRODUCT_INIT_SCRIPT_RELATIVE_PATH)
        expect(sentPrompt.text).toContain('Repair init then continue task work.')
        expect(sentPrompt.text).toContain('Check init script')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.status).toBe('in_progress')
        expect(updatedTask?.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed',
            retryCount: 1
        })

        const transcript = JSON.stringify(store.messages.getMessages(spawned.id, 10).map((message) => message.content))
        expect(transcript).toContain('auto-ran `.hopi/init.sh`')
        expect(transcript).toContain('init failed')
    })
})
