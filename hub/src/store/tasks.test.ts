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
            workflowProfile: 'default',
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

    it('keeps merge, preview, and init runtimes linked when active session changes', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-runtime',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        const created = store.tasks.createTask({
            id: 'task-runtime',
            projectId: 'project-runtime',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-a',
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-a',
                updatedAt: Date.now(),
                latestNote: '  merge   still running  ' ,
                blockedReason: '  merge conflict  '
            },
            previewRuntime: {
                status: 'running',
                updatedAt: Date.now(),
                latestNote: '  preview   still running  '
            },
            initRuntime: {
                status: 'running',
                updatedAt: Date.now(),
                latestNote: '  init   still running  '
            }
        })

        expect(created.mergeRuntime?.sessionId).toBe('session-a')
        expect(created.mergeRuntime?.latestNote).toBe('merge still running')
        expect(created.mergeRuntime?.blockedReason).toBe('merge conflict')
        expect(created.previewRuntime?.sessionId).toBe('session-a')
        expect(created.previewRuntime?.latestNote).toBe('preview still running')
        expect(created.initRuntime?.sessionId).toBe('session-a')
        expect(created.initRuntime?.latestNote).toBe('init still running')

        const updated = store.tasks.updateTaskByNamespace('task-runtime', 'default', {
            activeSessionId: 'session-b'
        })

        expect(updated?.mergeRuntime?.sessionId).toBe('session-b')
        expect(updated?.mergeRuntime?.status).toBe('running')
        expect(updated?.previewRuntime?.sessionId).toBe('session-b')
        expect(updated?.previewRuntime?.status).toBe('running')
        expect(updated?.initRuntime?.sessionId).toBe('session-b')
        expect(updated?.initRuntime?.status).toBe('running')
    })

    it('persists compact preview runtime vocabulary across store round-trips', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-preview-runtime-vocabulary',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-preview-runtime-vocabulary',
            projectId: 'project-preview-runtime-vocabulary',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-preview-runtime-vocabulary'
        })

        const statuses = [
            'queued',
            'waiting',
            'approval_pending',
            'running',
            'retrying',
            'blocked',
            'ready',
            'stopped',
            'canceled'
        ] as const

        for (const runtimeStatus of statuses) {
            const updated = store.tasks.updateTaskByNamespace('task-preview-runtime-vocabulary', 'default', {
                previewRuntime: {
                    status: runtimeStatus,
                    sessionId: 'session-preview-runtime-vocabulary',
                    updatedAt: Date.now(),
                    retryCount: runtimeStatus === 'retrying' ? 2 : undefined,
                    latestNote: `  ${runtimeStatus} preview note  `,
                    blockedReason: runtimeStatus === 'blocked' ? '  waiting on preview repair  ' : undefined
                }
            })

            expect(updated?.previewRuntime?.status).toBe(runtimeStatus)
            expect(updated?.previewRuntime?.latestNote).toBe(`${runtimeStatus} preview note`)
            if (runtimeStatus === 'retrying') {
                expect(updated?.previewRuntime?.retryCount).toBe(2)
            }
            if (runtimeStatus === 'blocked') {
                expect(updated?.previewRuntime?.blockedReason).toBe('waiting on preview repair')
            }

            const roundTripped = store.tasks.getTaskByNamespace('task-preview-runtime-vocabulary', 'default')
            expect(roundTripped?.previewRuntime?.status).toBe(runtimeStatus)
        }
    })

    it('persists compact merge runtime vocabulary across store round-trips', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-runtime-vocabulary',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-runtime-vocabulary',
            projectId: 'project-runtime-vocabulary',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-runtime-vocabulary'
        })

        const statuses = [
            'queued',
            'waiting',
            'approval_pending',
            'running',
            'retrying',
            'blocked',
            'succeeded',
            'canceled'
        ] as const

        for (const runtimeStatus of statuses) {
            const updated = store.tasks.updateTaskByNamespace('task-runtime-vocabulary', 'default', {
                mergeRuntime: {
                    status: runtimeStatus,
                    sessionId: 'session-runtime-vocabulary',
                    updatedAt: Date.now(),
                    retryCount: runtimeStatus === 'retrying' ? 2 : undefined,
                    latestNote: `  ${runtimeStatus} note  `,
                    blockedReason: runtimeStatus === 'blocked' ? '  waiting on manual conflict resolution  ' : undefined
                }
            })

            expect(updated?.mergeRuntime?.status).toBe(runtimeStatus)
            expect(updated?.mergeRuntime?.latestNote).toBe(`${runtimeStatus} note`)
            if (runtimeStatus === 'retrying') {
                expect(updated?.mergeRuntime?.retryCount).toBe(2)
            }
            if (runtimeStatus === 'blocked') {
                expect(updated?.mergeRuntime?.blockedReason).toBe('waiting on manual conflict resolution')
            }

            const roundTripped = store.tasks.getTaskByNamespace('task-runtime-vocabulary', 'default')
            expect(roundTripped?.mergeRuntime?.status).toBe(runtimeStatus)
        }
    })


    it('persists compact init runtime vocabulary across store round-trips', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-init-runtime-vocabulary',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-init-runtime-vocabulary',
            projectId: 'project-init-runtime-vocabulary',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-init-runtime-vocabulary'
        })

        const statuses = [
            'running',
            'waiting',
            'retrying',
            'blocked',
            'succeeded'
        ] as const

        for (const runtimeStatus of statuses) {
            const updated = store.tasks.updateTaskByNamespace('task-init-runtime-vocabulary', 'default', {
                initRuntime: {
                    status: runtimeStatus,
                    sessionId: 'session-init-runtime-vocabulary',
                    updatedAt: Date.now(),
                    retryCount: runtimeStatus === 'retrying' ? 2 : undefined,
                    latestNote: `  ${runtimeStatus} init note  `,
                    blockedReason: runtimeStatus === 'blocked' ? '  waiting on init repair  ' : undefined
                }
            })

            expect(updated?.initRuntime?.status).toBe(runtimeStatus)
            expect(updated?.initRuntime?.latestNote).toBe(`${runtimeStatus} init note`)
            if (runtimeStatus === 'retrying') {
                expect(updated?.initRuntime?.retryCount).toBe(2)
            }
            if (runtimeStatus === 'blocked') {
                expect(updated?.initRuntime?.blockedReason).toBe('waiting on init repair')
            }

            const roundTripped = store.tasks.getTaskByNamespace('task-init-runtime-vocabulary', 'default')
            expect(roundTripped?.initRuntime?.status).toBe(runtimeStatus)
        }
    })

    it('persists durable task blocker fields and clears them after unblock', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-blocked-fields',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-blocked-fields',
            projectId: 'project-blocked-fields',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default'
        })

        const blocked = store.tasks.updateTaskByNamespace('task-blocked-fields', 'default', {
            status: 'blocked',
            blockedReason: '  Codex usage limit reached  ',
            blockedSource: 'agent',
            blockedSessionId: 'session-1'
        })

        expect(blocked?.blockedReason).toBe('Codex usage limit reached')
        expect(blocked?.blockedSource).toBe('agent')
        expect(blocked?.blockedSessionId).toBe('session-1')
        expect(blocked?.blockedAt).toBeTypeOf('number')

        const unblocked = store.tasks.updateTaskByNamespace('task-blocked-fields', 'default', {
            status: 'planned'
        })

        expect(unblocked?.blockedReason).toBeNull()
        expect(unblocked?.blockedSource).toBeNull()
        expect(unblocked?.blockedSessionId).toBeNull()
        expect(unblocked?.blockedAt).toBeNull()
    })

    it('preserves merge markers when relinking with preserve flag', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-preserve-relink',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        const mergedAt = Date.now() - 10_000
        const created = store.tasks.createTask({
            id: 'task-preserve-relink',
            projectId: 'project-preserve-relink',
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-a',
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'merge-before-relink',
            mergeRuntime: {
                status: 'retrying',
                sessionId: 'session-a',
                updatedAt: Date.now(),
                retryCount: 1,
                latestNote: 'retrying merge'
            },
            previewRuntime: {
                status: 'retrying',
                sessionId: 'session-a',
                updatedAt: Date.now(),
                retryCount: 1,
                latestNote: 'retrying preview'
            },
            initRuntime: {
                status: 'retrying',
                sessionId: 'session-a',
                updatedAt: Date.now(),
                retryCount: 1,
                latestNote: 'retrying init'
            }
        })

        expect(created.worktreeMergeCommit).toBe('merge-before-relink')

        const updated = store.tasks.updateTaskByNamespace('task-preserve-relink', 'default', {
            activeSessionId: 'session-b',
            preserveMergeResultOnSessionChange: true,
            mergeRuntime: {
                status: 'retrying',
                sessionId: 'session-b',
                updatedAt: Date.now(),
                retryCount: 2,
                latestNote: 'still retrying'
            },
            previewRuntime: {
                status: 'retrying',
                sessionId: 'session-b',
                updatedAt: Date.now(),
                retryCount: 2,
                latestNote: 'preview still retrying'
            },
            initRuntime: {
                status: 'retrying',
                sessionId: 'session-b',
                updatedAt: Date.now(),
                retryCount: 2,
                latestNote: 'init still retrying'
            }
        })

        expect(updated?.activeSessionId).toBe('session-b')
        expect(updated?.worktreeMergedAt).toBe(mergedAt)
        expect(updated?.worktreeMergeCommit).toBe('merge-before-relink')
        expect(updated?.mergeRuntime).toMatchObject({
            status: 'retrying',
            sessionId: 'session-b',
            retryCount: 2,
            latestNote: 'still retrying'
        })
        expect(updated?.previewRuntime).toMatchObject({
            status: 'retrying',
            sessionId: 'session-b',
            retryCount: 2,
            latestNote: 'preview still retrying'
        })
        expect(updated?.initRuntime).toMatchObject({
            status: 'retrying',
            sessionId: 'session-b',
            retryCount: 2,
            latestNote: 'init still retrying'
        })
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
            status: 'planned',
            workflowProfile: 'default'
        })
        store.tasks.createTask({
            id: 'task-other',
            projectId: 'project-other',
            title: 'Task Other',
            status: 'planned',
            workflowProfile: 'default'
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
            status: 'planned',
            workflowProfile: 'default',
            permissionMode: 'plan'
        })

        expect(created.permissionMode).toBe('plan')

        const updated = store.tasks.updateTaskByNamespace('task-1', 'default', {
            permissionMode: 'default'
        })

        expect(updated?.permissionMode).toBe('default')
    })

    it('persists generic task model updates', () => {
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
            status: 'planned',
            workflowProfile: 'default',
            model: 'gpt-5.2-codex'
        })

        expect(created.model).toBe('gpt-5.2-codex')

        const updated = store.tasks.updateTaskByNamespace('task-1', 'default', {
            model: 'gpt-5.2'
        })

        expect(updated?.model).toBe('gpt-5.2')
    })

    it('excludes unapproved improvements-scan tasks from auto-run planned queue', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-1',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-manual',
            projectId: 'project-1',
            title: 'Manual task',
            status: 'planned',
            workflowProfile: 'default',
            source: 'manual'
        })
        store.tasks.createTask({
            id: 'task-generated-pending',
            projectId: 'project-1',
            title: 'Generated pending approval',
            status: 'planned',
            workflowProfile: 'default',
            source: 'improvements_scan'
        })

        const planned = store.tasks.listPlannedTasksByProjectAndNamespace('project-1', 'default')
        expect(planned.map((task) => task.id)).toEqual(['task-manual'])
    })

    it('keeps re-queued planned tasks in the auto-run queue even with a previous session link', () => {
        const store = new Store(':memory:')
        store.projects.createProject({
            id: 'project-1',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })

        store.tasks.createTask({
            id: 'task-requeued',
            projectId: 'project-1',
            title: 'Requeued task',
            status: 'planned',
            workflowProfile: 'default',
            source: 'manual',
            activeSessionId: 'session-old'
        })

        const planned = store.tasks.listPlannedTasksByProjectAndNamespace('project-1', 'default')
        expect(planned.map((task) => task.id)).toEqual(['task-requeued'])
    })
})
