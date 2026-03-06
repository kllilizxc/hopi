import type { Database } from 'bun:sqlite'

import type { StoredTask } from './types'
import {
    archiveTaskByNamespace,
    countPendingImprovementsTasks,
    createTask,
    deleteTaskByNamespace,
    getTask,
    getTaskByNamespace,
    listTasksByActiveSessionIdAndNamespace,
    listPlannedTasksByProjectAndNamespace,
    listTasksByProject,
    listTasksByProjectAndNamespace,
    updateTaskByNamespace
} from './tasks'

export class TaskStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getTask(taskId: string): StoredTask | null {
        return getTask(this.db, taskId)
    }

    getTaskByNamespace(taskId: string, namespace: string): StoredTask | null {
        return getTaskByNamespace(this.db, taskId, namespace)
    }

    listTasksByActiveSessionIdAndNamespace(activeSessionId: string, namespace: string, options?: { includeArchived?: boolean }): StoredTask[] {
        return listTasksByActiveSessionIdAndNamespace(this.db, activeSessionId, namespace, options)
    }

    listTasksByProject(projectId: string, options?: { includeArchived?: boolean }): StoredTask[] {
        return listTasksByProject(this.db, projectId, options)
    }

    listTasksByProjectAndNamespace(projectId: string, namespace: string, options?: { includeArchived?: boolean }): StoredTask[] {
        return listTasksByProjectAndNamespace(this.db, projectId, namespace, options)
    }

    listPlannedTasksByProjectAndNamespace(projectId: string, namespace: string, options?: { limit?: number }): StoredTask[] {
        return listPlannedTasksByProjectAndNamespace(this.db, projectId, namespace, options)
    }

    createTask(task: {
        id: string
        projectId: string
        title: string
        description?: string | null
        status: string
        priority?: string | null
        sortKey?: number | null
        activeSessionId?: string | null
        workspaceId?: string | null
        agentFlavor?: string | null
        permissionMode?: string | null
        modelMode?: string | null
        attachments?: unknown
        source?: string | null
        sourceTaskId?: string | null
        workflowProfile?: string | null
        workflowPhase?: string | null
        subTasks?: unknown
        subTasksUpdatedAt?: number | null
        worktreeMergedAt?: number | null
        worktreeMergeCommit?: string | null
    }): StoredTask {
        return createTask(this.db, task)
    }

    updateTaskByNamespace(
        taskId: string,
        namespace: string,
        patch: {
            title?: string
            description?: string | null
            status?: string
            priority?: string | null
            sortKey?: number | null
            activeSessionId?: string | null
            workspaceId?: string | null
            agentFlavor?: string | null
            permissionMode?: string | null
            modelMode?: string | null
            source?: string | null
            workflowProfile?: string
            workflowPhase?: string | null
            attachments?: unknown
            subTasks?: unknown
            subTasksUpdatedAt?: number | null
            worktreeMergedAt?: number | null
            worktreeMergeCommit?: string | null
            mergedDiffSnapshot?: unknown
            finishedAt?: number | null
            archivedAt?: number | null
        }
    ): StoredTask | null {
        return updateTaskByNamespace(this.db, taskId, namespace, patch)
    }

    archiveTaskByNamespace(taskId: string, namespace: string): boolean {
        return archiveTaskByNamespace(this.db, taskId, namespace)
    }

    deleteTaskByNamespace(taskId: string, namespace: string): boolean {
        return deleteTaskByNamespace(this.db, taskId, namespace)
    }

    countPendingImprovementsTasks(projectId: string, namespace: string): number {
        return countPendingImprovementsTasks(this.db, projectId, namespace)
    }
}
