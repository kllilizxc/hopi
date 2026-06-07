import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@hopi/protocol/types'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { handleTaskMovedToFinished } from './taskFinishAutomation'

const createdPaths: string[] = []

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) {
            return
        }
        await delay(20)
    }
    throw new Error('Timed out while waiting for condition')
}

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-tasks-route-'))
    createdPaths.push(path)
    return path
}

function createActiveProjectSession(store: Store, options: {
    namespace: string
    projectId: string
}): { sessionId: string; session: Session } {
    const metadata = {
        path: '/tmp',
        host: 'test',
        projectId: options.projectId
    }
    const stored = store.sessions.getOrCreateSession(
        `tasks-route-session-${options.projectId}`,
        metadata,
        null,
        options.namespace
    )
    const now = Date.now()

    const session: Session = {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (path) {
            rmSync(path, { recursive: true, force: true })
        }
    }
})

describe('tasks improvements automation', () => {
    it('marks linked goal todo items done and records finish automation events', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-finish-goal-sync'
        const goalId = 'goal-finish-goal-sync'
        const taskId = 'task-finish-goal-sync'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'finish-goal')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            '  goalKey: finish-goal',
            `  goalId: ${goalId}`,
            '  title: Finish goal',
            'items:',
            '  - ref: finish-ref',
            '    kind: engineering',
            '    status: in_review',
            '    title: Canonical finish task',
            `    taskId: ${taskId}`,
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Finish goal',
            goalKey: 'finish-goal',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: 'finish-ref',
            title: 'Stale finish overlay title',
            status: 'finished',
            workspaceId: 'workspace-1',
            workflowProfile: 'default'
        })

        const engine = {
            getSessionByNamespace() {
                return undefined
            },
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        await handleTaskMovedToFinished({
            store,
            engine,
            namespace,
            taskId
        })

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: finish-ref')
        expect(todo).toContain('status: done')
        expect(todo).toContain('title: Canonical finish task')
        expect(todo).not.toContain('Stale finish overlay title')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('finish_task_completed')
    })

    it('accepts a canonical goal todo ref when finishing a legacy overlay task', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-finish-alias'
        const goalId = 'goal-finish-alias'
        const goalKey = 'finish-goal-alias'
        const taskId = 'legacy-finish-overlay-id'
        const taskRef = 'finish-ref-alias'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Finish goal alias',
            'items:',
            `  - ref: ${taskRef}`,
            '    kind: engineering',
            '    status: in_review',
            '    title: Canonical alias finish task',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []',
            `    taskId: ${taskId}`,
            ''
        ].join('\n'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI Goal Alias',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Finish Goal Alias',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskRef,
            title: 'Stale alias finish overlay title',
            status: 'finished',
            workspaceId: 'workspace-1',
            workflowProfile: 'default'
        })

        const engine = {
            getSessionByNamespace() {
                return undefined
            },
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        await handleTaskMovedToFinished({
            store,
            engine,
            namespace,
            taskId: taskRef
        })

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain(`ref: ${taskRef}`)
        expect(todo).toContain('status: done')
        expect(todo).toContain('title: Canonical alias finish task')
        expect(todo).not.toContain('Stale alias finish overlay title')
        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('finish_task_completed')
    })

    it('ignores stale DB-only goal rows during finish automation follow-up', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-finish-stale-goal-row'
        const goalId = 'goal-finish-stale-goal-row'
        const goalKey = 'finish-stale-goal-row'
        const taskId = 'task-finish-stale-goal-row'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        const { sessionId } = createActiveProjectSession(store, { namespace, projectId })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Finish stale goal row',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Finish stale goal row',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Stale finished goal row',
            status: 'finished',
            workspaceId: 'workspace-1',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let archiveCalls = 0
        const engine = {
            async archiveSession(id: string) {
                archiveCalls += 1
                expect(id).toBe(sessionId)
            },
            getSessionByNamespace() {
                return undefined
            },
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        await handleTaskMovedToFinished({
            store,
            engine,
            namespace,
            taskId
        })

        expect(archiveCalls).toBe(0)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.goalTodoRef).toBeNull()
        expect(existsSync(goalDir)).toBe(false)
    })

    it('does not recreate a removed goal todo item when finish automation loses the canonical board item mid-flight', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-finish-goal-docs-missing-midflight'
        const goalId = 'goal-finish-goal-docs-missing-midflight'
        const goalKey = 'finish-goal-docs-missing-midflight'
        const taskId = 'task-finish-goal-docs-missing-midflight'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        const { sessionId } = createActiveProjectSession(store, { namespace, projectId })

        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Finish goal docs missing midflight',
            'items:',
            '  - ref: finish-ref',
            '    kind: engineering',
            '    status: in_review',
            '    title: Canonical disappearing finish task',
            `    taskId: ${taskId}`,
            ''
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Finish goal docs missing midflight',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Finish goal docs missing midflight',
            goalKey,
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: 'finish-ref',
            title: 'Stale disappearing finish overlay title',
            status: 'finished',
            workspaceId: 'workspace-1',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        const originalGetGoalByNamespace = store.goals.getGoalByNamespace.bind(store.goals)
        let removedProjection = false
        store.goals.getGoalByNamespace = ((id: string, ns: string) => {
            if (!removedProjection) {
                removedProjection = true
                writeFileSync(join(goalDir, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Finish goal docs missing midflight',
                    'items: []'
                ].join('\n'), 'utf8')
            }
            return originalGetGoalByNamespace(id, ns)
        }) as typeof store.goals.getGoalByNamespace

        let archiveCalls = 0
        const engine = {
            async archiveSession(id: string) {
                archiveCalls += 1
                expect(id).toBe(sessionId)
            },
            getSessionByNamespace() {
                return undefined
            },
            getSessionsByNamespace() {
                return []
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        await handleTaskMovedToFinished({
            store,
            engine,
            namespace,
            taskId
        })

        expect(archiveCalls).toBe(0)
        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('items: []')
        expect(todo).not.toContain('ref: finish-ref')
        const eventLogPath = join(goalDir, 'events.jsonl')
        expect(existsSync(eventLogPath)).toBe(false)
    })

    it('does not run duplicate improvements scans once max pending improvements limit is reached', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-improvements-limit'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'HOPI',
            improvementsEnabled: true,
            improvementsMaxPendingTasks: 1
        })

        const { sessionId, session } = createActiveProjectSession(store, { namespace, projectId })

        store.tasks.createTask({
            id: 'task-finished-a',
            projectId,
            title: 'Finish A',
            status: 'finished',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })
        store.tasks.createTask({
            id: 'task-finished-b',
            projectId,
            title: 'Finish B',
            status: 'finished',
            workflowProfile: 'default',
            activeSessionId: sessionId
        })

        let sendMessageCalls = 0
        const engine = {
            async sendMessage(sid: string) {
                sendMessageCalls += 1
                await delay(60)
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: JSON.stringify([{ title: `Generated ${sendMessageCalls}` }])
                        }
                    }
                })
            },
            getSessionByNamespace(sid: string, ns: string) {
                return sid === sessionId && ns === namespace ? session : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? [session] : []
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        await Promise.all([
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-finished-a'
            }),
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-finished-b'
            })
        ])

        await waitFor(() => store.tasks.countPendingImprovementsTasks(projectId, namespace) === 1)

        expect(sendMessageCalls).toBe(1)
        expect(store.tasks.countPendingImprovementsTasks(projectId, namespace)).toBe(1)
        expect(store.tasks.getTaskByNamespace('task-finished-a', namespace)?.archivedAt).toBeNull()
        expect(store.tasks.getTaskByNamespace('task-finished-b', namespace)?.archivedAt).toBeNull()
    })

    it('keeps scans concurrent across different projects', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'

        store.projects.createProject({
            id: 'project-a',
            namespace,
            machineId: 'machine-1',
            name: 'Project A',
            improvementsEnabled: true,
            improvementsMaxPendingTasks: 1
        })
        store.projects.createProject({
            id: 'project-b',
            namespace,
            machineId: 'machine-1',
            name: 'Project B',
            improvementsEnabled: true,
            improvementsMaxPendingTasks: 1
        })

        const { sessionId: sessionAId, session: sessionA } = createActiveProjectSession(store, {
            namespace,
            projectId: 'project-a'
        })
        const { sessionId: sessionBId, session: sessionB } = createActiveProjectSession(store, {
            namespace,
            projectId: 'project-b'
        })

        store.tasks.createTask({
            id: 'task-a',
            projectId: 'project-a',
            title: 'Task A',
            status: 'finished',
            workflowProfile: 'default',
            activeSessionId: sessionAId
        })
        store.tasks.createTask({
            id: 'task-b',
            projectId: 'project-b',
            title: 'Task B',
            status: 'finished',
            workflowProfile: 'default',
            activeSessionId: sessionBId
        })

        let inFlight = 0
        let maxInFlight = 0
        const engine = {
            async sendMessage(sid: string) {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(60)
                store.messages.addMessage(sid, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'message',
                            message: JSON.stringify([{ title: 'Generated follow-up' }])
                        }
                    }
                })
                inFlight -= 1
            },
            getSessionByNamespace(sid: string, ns: string) {
                if (ns !== namespace) return undefined
                if (sid === sessionAId) return sessionA
                if (sid === sessionBId) return sessionB
                return undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? [sessionA, sessionB] : []
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        await Promise.all([
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-a'
            }),
            handleTaskMovedToFinished({
                store,
                engine,
                namespace,
                taskId: 'task-b'
            })
        ])

        expect(maxInFlight).toBe(2)
    })
})
