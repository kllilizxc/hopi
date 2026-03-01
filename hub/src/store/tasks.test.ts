import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('Task store worktree merge fields', () => {
    it('clears merge markers when active session changes', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-1',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        const created = store.tasks.createTask({
            id: 'task-1',
            projectId: 'project-1',
            title: 'Task',
            status: 'in_progress',
            activeSessionId: 'session-a',
            worktreeMergedAt: Date.now(),
            worktreeMergeCommit: 'abc123'
        })

        expect(created.worktreeMergedAt).toBeTypeOf('number')
        expect(created.worktreeMergeCommit).toBe('abc123')

        const updated = store.tasks.updateTaskByNamespace('task-1', 'default', {
            activeSessionId: 'session-b'
        })

        expect(updated?.activeSessionId).toBe('session-b')
        expect(updated?.worktreeMergedAt).toBeNull()
        expect(updated?.worktreeMergeCommit).toBeNull()
    })

    it('deletes task only inside matching namespace', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-default',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Default Project'
        })
        store.projects.createProject({
            id: 'project-other',
            namespace: 'other',
            machineId: 'machine-1',
            name: 'Other Project'
        })

        store.tasks.createTask({
            id: 'task-default',
            projectId: 'project-default',
            title: 'Task Default',
            status: 'new'
        })
        store.tasks.createTask({
            id: 'task-other',
            projectId: 'project-other',
            title: 'Task Other',
            status: 'new'
        })

        expect(store.tasks.deleteTaskByNamespace('task-default', 'other')).toBe(false)
        expect(store.tasks.getTaskByNamespace('task-default', 'default')).not.toBeNull()

        expect(store.tasks.deleteTaskByNamespace('task-default', 'default')).toBe(true)
        expect(store.tasks.getTaskByNamespace('task-default', 'default')).toBeNull()
        expect(store.tasks.getTaskByNamespace('task-other', 'other')).not.toBeNull()
    })

    it('persists task permission mode updates', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-1',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        const created = store.tasks.createTask({
            id: 'task-1',
            projectId: 'project-1',
            title: 'Task',
            status: 'new',
            permissionMode: 'plan'
        })

        expect(created.permissionMode).toBe('plan')

        const updated = store.tasks.updateTaskByNamespace('task-1', 'default', {
            permissionMode: 'default'
        })

        expect(updated?.permissionMode).toBe('default')
    })
})
