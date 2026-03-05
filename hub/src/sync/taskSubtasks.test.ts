import { describe, expect, it } from 'bun:test'
import type { TodoItem } from '@hopi/protocol/types'
import { Store } from '../store'
import { syncTaskSubTasksFromSessionTodos } from './taskSubtasks'

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
