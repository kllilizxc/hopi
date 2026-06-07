import type { TodoItem } from '@hopi/protocol/types'
import type { Store, StoredSession, StoredTask } from '../store'
import { getDocsRoot } from './goals/goalDocPaths'
import { findGoalTodoTaskProjectionById, materializeGoalTodoTaskOverlayForWrite } from './goals/goalTodoProjection'

function extractTaskLinkFromMetadata(metadata: unknown): { taskId?: string; projectId?: string } {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {}
    }

    const record = metadata as Record<string, unknown>
    return {
        taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
        projectId: typeof record.projectId === 'string' ? record.projectId : undefined
    }
}

function pickTaskCandidate(candidates: StoredTask[], projectId?: string): StoredTask | null {
    if (candidates.length === 0) {
        return null
    }

    const activeCandidates = candidates.filter((task) => task.archivedAt === null)
    const pool = activeCandidates.length > 0 ? activeCandidates : candidates

    if (projectId) {
        const projectMatches = pool.filter((task) => task.projectId === projectId)
        if (projectMatches.length === 1) {
            return projectMatches[0]
        }
        if (projectMatches.length > 1) {
            const inProgress = projectMatches.find((task) => task.status === 'in_progress')
            return inProgress ?? projectMatches[0]
        }
    }

    const inProgress = pool.find((task) => task.status === 'in_progress')
    return inProgress ?? pool[0]
}

function isDocsBackedGoalProjectionMissing(store: Store, namespace: string, task: StoredTask): boolean {
    if (!task.goalId) {
        return false
    }
    const project = store.projects.getProjectByNamespace(task.projectId, namespace)
    if (!project) {
        return false
    }
    const defaultWorkspace = project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    if (!getDocsRoot(defaultWorkspace)) {
        return false
    }
    return !findGoalTodoTaskProjectionById({
        store,
        namespace,
        taskId: task.goalTodoRef?.trim() || task.id,
        includeArchived: true
    })
}

function resolveLinkedTask(store: Store, session: Pick<StoredSession, 'id' | 'namespace' | 'metadata'>): StoredTask | null {
    const metadataLink = extractTaskLinkFromMetadata(session.metadata)

    if (metadataLink.taskId) {
        const byMetadata = materializeGoalTodoTaskOverlayForWrite({
            store,
            namespace: session.namespace,
            taskId: metadataLink.taskId
        }) ?? store.tasks.getTaskByNamespace(metadataLink.taskId, session.namespace)
        if (byMetadata && byMetadata.archivedAt === null) {
            if (isDocsBackedGoalProjectionMissing(store, session.namespace, byMetadata)) {
                return null
            }
            if (!metadataLink.projectId || byMetadata.projectId === metadataLink.projectId) {
                return byMetadata
            }
        }
    }

    const candidates = store.tasks.listTasksByActiveSessionIdAndNamespace(session.id, session.namespace)
        .filter((task) => !isDocsBackedGoalProjectionMissing(store, session.namespace, task))
    return pickTaskCandidate(candidates, metadataLink.projectId)
}

/**
 * Merge new todos with existing subtasks
 * - For full replacement (TodoWrite), replace all
 * - For incremental updates (TaskCreate/TaskUpdate), merge by id
 */
function mergeTodos(existing: unknown, incoming: TodoItem[], mode: 'replace' | 'merge'): TodoItem[] {
    if (mode === 'replace') {
        return incoming
    }

    // Merge mode: update existing by id, append new ones
    const existingMap = new Map<string, TodoItem>()
    if (Array.isArray(existing)) {
        for (const todo of existing) {
            if (todo && typeof todo === 'object' && 'id' in todo && typeof todo.id === 'string') {
                existingMap.set(todo.id, todo as TodoItem)
            }
        }
    }

    for (const todo of incoming) {
        existingMap.set(todo.id, todo)
    }

    return Array.from(existingMap.values())
}

export function syncTaskSubTasksFromSessionTodos(options: {
    store: Store
    session: Pick<StoredSession, 'id' | 'namespace' | 'metadata'>
    todos: TodoItem[]
    todosUpdatedAt: number
    mode?: 'replace' | 'merge'
}): StoredTask | null {
    const task = resolveLinkedTask(options.store, options.session)
    if (!task) {
        console.warn('[taskSubtasks] No linked task found for session', {
            sessionId: options.session.id,
            metadata: options.session.metadata
        })
        return null
    }

    if (task.subTasksUpdatedAt !== null && task.subTasksUpdatedAt >= options.todosUpdatedAt) {
        console.warn('[taskSubtasks] Skipping stale todos update', {
            taskId: task.id,
            taskSubTasksUpdatedAt: task.subTasksUpdatedAt,
            todosUpdatedAt: options.todosUpdatedAt
        })
        return null
    }

    const mode = options.mode ?? 'replace'
    const mergedTodos = mergeTodos(task.subTasks, options.todos, mode)

    console.log('[taskSubtasks] Syncing todos to task sub-tasks', {
        taskId: task.id,
        mode,
        todosCount: options.todos.length,
        mergedCount: mergedTodos.length
    })

    return options.store.tasks.updateTaskByNamespace(task.id, options.session.namespace, {
        subTasks: mergedTodos,
        subTasksUpdatedAt: options.todosUpdatedAt
    })
}
