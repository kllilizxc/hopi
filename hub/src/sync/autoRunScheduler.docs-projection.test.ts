import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { AutoRunScheduler } from './autoRunScheduler'
import { upsertGoalTodoTaskState } from './goals/goalTodo'
import type { SyncEngine } from './syncEngine'

const tempDirs: string[] = []

function createTempWorkspace(prefix: string): string {
    const path = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(path)
    return path
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) {
            return
        }
        await delay(20)
    }
    throw new Error('Timed out while waiting for condition')
}

function createRunnableEngine(namespace: string, projectId: string) {
    let spawnCount = 0
    const realtimeEvents: SyncEvent[] = []
    const engine = {
        getSessionsByNamespace() {
            return []
        },
        getSessionByNamespace(sessionId: string) {
            return {
                id: sessionId,
                namespace,
                active: true,
                thinking: false,
                metadata: { projectId }
            }
        },
        getMachineByNamespace() {
            return {
                id: 'machine-1',
                namespace,
                active: true,
                runnerState: { status: 'running' }
            }
        },
        async spawnSession() {
            spawnCount += 1
            return {
                type: 'success' as const,
                sessionId: `session-docs-projection-${spawnCount}`
            }
        },
        async waitForSessionActive() {
            return true
        },
        async applySessionConfig() {
        },
        async sendMessage() {
        },
        handleRealtimeEvent(event: SyncEvent) {
            realtimeEvents.push(event)
        }
    } as unknown as SyncEngine

    return { engine, realtimeEvents, getSpawnCount: () => spawnCount }
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('AutoRunScheduler docs projection', () => {
    it('auto-runs a docs-backed goal task even when no DB task row exists', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-goal-task'
        const goalId = 'goal-docs-backed-goal-task'
        const taskId = 'docs-only-goal-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-goal-task',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-run-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Manual goal with docs-backed work',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: 'Docs-backed ready task',
            body: 'Start from todo.yml without a pre-existing DB task row.'
        })
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task).toMatchObject({
            id: taskId,
            goalId,
            goalTodoRef: taskId,
            status: 'running',
            title: 'Docs-backed ready task'
        })
        expect(getSpawnCount()).toBe(1)
    })

    it('does not create a planner refill when docs-backed ready work already exists', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-ready-work'
        const goalId = 'goal-docs-backed-ready-work'
        const taskId = 'docs-only-ready-generator-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 3,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-ready-work',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-ready-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autopilot goal with docs-backed ready work',
            status: 'active',
            autopilotEnabled: true
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: 'Docs-backed generator work',
            body: 'Ready work exists only in todo.yml.'
        })
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const planners = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .filter((task) => task.source === 'planner')
        expect(planners).toHaveLength(0)
        expect(getSpawnCount()).toBeGreaterThan(0)
    })

    it('does not auto-run docs-backed reservoir candidate work', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-candidate-work'
        const goalId = 'goal-docs-backed-candidate-work'
        const taskId = 'docs-only-candidate-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 3,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-candidate-work',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-candidate-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Autopilot goal with candidate-only backlog',
            status: 'active',
            autopilotEnabled: true
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'candidate',
            taskKind: 'planning',
            title: 'Candidate backlog note',
            body: 'This should stay in the reservoir until promoted.'
        })
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()
        const projectTasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
        expect(projectTasks.some((task) => task.goalTodoRef === taskId || task.id === taskId)).toBe(false)
        const planners = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })
            .filter((task) => task.source === 'planner')
        expect(planners).toHaveLength(1)
    })

    it('does not seed goal autopilot work when canonical goal.md disables autopilot', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-goal-autopilot-off'
        const goalId = 'goal-docs-backed-goal-autopilot-off'
        const goalKey = 'docs-backed-goal-autopilot-off'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-goal-autopilot-off',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-goal-autopilot-off-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'DB Autopilot Goal',
            status: 'active',
            autopilotEnabled: true
        })

        const goalDir = join(workspace.path, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goalKey}`,
            'title: "Canonical Goal"',
            'status: active',
            'autopilotEnabled: false',
            'deployRequiresApproval: true',
            '---',
            '',
            '# Canonical Goal',
            '',
            '## Objective',
            '',
            'Autopilot is disabled in the durable goal doc.',
            ''
        ].join('\n'))

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(getSpawnCount()).toBe(0)
        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })).toEqual([])
    })

    it('does not seed goal autopilot work for a stale DB-only goal when no canonical docs exist', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-goal-stale-db-only'
        const goalId = 'goal-docs-backed-goal-stale-db-only'
        const goalKey = 'docs-backed-goal-stale-db-only'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: false,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-goal-stale-db-only',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-stale-db-only-goal-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Stale DB-only Goal',
            status: 'active',
            autopilotEnabled: true
        })

        const { engine, realtimeEvents, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        await (scheduler as unknown as {
            tickProject(namespace: string, projectId: string): Promise<void>
        }).tickProject(namespace, projectId)

        expect(getSpawnCount()).toBe(0)
        expect(store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId })).toEqual([])
        expect(realtimeEvents).toEqual([])
        expect(existsSync(join(workspace.path, '.hopi', 'docs', 'goals', goalKey, 'goal.md'))).toBe(false)
        expect(existsSync(join(workspace.path, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'))).toBe(false)
    })

    it('blocks a docs-backed goal task on unexpected startup failure and records the scheduler event', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-start-failure'
        const goalId = 'goal-docs-backed-start-failure'
        const taskId = 'docs-only-start-failure-task'
        const docsTitle = 'Docs-backed task with failing startup'
        const overlayTitle = 'Stale startup failure overlay title'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-start-failure',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-block-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Manual goal with failing startup',
            goalKey: 'docs-backed-start-failure',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: docsTitle,
            body: 'Session startup will throw before the task can run.'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: overlayTitle,
            description: 'Stale startup failure overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId: workspace.id
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                throw new Error('RPC socket disconnected: spawn failed')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource === 'scheduler')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.status).toBe('planning')
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('RPC socket disconnected: spawn failed')
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
        const toast = realtimeEvents.find((event) => event.type === 'toast')
        expect(toast?.data.body).toContain(docsTitle)
        expect(toast?.data.body).not.toContain(overlayTitle)
        const todoDoc = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-start-failure', 'todo.yml'),
            'utf8'
        )
        expect(todoDoc).toContain(`ref: ${taskId}`)
        expect(todoDoc).toContain(`title: ${docsTitle}`)
        expect(todoDoc).not.toContain(overlayTitle)
        expect(todoDoc).toContain('status: planned')
        expect(todoDoc).toContain('kind: intervention')
        const eventLog = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-start-failure', 'events.jsonl'),
            'utf8'
        )
        expect(eventLog).toContain('scheduler_task_blocked')
        expect(eventLog).toContain(`"taskId":"${taskId}"`)
    })

    it('does not recreate a removed goal todo item when scheduler startup failure arrives after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-start-failure-docs-missing'
        const goalId = 'goal-docs-backed-start-failure-docs-missing'
        const goalKey = 'docs-backed-start-failure-docs-missing'
        const taskId = 'docs-only-start-failure-docs-missing-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-start-failure-docs-missing',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-block-missing-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Manual goal with disappearing board item',
            goalKey,
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: 'Canonical scheduler item',
            body: 'Delete this board item before startup failure returns.'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale scheduler overlay title',
            description: 'Stale scheduler overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId: workspace.id
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                writeFileSync(join(workspace.path, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Manual goal with disappearing board item',
                    'items: []'
                ].join('\n'), 'utf8')
                throw new Error('RPC socket disconnected: spawn failed')
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource === 'scheduler')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task?.blockedSource).toBe('scheduler')
        expect(task?.blockedReason).toBe('RPC socket disconnected: spawn failed')
        const toast = realtimeEvents.find((event) => event.type === 'toast')
        expect(toast?.data.body).toContain('Canonical scheduler item')
        expect(toast?.data.body).not.toContain('Stale scheduler overlay title')
        const todoDoc = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'),
            'utf8'
        )
        expect(todoDoc).toContain('items: []')
        expect(todoDoc).not.toContain(`ref: ${taskId}`)
        expect(todoDoc).not.toContain('title: Stale scheduler overlay title')
        const eventLogPath = join(workspace.path, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl')
        if (existsSync(eventLogPath)) {
            const eventLog = readFileSync(eventLogPath, 'utf8')
            expect(eventLog).not.toContain('scheduler_task_blocked')
        }
    })

    it('keeps a docs-backed goal task on its lane while waiting for runner recovery and records the scheduler event', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-runner-waiting'
        const goalId = 'goal-docs-backed-runner-waiting'
        const taskId = 'docs-runner-waiting-task'
        const docsTitle = 'Docs-backed task waiting for runner recovery'
        const overlayTitle = 'Stale overlay runner waiting title'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-runner-waiting',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-waiting-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Manual goal waiting for runner recovery',
            goalKey: 'docs-backed-runner-waiting',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: docsTitle,
            body: 'Scheduler should preserve the lane and durable blocker while the runner is offline.'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: overlayTitle,
            description: 'Stale overlay runner waiting description.',
            status: 'planning',
            workspaceId: workspace.id,
            workflowProfile: 'default',
            source: 'manual'
        })

        let runnerReady = false
        let spawnCount = 0
        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: runnerReady,
                    runnerState: { status: runnerReady ? 'running' : 'stopped' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'success' as const,
                    sessionId: `session-docs-backed-runner-waiting-${spawnCount}`
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.initRuntime?.status === 'waiting')

        const waitingTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(waitingTask?.status).toBe('planning')
        expect(waitingTask?.blockedSource).toBe('scheduler')
        expect(waitingTask?.blockedReason).toBe('Runner offline or not connected. Start it on the machine and try again: hopi runner start')
        expect(waitingTask?.initRuntime?.failure?.code).toBe('runner_offline')
        expect(spawnCount).toBe(0)
        expect(realtimeEvents.some((event) => event.type === 'toast')).toBe(true)
        const toast = realtimeEvents.find((event) => event.type === 'toast')
        expect(toast?.data.body).toContain(docsTitle)
        expect(toast?.data.body).not.toContain(overlayTitle)

        const todoDoc = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-runner-waiting', 'todo.yml'),
            'utf8'
        )
        expect(todoDoc).toContain(`ref: ${taskId}`)
        expect(todoDoc).toContain(`title: ${docsTitle}`)
        expect(todoDoc).not.toContain(overlayTitle)
        expect(todoDoc).toContain('status: planned')
        expect(todoDoc).toContain('kind: intervention')

        const eventLog = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-runner-waiting', 'events.jsonl'),
            'utf8'
        )
        expect(eventLog).toContain('scheduler_task_waiting_for_runner')
        expect(eventLog).toContain(`"taskId":"${taskId}"`)

        runnerReady = true
        scheduler.handleEvent({
            type: 'machine-updated',
            namespace,
            machineId: 'machine-1',
            data: { activeAt: Date.now() }
        })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.blockedSource).toBeNull()
    })

    it('reopens a runner-recovery blocked goal task through docs before restarting it', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-runner-recovery'
        const goalId = 'goal-docs-backed-runner-recovery'
        const taskId = 'docs-runner-recovery-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-runner-recovery',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-recover-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Runner recovery goal',
            goalKey: 'docs-backed-runner-recovery',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'blocked',
            tag: 'unknown',
            taskKind: 'engineering',
            title: 'Docs-backed runner recovery task',
            body: 'Reopen this blocked task when the runner comes back.',
            blocked: {
                kind: 'scheduler',
                summary: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
                updatedAt: Date.now()
            }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Docs-backed runner recovery task',
            description: 'Reopen this blocked task when the runner comes back.',
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler',
            workspaceId: workspace.id,
            workflowProfile: 'default',
            source: 'manual'
        })

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        expect(getSpawnCount()).toBe(1)
        const todoDoc = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-runner-recovery', 'todo.yml'),
            'utf8'
        )
        expect(todoDoc).toContain(`ref: ${taskId}`)
        expect(todoDoc).toContain('status: in_progress')
        const eventLog = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-runner-recovery', 'events.jsonl'),
            'utf8'
        )
        expect(eventLog).toContain('scheduler_task_recovered')
        expect(eventLog).toContain(`"taskId":"${taskId}"`)
    })

    it('preserves the docs-backed in_progress lane when runner recovery reblocks after spawn failure', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-backed-runner-recovery-reblock'
        const goalId = 'goal-docs-backed-runner-recovery-reblock'
        const taskId = 'docs-runner-recovery-reblock-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-backed-runner-recovery-reblock',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-reblock-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Runner recovery reblock goal',
            goalKey: 'docs-backed-runner-recovery-reblock',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'running',
            tag: 'promoted',
            taskKind: 'engineering',
            title: 'Docs-backed runner recovery reblock task',
            body: 'Keep this todo item on its in-progress lane if startup fails again.',
            blocked: {
                kind: 'scheduler',
                summary: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
                updatedAt: Date.now()
            }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Docs-backed runner recovery reblock task',
            description: 'Keep this todo item on its in-progress lane if startup fails again.',
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler',
            workspaceId: workspace.id,
            workflowProfile: 'default',
            source: 'manual'
        })

        let spawnCount = 0
        const engine = {
            getSessionsByNamespace() {
                return []
            },
            getSessionByNamespace(sessionId: string) {
                return {
                    id: sessionId,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { projectId }
                }
            },
            getMachineByNamespace() {
                return {
                    id: 'machine-1',
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                spawnCount += 1
                return {
                    type: 'error' as const,
                    message: 'Spawn failed after runner recovery'
                }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.requestTick(namespace, projectId, { delayMs: 0 })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.blockedReason === 'Spawn failed after runner recovery')

        expect(spawnCount).toBe(1)
        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task).toMatchObject({
            id: taskId,
            status: 'running',
            blockedSource: 'scheduler',
            blockedReason: 'Spawn failed after runner recovery'
        })

        const todoDoc = readFileSync(
            join(workspace.path, '.hopi', 'docs', 'goals', 'docs-backed-runner-recovery-reblock', 'todo.yml'),
            'utf8'
        )
        expect(todoDoc).toContain(`ref: ${taskId}`)
        expect(todoDoc).toContain('status: in_progress')
        expect(todoDoc).toContain('summary: Spawn failed after runner recovery')
    })

    it('requests a scheduler tick from task-updated using the docs-projected goal lane instead of a legacy blocked overlay', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-projected-task-updated'
        const goalId = 'goal-docs-projected-task-updated'
        const taskId = 'docs-projected-task-updated'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-projected-task-updated',
            projectId,
            path: createTempWorkspace('hopi-docs-projection-task-updated-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Goal with runner-recovery work',
            goalKey: 'docs-projected-task-updated',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'blocked',
            tag: 'unknown',
            taskKind: 'engineering',
            title: 'Reopen from docs projection on task-updated',
            body: 'This should restart when task-updated is emitted.',
            blocked: {
                kind: 'scheduler',
                summary: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
                updatedAt: Date.now()
            }
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Reopen from docs projection on task-updated',
            description: 'This should restart when task-updated is emitted.',
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler',
            workspaceId: workspace.id,
            workflowProfile: 'default',
            source: 'manual'
        })

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.handleEvent({
            type: 'task-updated',
            namespace,
            projectId,
            taskId,
            data: { taskId }
        })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task).toMatchObject({
            id: taskId,
            status: 'running',
            blockedReason: null,
            blockedSource: null
        })
        expect(getSpawnCount()).toBe(1)
    })

    it('requests a scheduler tick from task-updated for a docs-only goal todo ref without a DB task row', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-docs-only-task-updated'
        const goalId = 'goal-docs-only-task-updated'
        const taskId = 'docs-only-task-updated-ref'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            autoRunEnabled: true,
            maxRunningSessions: 1,
            automationReadinessStatus: 'ready'
        })
        const workspace = store.workspaces.createWorkspace({
            id: 'workspace-docs-only-task-updated',
            projectId,
            path: createTempWorkspace('hopi-docs-only-task-updated-')
        })
        store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspace.id })
        const goal = store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Docs-only task-updated goal',
            goalKey: 'docs-only-task-updated',
            status: 'active',
            autopilotEnabled: false
        })

        upsertGoalTodoTaskState({
            project: store.projects.getProjectByNamespace(projectId, namespace)!,
            goal,
            defaultWorkspace: workspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'engineering',
            title: 'Docs-only task-updated work',
            body: 'Scheduler should reopen this from task-updated without a DB row.'
        })
        expect(store.tasks.getTaskByNamespace(taskId, namespace)).toBeNull()

        const { engine, getSpawnCount } = createRunnableEngine(namespace, projectId)
        const scheduler = new AutoRunScheduler(store, engine)
        scheduler.handleEvent({
            type: 'task-updated',
            namespace,
            projectId,
            taskId,
            data: { taskId }
        })

        await waitFor(() => store.tasks.getTaskByNamespace(taskId, namespace)?.status === 'running')

        const task = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(task).toMatchObject({
            id: taskId,
            goalId,
            goalTodoRef: taskId,
            status: 'running',
            title: 'Docs-only task-updated work'
        })
        expect(getSpawnCount()).toBe(1)
    })
})
