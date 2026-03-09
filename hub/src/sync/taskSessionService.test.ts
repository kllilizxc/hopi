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
                    active: true,
                    thinking: false,
                    agentState: null,
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
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')
        expect(updatedTask?.initRuntime?.sessionId).toBe(spawned.id)
        expect(updatedTask?.initRuntime?.latestNote ?? null).toBeNull()
        expect(store.messages.getMessages(spawned.id, 10)).toHaveLength(0)
    })

    it('calls getSessionByNamespace with engine context when resolving init script cwd', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-session-context'
        const taskId = 'task-session-context'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const runtimePath = '/tmp/runtime-from-session'

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
            'spawned-session-context',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let observedCwd = ''
        function getSessionByNamespace(this: { runtimePath: string }, sessionId: string, ns: string) {
            return {
                id: sessionId,
                namespace: ns,
                metadata: { path: this.runtimePath, host: 'localhost' }
            }
        }

        const engine = {
            runtimePath,
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace,
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async runBash(_sessionId: string, params: { cwd?: string }) {
                observedCwd = params.cwd ?? ''
                return { success: true, stdout: '', stderr: '' }
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
        expect(observedCwd).toBe(runtimePath)
    })

    it('falls back to workspace path when init script is missing in runtime path', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-fallback'
        const taskId = 'task-init-fallback'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const runtimePath = '/tmp/worktree-path'
        const workspacePath = '/tmp/base-workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-fallback',
            { path: runtimePath, host: 'localhost' },
            null,
            namespace
        )

        const runBashCwds: string[] = []
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
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    metadata: { path: runtimePath, host: 'localhost' }
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
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                runBashCwds.push(params.cwd ?? '')
                if ((params.cwd ?? '') === runtimePath) {
                    const marker = params.command.match(/echo '([^']+)'/)?.[1] ?? ''
                    return { success: true, stdout: marker, stderr: '' }
                }
                return { success: true, stdout: 'init ok', stderr: '' }
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
        expect(runBashCwds).toEqual([runtimePath, workspacePath])
        expect(kickoffText).not.toContain('System note: Ran `.hopi/init.sh` successfully before this prompt.')
        expect(store.messages.getMessages(spawned.id, 10)).toHaveLength(0)
    })

    it('skips init when shell reports init script not found', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-not-found'
        const taskId = 'task-init-not-found'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-not-found',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

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
                    metadata: { path: workspacePath, host: 'localhost' }
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
                    error: 'Command failed: bash .hopi/init.sh',
                    stdout: '',
                    stderr: 'bash: .hopi/init.sh: No such file or directory'
                }
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

        expect(result.ok).toBe(true)
        expect(sendMessageCalled).toBe(true)
    })

    it('skips init fallback when base workspace path is outside working directory', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-outside-working-dir'
        const taskId = 'task-init-outside-working-dir'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const runtimePath = '/tmp/worktree-path'
        const workspacePath = '/tmp/base-workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-outside-working-dir',
            { path: runtimePath, host: 'localhost' },
            null,
            namespace
        )

        const runBashCwds: string[] = []
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
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    metadata: { path: runtimePath, host: 'localhost' }
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
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                const cwd = params.cwd ?? ''
                runBashCwds.push(cwd)
                if (cwd === runtimePath) {
                    const marker = params.command.match(/echo '([^']+)'/)?.[1] ?? ''
                    return { success: true, stdout: marker, stderr: '' }
                }
                return {
                    success: false,
                    error: `Access denied: Path '${workspacePath}' is outside the working directory`,
                    stdout: '',
                    stderr: ''
                }
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
        expect(runBashCwds).toEqual([runtimePath, workspacePath])
        expect(kickoffText).not.toContain('System note: Ran `.hopi/init.sh` successfully before this prompt.')
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
                    active: true,
                    thinking: false,
                    agentState: null,
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

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(result.initRecoveryAttempted).toBe(true)
        expect(result.task.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed',
            retryCount: 1
        })
        expect(result.task.initRuntime?.latestNote).toContain('Same blocker repeated')
        expect(result.task.initRuntime?.latestNote).toContain('retry task start')
        expect(archiveCalled).toBe(false)
        expect(sendMessageCalled).toBe(true)
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.status).toBe('in_progress')
        expect(updatedTask?.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed',
            retryCount: 1
        })
    })


    it('keeps the started session linked when init retries and then blocks', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-handoff'
        const taskId = 'task-init-handoff'
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
            'spawned-session-init-handoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let archiveCalled = false
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
                    active: true,
                    thinking: false,
                    agentState: null,
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
                return { success: false, error: 'init failed', stdout: 'checking deps', stderr: 'init failed' }
            },
            async archiveSession() {
                archiveCalled = true
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
        if (!result.ok) {
            return
        }
        expect(result.sessionId).toBe(spawned.id)
        expect(result.initRecoveryAttempted).toBe(true)
        expect(result.task.activeSessionId).toBe(spawned.id)
        expect(result.task.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'init failed',
            retryCount: 1
        })
        expect(archiveCalled).toBe(false)
    })


    it('retries init inside the same session and sends kickoff only after retry succeeds', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-retry-success'
        const taskId = 'task-init-retry-success'
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
            description: 'Finish the task after init is fixed.',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-retry-success',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let runCount = 0
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
                    active: true,
                    thinking: false,
                    agentState: null,
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
                runCount += 1
                return runCount === 1
                    ? { success: false, error: 'missing deps', stdout: 'checking deps', stderr: 'missing deps' }
                    : { success: true, stdout: 'deps fixed', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(sessionId: string, payload: { text?: string; localId?: string }) {
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text ?? '' }
                }, payload.localId)
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
        if (!result.ok) {
            return
        }
        expect(result.initRecoveryAttempted).toBe(true)
        expect(result.task.initRuntime).toMatchObject({
            status: 'succeeded',
            sessionId: spawned.id,
            retryCount: 1
        })

        const messageLocalIds = store.messages.getMessages(spawned.id, 10)
            .map((message) => message.localId ?? '')
        const directFailureIndex = messageLocalIds.findIndex((localId) => localId.includes(':direct-result:'))
        const repairPromptIndex = messageLocalIds.findIndex((localId) => localId.startsWith('auto:init_setup:') && !localId.includes(':direct-result:') && !localId.includes(':retry-result:') && !localId.includes(':prompt-error:'))
        const retrySuccessIndex = messageLocalIds.findIndex((localId) => localId.includes(':retry-result:'))
        const kickoffIndex = messageLocalIds.findIndex((localId) => localId.startsWith('auto:kickoff:'))
        expect(directFailureIndex).toBeGreaterThanOrEqual(0)
        expect(repairPromptIndex).toBeGreaterThan(directFailureIndex)
        expect(retrySuccessIndex).toBeGreaterThan(repairPromptIndex)
        expect(kickoffIndex).toBeGreaterThan(retrySuccessIndex)
    })

    it('waits for approval requests to clear before retrying init in the same session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-init-approval-wait'
        const taskId = 'task-init-approval-wait'
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
            description: 'Wait for approval, then finish init retry.',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-init-approval-wait',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let runCount = 0
        let approvalPolls = 0
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
                const waitingForApproval = runCount === 1 && approvalPolls < 2
                if (waitingForApproval) {
                    approvalPolls += 1
                }

                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: waitingForApproval
                        ? {
                            requests: {
                                'req-1': {
                                    tool: 'bash',
                                    arguments: {},
                                    createdAt: Date.now()
                                }
                            }
                        }
                        : null,
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
                runCount += 1
                return runCount === 1
                    ? { success: false, error: 'missing deps', stdout: 'checking deps', stderr: 'missing deps' }
                    : { success: true, stdout: 'deps fixed', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(sessionId: string, payload: { text?: string; localId?: string }) {
                store.messages.addMessage(sessionId, {
                    role: 'user',
                    content: { type: 'text', text: payload.text ?? '' }
                }, payload.localId)
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
        if (!result.ok) {
            return
        }

        expect(approvalPolls).toBeGreaterThanOrEqual(2)
        expect(runCount).toBe(2)
        expect(result.initRecoveryAttempted).toBe(true)
        expect(result.task.initRuntime).toMatchObject({
            status: 'succeeded',
            sessionId: spawned.id,
            retryCount: 1
        })
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
        let resolveSendMessage: () => void = () => {}
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
                    resolveSendMessage = () => resolve()
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

        resolveSendMessage()
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

        let spawnedAgent = ''
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

    it('uses task custom model without falling back to project model mode', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-custom-model'
        const taskId = 'task-custom-model'
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
            model: 'claude-sonnet-4-5'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-custom-model',
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
        expect(spawnedModel).toBe('claude-sonnet-4-5')
        expect(appliedConfigs.some((patch) => patch.modelMode === 'sonnet')).toBe(false)
    })

    it('uses custom kickoff text when requested', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-custom-kickoff'
        const taskId = 'task-custom-kickoff'
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
            description: 'Default kickoff should be replaced',
            status: 'planned',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-custom-kickoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let payloadText = ''
        let payloadLocalId = ''
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
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                payloadText = payload.text
                payloadLocalId = payload.localId ?? ''
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            kickoff: {
                kind: 'custom',
                text: 'Merge this worktree now.',
                localId: 'custom-merge-kickoff'
            }
        })

        expect(result.ok).toBe(true)
        expect(payloadText).toBe('Merge this worktree now.')
        expect(payloadLocalId).toBe('custom-merge-kickoff')
    })

    it('can skip kickoff message entirely', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-skip-kickoff'
        const taskId = 'task-skip-kickoff'
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
            'spawned-session-skip-kickoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

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
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            kickoff: { kind: 'skip' }
        })

        expect(result.ok).toBe(true)
        expect(sendMessageCalled).toBe(false)
    })

})
