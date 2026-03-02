import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import { startSessionFromTask } from './taskSessionService'
import type { SyncEngine } from './syncEngine'

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('startSessionFromTask', () => {
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
            workspaceId
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

    it('retries session config apply when rpc handlers are not registered yet', async () => {
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
            defaultPermissionMode: 'safe-yolo'
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

        let applyCalls = 0
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
                applyCalls += 1
                if (applyCalls < 3) {
                    throw new Error('RPC handler not registered: spawned-session:set-session-config')
                }
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
        expect(applyCalls).toBe(3)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'safe-yolo')).toBe(true)
    })

    it('infers spawn yolo flag from yolo permission mode when no explicit override is provided', async () => {
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
            defaultPermissionMode: 'yolo'
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

        let spawnedYolo: boolean | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, _agent: string, _model: string | undefined, yolo?: boolean) {
                spawnedYolo = yolo
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
        expect(spawnedYolo).toBe(true)
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
})
