import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../../store'
import { getTaskByNamespaceOrGoalTodoProjection, materializeGoalTodoTaskOverlayForWrite } from './goalTodoProjection'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-projection-'))
    tempDirs.push(path)
    return path
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('getTaskByNamespaceOrGoalTodoProjection', () => {
    it('returns null for stale DB-only goal rows when a docs-backed workspace exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-projection-stale-db-only'
        const goalId = 'goal-goal-projection-stale-db-only'
        const goalKey = 'goal-projection-stale-db-only'
        const taskId = 'stale-db-only-goal-row'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal projection stale DB-only',
            'items: []'
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
            goalKey,
            title: 'Goal projection stale DB-only'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'DB-only stale goal row',
            status: 'planning',
            workflowProfile: 'default'
        })

        const task = getTaskByNamespaceOrGoalTodoProjection({
            store,
            namespace,
            taskId
        })

        expect(task).toBeNull()
    })

    it('keeps raw goal rows readable when the project has no docs-backed workspace', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-projection-no-docs-root'
        const goalId = 'goal-goal-projection-no-docs-root'
        const taskId = 'legacy-goal-row-no-docs-root'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey: 'goal-projection-no-docs-root',
            title: 'Goal projection no docs root'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Legacy goal row',
            status: 'planning',
            workflowProfile: 'default'
        })

        const task = getTaskByNamespaceOrGoalTodoProjection({
            store,
            namespace,
            taskId
        })

        expect(task?.id).toBe(taskId)
        expect(task?.goalId).toBe(goalId)
    })
})

describe('materializeGoalTodoTaskOverlayForWrite', () => {
    it('returns null for stale docs-missing goal overlays even when goalTodoRef is already set', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-materialize-stale-overlay'
        const goalId = 'goal-goal-materialize-stale-overlay'
        const goalKey = 'goal-materialize-stale-overlay'
        const taskId = 'stale-goal-overlay-id'
        const todoRef = 'stale-goal-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)

        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal materialize stale overlay',
            'items: []'
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
            goalKey,
            title: 'Goal materialize stale overlay'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale goal overlay with ref',
            status: 'planning',
            workflowProfile: 'default'
        })

        const task = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace,
            taskId
        })

        expect(task).toBeNull()
    })

    it('keeps raw goal overlays writable when the project has no docs-backed workspace', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-materialize-no-docs-root'
        const goalId = 'goal-goal-materialize-no-docs-root'
        const taskId = 'legacy-goal-overlay-no-docs-root'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey: 'goal-materialize-no-docs-root',
            title: 'Goal materialize no docs root'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: 'legacy-goal-ref',
            title: 'Legacy goal overlay',
            status: 'planning',
            workflowProfile: 'default'
        })

        const task = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace,
            taskId
        })

        expect(task?.id).toBe(taskId)
        expect(task?.goalTodoRef).toBe('legacy-goal-ref')
    })
})
