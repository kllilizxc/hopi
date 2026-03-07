import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

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

    it('auto-starts a merge session and injects the conversation-native kickoff prompt', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-merge-auto-start'
        const taskId = 'task-merge-auto-start'
        const workspaceId = 'workspace-merge-auto-start'
        const machineId = 'machine-merge-auto-start'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Merge Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Merge Task',
            status: 'in_review',
            workflowProfile: 'default',
            workspaceId,
            activeSessionId: null
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-merge-session',
            {
                path: '/tmp/workspace',
                host: 'localhost',
                worktree: {
                    basePath: '/tmp/workspace',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            null,
            namespace
        )

        let promptText = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
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
                return {
                    success: true,
                    mergeable: true,
                    sourceBranch: 'task-branch',
                    targetBranch: 'main',
                    hasWorkingTreeChanges: true,
                    committedChangedCount: 1
                }
            },
            async sendMessage(sessionId: string, payload: { text: string; localId?: string }) {
                promptText = payload.text
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
        expect(promptText).toContain('started a fresh worktree session')
        expect(promptText).toContain('.hopi/merge.sh')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.mergeRuntime?.status).toBe('running')
    })
})
