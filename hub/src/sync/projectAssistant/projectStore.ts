import type { Store, StoredGoal, StoredProject, StoredWorkspace } from '../../store'

export function findProjectWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    const workspace = project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    return workspace ?? null
}

export function getProjectWorkspace(store: Store, project: StoredProject): StoredWorkspace {
    const workspace = findProjectWorkspace(store, project)
    if (!workspace) {
        throw new Error('Project default workspace is required')
    }
    return workspace
}

export function getProject(store: Store, projectId: string, namespace: string): StoredProject {
    const project = store.projects.getProjectByNamespace(projectId, namespace)
    if (!project) {
        throw new Error('Project not found')
    }
    return project
}

export function getGoal(store: Store, goalId: string, namespace: string, projectId: string): StoredGoal {
    const goal = store.goals.getGoalByNamespace(goalId, namespace)
    if (!goal || goal.projectId !== projectId) {
        throw new Error('Goal not found')
    }
    return goal
}
