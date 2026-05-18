import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createTasksRoutes({
        store,
        getSyncEngine: () => engine
    }))
    return app
}

describe('task merged diff routes', () => {
    it('loads merged file diff from the project workspace commit range', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-1'
        const taskId = 'task-1'
        const workspaceId = 'workspace-1'
        const baseCommit = '1111111111111111111111111111111111111111'
        const targetCommit = '2222222222222222222222222222222222222222'
        const calls: Array<{ machineId: string; options: { cwd?: string; filePath: string; baseRef?: string; targetRef?: string } }> = []

        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/Users/test/repo'
        })
        store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspaceId })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Finished task',
            status: 'finished',
            activeSessionId: 'removed-worktree-session',
            workspaceId,
            worktreeMergedAt: 1_700_000_000_000,
            worktreeMergeCommit: targetCommit
        })
        store.tasks.updateTaskByNamespace(taskId, 'default', {
            mergedDiffSnapshot: {
                files: [
                    {
                        fileName: 'app.ts',
                        filePath: 'src',
                        fullPath: 'src/app.ts',
                        status: 'modified',
                        isStaged: true,
                        linesAdded: 2,
                        linesRemoved: 1
                    }
                ],
                capturedAt: 1_700_000_000_000,
                baseCommit
            }
        })

        const engine = {
            async getGitDiffFileOnMachine(machineId: string, options: { cwd?: string; filePath: string; baseRef?: string; targetRef?: string }) {
                calls.push({ machineId, options })
                return {
                    success: true,
                    stdout: 'diff --git a/src/app.ts b/src/app.ts\n+merged\n'
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merged-diff-file?path=src/app.ts`)
        const body = await response.json() as { success: boolean; stdout?: string }

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.stdout).toContain('+merged')
        expect(calls).toEqual([
            {
                machineId: 'machine-1',
                options: {
                    cwd: '/Users/test/repo',
                    filePath: 'src/app.ts',
                    baseRef: baseCommit,
                    targetRef: targetCommit
                }
            }
        ])
    })

    it('loads merged diff numstat with a query baseRef fallback for legacy tasks', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-legacy'
        const taskId = 'task-legacy'
        const workspaceId = 'workspace-legacy'
        const baseCommit = '1111111111111111111111111111111111111111'
        const targetCommit = '2222222222222222222222222222222222222222'
        const calls: Array<{ machineId: string; options: { cwd?: string; baseRef?: string; targetRef?: string } }> = []

        store.projects.createProject({
            id: projectId,
            namespace: 'default',
            machineId: 'machine-1',
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/Users/test/repo'
        })
        store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspaceId })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Finished task',
            status: 'finished',
            activeSessionId: 'removed-worktree-session',
            workspaceId,
            worktreeMergedAt: 1_700_000_000_000,
            worktreeMergeCommit: targetCommit,
            mergedDiffSnapshot: null
        })

        const engine = {
            async getGitDiffNumstatOnMachine(machineId: string, options: { cwd?: string; baseRef?: string; targetRef?: string }) {
                calls.push({ machineId, options })
                return {
                    success: true,
                    stdout: '2\t1\tsrc/app.ts\n'
                }
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/tasks/${taskId}/worktree/merged-diff-numstat?baseRef=${baseCommit}`)
        const body = await response.json() as { success: boolean; stdout?: string }

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.stdout).toContain('src/app.ts')
        expect(calls).toEqual([
            {
                machineId: 'machine-1',
                options: {
                    cwd: '/Users/test/repo',
                    baseRef: baseCommit,
                    targetRef: targetCommit
                }
            }
        ])
    })
})
