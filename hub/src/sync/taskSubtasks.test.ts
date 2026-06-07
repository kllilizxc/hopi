import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TodoItem } from '@hopi/protocol/types'
import { Store } from '../store'
import { syncTaskSubTasksFromSessionTodos } from './taskSubtasks'

const createdPaths: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-task-subtasks-'))
    createdPaths.push(path)
    return path
}

function buildTodos(label: string): TodoItem[] {
    return [
        {
            id: `${label}-1`,
            content: `${label} first`,
            status: 'pending',
            priority: 'high'
        },
        {
            id: `${label}-2`,
            content: `${label} second`,
            status: 'completed',
            priority: 'medium'
        }
    ]
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (path) {
            rmSync(path, { recursive: true, force: true })
        }
    }
})

describe('syncTaskSubTasksFromSessionTodos', () => {
    it('updates linked task subtasks from session metadata', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress'
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-1',
            { path: '/tmp', host: 'local', taskId, projectId },
            null,
            namespace
        )

        const todos = buildTodos('metadata')
        const updatedAt = Date.now()
        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos,
            todosUpdatedAt: updatedAt
        })

        expect(updatedTask?.id).toBe(taskId)
        expect(updatedTask?.subTasks).toEqual(todos)
        expect(updatedTask?.subTasksUpdatedAt).toBe(updatedAt)
    })

    it('ignores stale todo updates when task subtasks are newer', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const currentTs = Date.now()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            subTasks: buildTodos('newer'),
            subTasksUpdatedAt: currentTs
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-1',
            { path: '/tmp', host: 'local', taskId, projectId },
            null,
            namespace
        )

        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos: buildTodos('older'),
            todosUpdatedAt: currentTs - 1_000
        })

        expect(updatedTask).toBeNull()
        const current = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(current?.subTasks).toEqual(buildTodos('newer'))
        expect(current?.subTasksUpdatedAt).toBe(currentTs)
    })

    it('falls back to active session link when metadata has no taskId', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const sessionId = 'session-attached'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: sessionId,
                namespace,
                metadata: null
            },
            todos: buildTodos('active-link'),
            todosUpdatedAt: Date.now()
        })

        expect(updatedTask?.id).toBe(taskId)
        expect(updatedTask?.subTasks).toEqual(buildTodos('active-link'))
    })

    it('resolves goal task metadata links by canonical todo ref', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-ref'
        const goalId = 'goal-goal-ref'
        const taskId = 'task-db-id'
        const taskRef = 'task-canonical-ref'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal',
            goalKey: 'goal-ref',
            status: 'active'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'goal-ref')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            '  goalKey: goal-ref',
            `  goalId: ${goalId}`,
            '  title: Goal',
            'items:',
            `  - ref: ${taskRef}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Goal task',
            `    taskId: ${taskId}`,
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskRef,
            title: 'Goal task',
            status: 'running'
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-goal-ref',
            { path: workspacePath, host: 'local', taskId: taskRef, projectId },
            null,
            namespace
        )

        const todos = buildTodos('goal-ref')
        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos,
            todosUpdatedAt: Date.now()
        })

        expect(updatedTask?.id).toBe(taskId)
        expect(updatedTask?.goalTodoRef).toBe(taskRef)
        expect(updatedTask?.subTasks).toEqual(todos)
    })

    it('ignores stale DB-only goal rows linked from session metadata in docs-backed workspaces', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-subtasks'
        const goalId = 'goal-stale-subtasks'
        const taskId = 'task-stale-subtasks'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal',
            goalKey: 'goal-stale-subtasks',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Stale DB-only task',
            status: 'in_progress',
            subTasks: null,
            subTasksUpdatedAt: null
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-goal-stale-subtasks',
            { path: workspacePath, host: 'local', taskId, projectId },
            null,
            namespace
        )

        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos: buildTodos('stale-metadata'),
            todosUpdatedAt: Date.now()
        })

        expect(updatedTask).toBeNull()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.subTasks).toBeNull()
    })

    it('ignores stale DB-only goal rows discovered only through activeSessionId in docs-backed workspaces', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-subtasks-active'
        const goalId = 'goal-stale-subtasks-active'
        const taskId = 'task-stale-subtasks-active'
        const sessionId = 'session-goal-stale-subtasks-active'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal',
            goalKey: 'goal-stale-subtasks-active',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Stale DB-only task',
            status: 'in_progress',
            activeSessionId: sessionId,
            subTasks: null,
            subTasksUpdatedAt: null
        })

        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: sessionId,
                namespace,
                metadata: { projectId, path: workspacePath, host: 'local' }
            },
            todos: buildTodos('stale-active'),
            todosUpdatedAt: Date.now()
        })

        expect(updatedTask).toBeNull()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.subTasks).toBeNull()
    })

    it('replaces all subtasks in replace mode', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            subTasks: buildTodos('old')
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-1',
            { path: '/tmp', host: 'local', taskId, projectId },
            null,
            namespace
        )

        const newTodos = buildTodos('new')
        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos: newTodos,
            todosUpdatedAt: Date.now(),
            mode: 'replace'
        })

        expect(updatedTask?.subTasks).toEqual(newTodos)
        expect(Array.isArray(updatedTask?.subTasks) ? updatedTask.subTasks.length : 0).toBe(2)
    })

    it('merges subtasks in merge mode', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            subTasks: [
                { id: 'task-1', content: 'Old task', status: 'pending', priority: 'low' },
                { id: 'task-2', content: 'Keep this', status: 'completed', priority: 'medium' }
            ]
        })

        const storedSession = store.sessions.getOrCreateSession(
            'session-1',
            { path: '/tmp', host: 'local', taskId, projectId },
            null,
            namespace
        )

        const newTodos: TodoItem[] = [
            { id: 'task-1', content: 'Updated task', status: 'in_progress', priority: 'high' },
            { id: 'task-3', content: 'New task', status: 'pending', priority: 'medium' }
        ]

        const updatedTask = syncTaskSubTasksFromSessionTodos({
            store,
            session: {
                id: storedSession.id,
                namespace,
                metadata: storedSession.metadata
            },
            todos: newTodos,
            todosUpdatedAt: Date.now(),
            mode: 'merge'
        })

        expect(Array.isArray(updatedTask?.subTasks) ? updatedTask.subTasks.length : 0).toBe(3)

        const subTasks = Array.isArray(updatedTask?.subTasks) ? updatedTask.subTasks : []
        const subTasksMap = new Map(subTasks.map(t => [t.id, t]))
        expect(subTasksMap.get('task-1')).toEqual({
            id: 'task-1',
            content: 'Updated task',
            status: 'in_progress',
            priority: 'high'
        })
        expect(subTasksMap.get('task-2')).toEqual({
            id: 'task-2',
            content: 'Keep this',
            status: 'completed',
            priority: 'medium'
        })
        expect(subTasksMap.get('task-3')).toEqual({
            id: 'task-3',
            content: 'New task',
            status: 'pending',
            priority: 'medium'
        })
    })
})
