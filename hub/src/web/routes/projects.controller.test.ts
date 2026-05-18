import { describe, expect, it } from 'bun:test'
import type { Session } from '@hopi/protocol/types'
import { Hono } from 'hono'
import { Store, type StoredSession } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createProjectsRoutes } from './projects'

function createRuntimeSession(stored: StoredSession, overrides: Partial<Session> = {}): Session {
    return {
        id: stored.id,
        namespace: stored.namespace,
        seq: stored.seq,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        active: overrides.active ?? true,
        activeAt: stored.activeAt ?? stored.createdAt,
        metadata: stored.metadata as Session['metadata'],
        metadataVersion: stored.metadataVersion,
        agentState: null,
        agentStateVersion: stored.agentStateVersion,
        thinking: false,
        thinkingAt: 0,
        permissionMode: overrides.permissionMode,
        modelMode: overrides.modelMode
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
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => engine }))
    return app
}

function seedProject(store: Store, options?: { defaultAgentFlavor?: 'claude' | 'codex' | null }): { projectId: string; workspacePath: string } {
    const projectId = 'project-controller'
    const workspacePath = '/tmp/hopi-controller-workspace'
    store.projects.createProject({
        id: projectId,
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Controller Project',
        defaultAgentFlavor: options?.defaultAgentFlavor ?? null
    })
    const workspace = store.workspaces.createWorkspace({
        id: 'workspace-controller',
        projectId,
        path: workspacePath
    })
    store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspace.id })
    return { projectId, workspacePath }
}

function seedGoalTask(store: Store, projectId: string, goalId: string, id: string): void {
    store.tasks.createTask({
        id,
        projectId,
        goalId,
        title: 'Seed controller work',
        status: 'planning'
    })
}

function createControllerEngine(store: Store): {
    engine: SyncEngine
    spawnCalls: Array<{ machineId: string; directory: string; agent?: string; model?: string }>
    sentMessages: Array<{ sessionId: string; text: string }>
    appliedConfigs: Array<{ sessionId: string; permissionMode?: string }>
    sessions: Map<string, Session>
} {
    const sessions = new Map<string, Session>()
    const spawnCalls: Array<{ machineId: string; directory: string; agent?: string; model?: string }> = []
    const sentMessages: Array<{ sessionId: string; text: string }> = []
    const appliedConfigs: Array<{ sessionId: string; permissionMode?: string }> = []

    const engine = {
        getMachineByNamespace(machineId: string) {
            return {
                id: machineId,
                namespace: 'default',
                active: true,
                metadata: { host: 'localhost' }
            }
        },
        async spawnSession(machineId: string, directory: string, agent?: string, model?: string) {
            spawnCalls.push({ machineId, directory, agent, model })
            const stored = store.sessions.getOrCreateSession(
                `controller-${spawnCalls.length}`,
                { path: directory, host: 'localhost', machineId, flavor: agent },
                null,
                'default'
            )
            sessions.set(stored.id, createRuntimeSession(stored))
            return { type: 'success' as const, sessionId: stored.id }
        },
        async waitForSessionActive() {
            return true
        },
        getSessionByNamespace(sessionId: string) {
            return sessions.get(sessionId)
        },
        async resumeSession(sessionId: string) {
            const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
            if (!stored) {
                return { type: 'error' as const, message: 'Session not found', code: 'session_not_found' }
            }
            sessions.set(sessionId, createRuntimeSession(stored))
            return { type: 'success' as const, sessionId }
        },
        async applySessionConfig(sessionId: string, patch: { permissionMode?: string }) {
            appliedConfigs.push({ sessionId, permissionMode: patch.permissionMode })
            const current = sessions.get(sessionId)
            if (current) {
                sessions.set(sessionId, { ...current, permissionMode: patch.permissionMode as Session['permissionMode'] })
            }
        },
        async sendMessage(sessionId: string, payload: { text: string }) {
            sentMessages.push({ sessionId, text: payload.text })
        },
        handleRealtimeEvent(event: { type: string; sessionId?: string; namespace?: string }) {
            if (event.type !== 'session-updated' || !event.sessionId) return
            const stored = store.sessions.getSessionByNamespace(event.sessionId, event.namespace ?? 'default')
            if (stored) {
                const current = sessions.get(event.sessionId)
                sessions.set(event.sessionId, createRuntimeSession(stored, {
                    permissionMode: current?.permissionMode,
                    modelMode: current?.modelMode
                }))
            }
        }
    } as unknown as SyncEngine

    return { engine, spawnCalls, sentMessages, appliedConfigs, sessions }
}

