import type { Store, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { upsertGoalTodoTaskState, type GoalTodoStatus } from './goalTodo'

export function normalizeGoalTodoStatusForTask(status: string | null | undefined): GoalTodoStatus {
    switch ((status ?? '').trim().toLowerCase()) {
        case 'planning':
        case 'planned':
            return 'planning'
        case 'running':
        case 'in_progress':
            return 'running'
        case 'review':
        case 'in_review':
            return 'review'
        case 'blocked':
            return 'blocked'
        case 'done':
        case 'finished':
            return 'done'
        default:
            return 'planning'
    }
}

export function defaultGoalTodoTagForTaskStatus(status: GoalTodoStatus): string | null {
    switch (status) {
        case 'planning':
            return 'ready'
        case 'running':
            return 'promoted'
        case 'review':
            return 'in_review'
        case 'blocked':
            return 'unknown'
        case 'done':
            return 'accepted'
        case 'unknown':
            return null
    }
}

function getDefaultWorkspaceForProject(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace) return workspace
    }
    return store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

export function syncTaskStateToGoalTodo(input: {
    store: Store
    namespace: string
    task: StoredTask
    project?: StoredProject | null
    defaultWorkspace?: StoredWorkspace | null
    tag?: string | null
}): boolean {
    if (!input.task.goalId || !input.task.goalTodoRef) {
        return false
    }

    const project = input.project
        ?? input.store.projects.getProjectByNamespace(input.task.projectId, input.namespace)
    if (!project) {
        return false
    }

    const goal = input.store.goals.getGoalByNamespace(input.task.goalId, input.namespace)
    if (!goal || goal.projectId !== project.id) {
        return false
    }

    const status = normalizeGoalTodoStatusForTask(input.task.status)
    const defaultWorkspace = input.defaultWorkspace !== undefined
        ? input.defaultWorkspace
        : getDefaultWorkspaceForProject(input.store, project)

    return upsertGoalTodoTaskState({
        project,
        goal,
        defaultWorkspace,
        taskId: input.task.goalTodoRef,
        status,
        tag: input.tag !== undefined ? input.tag : defaultGoalTodoTagForTaskStatus(status),
        title: input.task.title,
        body: input.task.description,
        blocked: status === 'blocked'
            ? {
                kind: input.task.blockedSource ?? 'blocked',
                summary: input.task.blockedReason,
                updatedAt: Date.now()
            }
            : null
    })
}
