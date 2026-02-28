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
})