describe('project controller session routes', () => {
    it('creates a project controller session without sending a prompt', async () => {
        const store = new Store(':memory:')
        const { projectId, workspacePath } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-controller',
            projectId,
            namespace: 'default',
            goalKey: 'ship-controller',
            title: 'Ship Controller',
            status: 'active'
        })
        const { engine, spawnCalls, sentMessages, appliedConfigs } = createControllerEngine(store)
        const app = createTestApp(store, engine)

        const response = await app.request(`/api/projects/${projectId}/controller-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-controller' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { sessionId: string; created: boolean }
        expect(body.created).toBe(true)
        expect(spawnCalls).toEqual([{
            machineId: 'machine-1',
            directory: workspacePath,
            agent: 'codex',
            model: 'gpt-5.5'
        }])
        expect(appliedConfigs).toEqual([{
            sessionId: body.sessionId,
            permissionMode: 'read-only'
        }])
        expect(sentMessages).toEqual([])

        const stored = store.sessions.getSessionByNamespace(body.sessionId, 'default')
        expect(stored?.metadata).toMatchObject({
            projectId,
            goalId: 'goal-controller',
            hopiController: true,
            name: 'Goal Assistant - Controller Project - Ship Controller'
        })
    })

    it('reuses an active controller session without reseeding the prompt', async () => {
        const store = new Store(':memory:')
        const { projectId, workspacePath } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-controller',
            projectId,
            namespace: 'default',
            goalKey: 'ship-controller',
            title: 'Ship Controller',
            status: 'active'
        })
        const stored = store.sessions.getOrCreateSession(
            'controller-existing',
            {
                path: workspacePath,
                host: 'localhost',
                machineId: 'machine-1',
                projectId,
                goalId: 'goal-controller',
                hopiController: true,
                name: 'Controller - Controller Project - Ship Controller',
                flavor: 'codex'
            },
            null,
            'default'
        )
        const controller = createControllerEngine(store)
        controller.sessions.set(stored.id, createRuntimeSession(stored))
        const app = createTestApp(store, controller.engine)

        const response = await app.request(`/api/projects/${projectId}/controller-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-controller' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { sessionId: string; created: boolean }
        expect(body).toMatchObject({ sessionId: stored.id, created: false })
        expect(controller.spawnCalls).toEqual([])
        expect(controller.appliedConfigs).toEqual([{
            sessionId: stored.id,
            permissionMode: 'read-only'
        }])
        expect(controller.sentMessages).toEqual([])
    })

    it('reuses an active controller session with its own stored flavor policy after project agent changes', async () => {
        const store = new Store(':memory:')
        const { projectId, workspacePath } = seedProject(store, { defaultAgentFlavor: 'claude' })
        store.goals.createGoal({
            id: 'goal-controller',
            projectId,
            namespace: 'default',
            goalKey: 'ship-controller',
            title: 'Ship Controller',
            status: 'active'
        })
        const stored = store.sessions.getOrCreateSession(
            'controller-existing-codex',
            {
                path: workspacePath,
                host: 'localhost',
                machineId: 'machine-1',
                projectId,
                goalId: 'goal-controller',
                hopiController: true,
                name: 'Goal Assistant - Controller Project - Ship Controller',
                flavor: 'codex'
            },
            null,
            'default'
        )
        const controller = createControllerEngine(store)
        controller.sessions.set(stored.id, createRuntimeSession(stored))
        const app = createTestApp(store, controller.engine)

        const response = await app.request(`/api/projects/${projectId}/controller-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-controller' })
        })

        expect(response.status).toBe(200)
        expect(controller.spawnCalls).toEqual([])
        expect(controller.appliedConfigs).toEqual([{
            sessionId: stored.id,
            permissionMode: 'read-only'
        }])
    })

    it('queues an opportunistic controller briefing with goal index and todo paths', async () => {
        const store = new Store(':memory:')
        const { projectId } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-other',
            projectId,
            namespace: 'default',
            goalKey: 'other-goal',
            title: 'Other Goal',
            status: 'active'
        })
        store.goals.createGoal({
            id: 'goal-controller',
            projectId,
            namespace: 'default',
            goalKey: 'ship-controller',
            title: 'Ship Controller',
            status: 'active'
        })
        seedGoalTask(store, projectId, 'goal-controller', 'task-controller')
        const controller = createControllerEngine(store)
        const app = createTestApp(store, controller.engine)

        const response = await app.request(`/api/projects/${projectId}/controller-briefing`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-controller' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { queued: boolean; sessionId: string }
        expect(body.queued).toBe(true)
        expect(controller.sentMessages).toHaveLength(1)
        expect(controller.sentMessages[0]?.text).toContain('.hopi/docs/goals/ship-controller/index.md')
        expect(controller.sentMessages[0]?.text).toContain('.hopi/docs/goals/ship-controller/todo.yml')
        expect(controller.sentMessages[0]?.text).not.toContain('.hopi/docs/goals/other-goal/index.md')
        expect(controller.sentMessages[0]?.text).not.toContain('.hopi/docs/goals/other-goal/todo.yml')
        expect(controller.sentMessages[0]?.text).toContain('Focus only on the current goal above')
        expect(controller.sentMessages[0]?.text).toContain('Stay in an operator-console role')

        const stored = store.sessions.getSessionByNamespace(body.sessionId, 'default')
        expect(stored?.metadata).toMatchObject({
            projectId,
            goalId: 'goal-controller',
            hopiController: true,
            controllerBriefingLastAt: expect.any(Number),
            controllerBriefingLastGoalId: 'goal-controller'
        })
    })

    it('does not create a controller briefing session for an empty goal', async () => {
        const store = new Store(':memory:')
        const { projectId } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-empty',
            projectId,
            namespace: 'default',
            goalKey: 'empty-goal',
            title: 'Empty Goal',
            status: 'active'
        })
        const controller = createControllerEngine(store)
        const app = createTestApp(store, controller.engine)

        const response = await app.request(`/api/projects/${projectId}/controller-briefing`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-empty' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { queued: boolean; reason: string; sessionId: string | null }
        expect(body).toMatchObject({ queued: false, reason: 'empty_goal', sessionId: null })
        expect(controller.spawnCalls).toEqual([])
        expect(controller.sentMessages).toEqual([])
    })

    it('does not reuse one goal briefing cooldown for a different current goal', async () => {
        const store = new Store(':memory:')
        const { projectId } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-one',
            projectId,
            namespace: 'default',
            goalKey: 'goal-one',
            title: 'Goal One',
            status: 'active'
        })
        store.goals.createGoal({
            id: 'goal-two',
            projectId,
            namespace: 'default',
            goalKey: 'goal-two',
            title: 'Goal Two',
            status: 'active'
        })
        seedGoalTask(store, projectId, 'goal-one', 'task-goal-one')
        seedGoalTask(store, projectId, 'goal-two', 'task-goal-two')
        const controller = createControllerEngine(store)
        const app = createTestApp(store, controller.engine)

        const first = await app.request(`/api/projects/${projectId}/controller-briefing`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-one' })
        })
        const second = await app.request(`/api/projects/${projectId}/controller-briefing`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-two' })
        })

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect((await first.json() as { queued: boolean }).queued).toBe(true)
        expect((await second.json() as { queued: boolean }).queued).toBe(true)
        expect(controller.sentMessages).toHaveLength(2)
        expect(controller.sentMessages[0]?.sessionId).not.toBe(controller.sentMessages[1]?.sessionId)
        expect(controller.spawnCalls).toHaveLength(2)
        expect(controller.sentMessages[0]?.text).toContain('.hopi/docs/goals/goal-one/index.md')
        expect(controller.sentMessages[0]?.text).not.toContain('.hopi/docs/goals/goal-two/index.md')
        expect(controller.sentMessages[1]?.text).toContain('.hopi/docs/goals/goal-two/index.md')
        expect(controller.sentMessages[1]?.text).not.toContain('.hopi/docs/goals/goal-one/index.md')
    })

    it('does not reuse a legacy project-level controller for a goal controller', async () => {
        const store = new Store(':memory:')
        const { projectId, workspacePath } = seedProject(store)
        store.goals.createGoal({
            id: 'goal-controller',
            projectId,
            namespace: 'default',
            goalKey: 'ship-controller',
            title: 'Ship Controller',
            status: 'active'
        })
        const legacy = store.sessions.getOrCreateSession(
            'controller-legacy',
            {
                path: workspacePath,
                host: 'localhost',
                machineId: 'machine-1',
                projectId,
                hopiController: true,
                name: 'Controller - Controller Project',
                flavor: 'codex'
            },
            null,
            'default'
        )
        const controller = createControllerEngine(store)
        controller.sessions.set(legacy.id, createRuntimeSession(legacy))
        const app = createTestApp(store, controller.engine)

        const response = await app.request(`/api/projects/${projectId}/controller-session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ goalId: 'goal-controller' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { sessionId: string; created: boolean }
        expect(body.created).toBe(true)
        expect(body.sessionId).not.toBe(legacy.id)
        expect(controller.spawnCalls).toHaveLength(1)
    })
})
