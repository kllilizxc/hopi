import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createTasksRoutes } from './tasks'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-merged-diff-'))
    tempDirs.push(path)
    return path
}

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

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

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

    it('loads merged file diff through a canonical goal todo ref alias', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-ref'
        const goalId = 'goal-goal-ref'
        const goalKey = 'goal-ref'
        const taskId = 'task-db-id'
        const taskRef = 'task-canonical-ref'
        const workspaceId = 'workspace-goal-ref'
        const workspacePath = createTempWorkspace()
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
            path: workspacePath
        })
        store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspaceId })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace: 'default',
            goalKey,
            title: 'Goal',
            status: 'active'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal',
            'items:',
            `  - ref: ${taskRef}`,
            '    kind: engineering',
            '    status: done',
            '    title: Finished goal task',
            `    taskId: ${taskId}`,
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskRef,
            title: 'Finished goal task',
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
        const response = await app.request(`/api/tasks/${taskRef}/worktree/merged-diff-file?path=src/app.ts`)
        const body = await response.json() as { success: boolean; stdout?: string }

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.stdout).toContain('+merged')
        expect(calls).toEqual([
            {
                machineId: 'machine-1',
                options: {
                    cwd: workspacePath,
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
            worktreeMergeCommit: targetCommit
        })
        store.tasks.updateTaskByNamespace(taskId, 'default', {
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

    it('loads merged diff numstat through a canonical goal todo ref alias', async () => {
        const store = new Store(':memory:')
        const projectId = 'project-goal-numstat-ref'
        const goalId = 'goal-goal-numstat-ref'
        const goalKey = 'goal-numstat-ref'
        const taskId = 'task-db-numstat-id'
        const taskRef = 'task-canonical-numstat-ref'
        const workspaceId = 'workspace-goal-numstat-ref'
        const workspacePath = createTempWorkspace()
        const baseCommit = '3333333333333333333333333333333333333333'
        const targetCommit = '4444444444444444444444444444444444444444'
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
            path: workspacePath
        })
        store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspaceId })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace: 'default',
            goalKey,
            title: 'Goal'
        })
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal',
            'items:',
            `  - ref: ${taskRef}`,
            '    kind: engineering',
            '    status: done',
            '    title: Finished goal task',
            `    taskId: ${taskId}`,
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'))
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskRef,
            title: 'Finished goal task',
            status: 'finished',
            activeSessionId: 'removed-worktree-session',
            workspaceId,
            worktreeMergedAt: 1_700_000_000_000,
            worktreeMergeCommit: targetCommit
        })
        store.tasks.updateTaskByNamespace(taskId, 'default', {
            mergedDiffSnapshot: {
                files: [],
                capturedAt: 1_700_000_000_000,
                baseCommit
            }
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
        const response = await app.request(`/api/tasks/${taskRef}/worktree/merged-diff-numstat`)
        const body = await response.json() as { success: boolean; stdout?: string }

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.stdout).toContain('src/app.ts')
        expect(calls).toEqual([
            {
                machineId: 'machine-1',
                options: {
                    cwd: workspacePath,
                    baseRef: baseCommit,
                    targetRef: targetCommit
                }
            }
        ])
    })
})
