import type { TodoItem } from '@hapi/protocol/types'
import type { Store, StoredSession, StoredTask } from '../store'

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

function resolveLinkedTask(store: Store, session: Pick<StoredSession, 'id' | 'namespace' | 'metadata'>): StoredTask | null {
    const metadataLink = extractTaskLinkFromMetadata(session.metadata)

    if (metadataLink.taskId) {
        const byMetadata = store.tasks.getTaskByNamespace(metadataLink.taskId, session.namespace)
        if (byMetadata && byMetadata.archivedAt === null) {
            if (!metadataLink.projectId || byMetadata.projectId === metadataLink.projectId) {
                return byMetadata
            }
        }
    }

    const candidates = store.tasks.listTasksByActiveSessionIdAndNamespace(session.id, session.namespace)
    return pickTaskCandidate(candidates, metadataLink.projectId)
}

export function syncTaskSubTasksFromSessionTodos(options: {
    store: Store
    session: Pick<StoredSession, 'id' | 'namespace' | 'metadata'>
    todos: TodoItem[]
    todosUpdatedAt: number
}): StoredTask | null {
    const task = resolveLinkedTask(options.store, options.session)
    if (!task) {
        return null
    }

    if (task.subTasksUpdatedAt !== null && task.subTasksUpdatedAt >= options.todosUpdatedAt) {
        return null
    }

    return options.store.tasks.updateTaskByNamespace(task.id, options.session.namespace, {
        subTasks: options.todos,
        subTasksUpdatedAt: options.todosUpdatedAt
    })
}
