import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { startSessionFromTask } from './taskSessionService'
import type { SyncEngine } from './syncEngine'

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('startSessionFromTask', () => {
    it('runs init script before kickoff prompt when script exists', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-1'
        const taskId = 'task-init-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const sequence: string[] = []
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    metadata: { path: '/tmp/workspace', host: 'localhost' }
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
                sequence.push('init')
                return { success: true, stdout: 'init ok', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sequence.push('kickoff')
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(sequence).toEqual(['init', 'kickoff'])
    })

    it('fails start when init script execution fails', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-fail'
        const taskId = 'task-init-fail'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-fail',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let archiveCalled = false
        let sendMessageCalled = false
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    metadata: { path: '/tmp/workspace', host: 'localhost' }
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
                return { success: false, error: 'init failed', stdout: '', stderr: 'init failed' }
            },
            async archiveSession() {
                archiveCalled = true
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error).toContain('.hopi/init.sh')
            expect(result.error).toContain('init failed')
        }
        expect(archiveCalled).toBe(true)
        expect(sendMessageCalled).toBe(false)
    })

    it('emits task-updated before waiting for kickoff message delivery', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId,
            source: 'improvements_scan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const realtimeEvents: SyncEvent[] = []
        let resolveSendMessage: (() => void) | null = null
        let sendMessageCalled = false

        const engine = {
            getMachineByNamespace(id: string, ns: string) {
                if (id !== machineId || ns !== namespace) {
                    return undefined
                }
                return {
                    id,
                    namespace: ns,
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
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
                await new Promise<void>((resolve) => {
                    resolveSendMessage = resolve
                })
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const pending = startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        await tick()

        expect(sendMessageCalled).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        resolveSendMessage?.()
        const result = await pending
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.task.source).toBe('manual')
        }
    })

    it('uses task agent flavor when no start-session override is provided', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultAgentFlavor: 'claude'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId,
            agentFlavor: 'codex'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnedAgent: string | null = null
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, agent: string) {
                spawnedAgent = agent
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedAgent).toBe('codex')
    })

    it('passes all project workspace paths for multi-workspace worktree sessions', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceAId = 'workspace-a'
        const workspaceBId = 'workspace-b'
        const workspaceAPath = '/tmp/workspace-a'
        const workspaceBPath = '/tmp/workspace-b'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            defaultWorkspaceId: workspaceAId
        })
        store.workspaces.createWorkspace({
            id: workspaceAId,
            projectId,
            path: workspaceAPath
        })
        store.workspaces.createWorkspace({
            id: workspaceBId,
            projectId,
            path: workspaceBPath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId: workspaceBId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: workspaceBPath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[]
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(workspaceBPath)
        expect(spawnedSessionType).toBe('worktree')
        expect(spawnedWorktreeWorkspacePaths?.[0]).toBe(workspaceBPath)
        expect(spawnedWorktreeWorkspacePaths).toContain(workspaceAPath)
        expect(spawnedWorktreeWorkspacePaths).toContain(workspaceBPath)
        expect(spawnedWorktreeWorkspacePaths?.length).toBe(2)
    })

    it('includes previous session messages in kickoff text when task restarts', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })

        const previousSession = store.sessions.getOrCreateSession(
            'previous-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        store.messages.addMessage(previousSession.id, {
            role: 'user',
            content: { type: 'text', text: 'Please keep this context.' }
        })
        store.messages.addMessage(previousSession.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'Acknowledged and implemented.' } }
        })
        store.messages.addMessage(previousSession.id, {
            role: 'user',
            content: { type: 'text', text: 'skip kickoff payload' }
        }, `auto:kickoff:${taskId}:1`)

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            description: 'Make restart carry full history',
            status: 'in_progress',
            workspaceId,
            activeSessionId: previousSession.id
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
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
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Previous session messages:')
        expect(kickoffText).toContain('User:\nPlease keep this context.')
        expect(kickoffText).toContain('Assistant:\nAcknowledged and implemented.')
        expect(kickoffText).not.toContain('skip kickoff payload')
    })

    it('includes message history across all pages when previous session is long', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })

        const previousSession = store.sessions.getOrCreateSession(
            'previous-session-long',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        for (let index = 1; index <= 205; index += 1) {
            store.messages.addMessage(previousSession.id, {
                role: 'user',
                content: { type: 'text', text: `history message ${index}` }
            })
        }

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            workspaceId,
            activeSessionId: previousSession.id
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-long',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
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
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('history message 1')
        expect(kickoffText).toContain('history message 205')
    })

    it('uses task permission mode before project defaults when starting session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultPermissionMode: 'default'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId,
            agentFlavor: 'claude',
            permissionMode: 'plan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
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
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'plan')).toBe(true)
    })

    it('maps codex task plan mode to collaboration mode when starting session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultPermissionMode: 'default'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId,
            agentFlavor: 'codex',
            permissionMode: 'plan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
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
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedConfigs.some((patch) => patch.collaborationMode === 'plan')).toBe(true)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'plan')).toBe(false)
    })

    it('prefers task model mode over project default model mode', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultModelMode: 'sonnet'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId,
            agentFlavor: 'claude',
            modelMode: 'opus'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
        let spawnedModel: string | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, _agent: string, model?: string) {
                spawnedModel = model
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedModel).toBe('opus')
        expect(appliedConfigs.some((patch) => patch.modelMode === 'opus')).toBe(true)
        expect(appliedConfigs.some((patch) => patch.modelMode === 'sonnet')).toBe(false)
    })
})
