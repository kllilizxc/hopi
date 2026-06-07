import type { Store, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { getDocsRoot } from './goalDocPaths'
import {
    readGoalTodo,
    type GoalTodoBoardItem,
    type GoalTodoCanonicalStatus,
    type GoalTodoStatus
} from './goalTodo'
import {
    getStoredTaskRuntimeBlockedReason,
    getStoredTaskRuntimeBlockedSource
} from './goalTaskState'

type GoalTaskCanonicalStatus = GoalTodoCanonicalStatus

function normalizeProjectedBoardItemStatus(options: {
    item: GoalTodoBoardItem
}): GoalTodoStatus {
    switch (options.item.status) {
        case 'planned':
            return 'planning'
        case 'in_progress':
            return 'running'
        case 'in_review':
        case 'merging':
            return 'review'
        case 'done':
            return 'done'
    }
}

function normalizeProjectedCanonicalTaskStatus(options: {
    item: GoalTodoBoardItem
}): GoalTaskCanonicalStatus | null {
    switch (options.item.status) {
        case 'planned':
        case 'in_progress':
        case 'in_review':
        case 'merging':
        case 'done':
            return options.item.status
    }
}

function getProjectedTaskTag(item: GoalTodoBoardItem): string | null {
    if (item.tag === 'candidate' || item.tag === 'deferred') {
        return item.tag
    }
    switch (item.status) {
        case 'planned':
            return 'ready'
        case 'in_progress':
            return 'promoted'
        case 'in_review':
            return 'in_review'
        case 'merging':
            return 'merging'
        case 'done':
            return 'accepted'
    }
}

function getDefaultWorkspaceForProject(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace) return workspace
    }
    return store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function getBlockedTaskActionRuntime(task: StoredTask | null): NonNullable<StoredTask['mergeRuntime'] | StoredTask['previewRuntime'] | StoredTask['initRuntime']> | null {
    if (!task) {
        return null
    }
    if (task.mergeRuntime?.status === 'blocked') {
        return task.mergeRuntime
    }
    if (task.previewRuntime?.status === 'blocked') {
        return task.previewRuntime
    }
    if (task.initRuntime?.status === 'blocked') {
        return task.initRuntime
    }
    return null
}

function hasOverlayDerivedBlockedState(task: StoredTask | null): boolean {
    if (!task || task.archivedAt) {
        return false
    }

    if (getStoredTaskRuntimeBlockedSource(task)) {
        return true
    }

    return task.status === 'blocked'
        && typeof task.blockedSource === 'string'
        && task.blockedSource.trim().length > 0
}

function getEffectiveGoalTodoRef(options: {
    task: StoredTask
    matchedTodoRef?: string | null
}): string | null {
    const explicitRef = options.task.goalTodoRef?.trim()
    if (explicitRef) {
        return explicitRef
    }
    const matchedRef = options.matchedTodoRef?.trim()
    if (matchedRef) {
        return matchedRef
    }
    if (options.task.archivedAt) {
        return null
    }
    return options.task.id
}

function isReservoirPlanningItem(item: GoalTodoBoardItem): boolean {
    return item.status === 'planned' && (item.tag === 'candidate' || item.tag === 'deferred')
}

export type GoalTodoProjectedTask = StoredTask & {
    tag?: string | null
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
}

export function buildGoalTodoTaskProjection(options: {
    store: Store
    project: StoredProject
    goalId: string
    namespace: string
    includeArchived: boolean
    includeReservoirPlanningNotes?: boolean
}): GoalTodoProjectedTask[] {
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return []
    }

    const defaultWorkspace = getDefaultWorkspaceForProject(options.store, options.project)
    const todo = readGoalTodo({
        project: options.project,
        goal,
        defaultWorkspace
    })
    let overlays = options.store.tasks.listTasksByProjectAndNamespace(options.project.id, options.namespace, {
        includeArchived: true,
        goalId: goal.id
    })
    const todoRefByTaskId = new Map<string, string>()
    for (const item of todo.board.items) {
        if (item.taskId) {
            todoRefByTaskId.set(item.taskId, item.ref)
        }
    }
    const overlayByKey = new Map<string, StoredTask>()
    for (const task of overlays) {
        const effectiveGoalTodoRef = getEffectiveGoalTodoRef({
            task,
            matchedTodoRef: todoRefByTaskId.get(task.id) ?? null
        })
        overlayByKey.set(task.id, task)
        if (effectiveGoalTodoRef) {
            overlayByKey.set(effectiveGoalTodoRef, task)
        }
    }

    const baseTime = todo.updatedAt ?? Date.now()
    return todo.board.items.flatMap((item, index) => {
        if (!options.includeReservoirPlanningNotes && isReservoirPlanningItem(item)) {
            return []
        }
        const overlay = overlayByKey.get(item.ref)
            ?? (item.taskId ? overlayByKey.get(item.taskId) ?? null : null)
        if (!options.includeArchived && overlay?.archivedAt) {
            return []
        }
        const overlayDerivedBlocked = hasOverlayDerivedBlockedState(overlay)
        const runtimeBlocked = getBlockedTaskActionRuntime(overlay)
        const runtimeBlockedSource = getStoredTaskRuntimeBlockedSource(overlay)
        const goalCanonicalStatus = normalizeProjectedCanonicalTaskStatus({
            item
        })
        const hasBlockedProjectionState = overlayDerivedBlocked
            || item.blockedBy.length > 0
        const status = normalizeProjectedBoardItemStatus({
            item
        })
        const blockedEntry = item.blockedBy[0] ?? null
        const blockedReason = hasBlockedProjectionState
            ? getStoredTaskRuntimeBlockedReason(overlay) ?? overlay?.blockedReason ?? blockedEntry?.summary ?? null
            : null
        const syntheticMergeRuntime = !overlay?.mergeRuntime && item.status === 'merging'
            ? {
                status: hasBlockedProjectionState ? 'blocked' as const : 'waiting' as const,
                updatedAt: baseTime,
                blockedReason,
                latestNote: hasBlockedProjectionState
                    ? blockedReason ?? 'Todo board marks this task as blocked during merge.'
                    : 'Todo board marks this task as waiting for merge.'
            }
            : null
        const syntheticInitRuntime = !overlay?.initRuntime
            && !runtimeBlocked
            && hasBlockedProjectionState
            && item.status === 'in_progress'
            ? {
                status: 'blocked' as const,
                updatedAt: baseTime,
                blockedReason,
                latestNote: blockedReason ?? 'Todo board marks this task as blocked in progress.'
            }
            : null
        const effectiveBlockedSource = hasBlockedProjectionState
            ? (
                runtimeBlockedSource
                ?? overlay?.blockedSource
                ?? (item.status === 'in_review' ? 'evaluator' : null)
                ?? blockedEntry?.kind
                ?? null
            )
            : null
        return [{
            id: overlay?.id ?? item.taskId ?? item.ref,
            projectId: options.project.id,
            goalId: goal.id,
            goalTodoRef: item.ref,
            goalCanonicalStatus,
            title: item.title,
            description: item.description || overlay?.description || null,
            status,
            tag: getProjectedTaskTag(item),
            blockedReason,
            blockedAt: hasBlockedProjectionState
                ? runtimeBlocked?.updatedAt ?? overlay?.blockedAt ?? null
                : null,
            blockedSource: effectiveBlockedSource,
            blockedSessionId: hasBlockedProjectionState
                ? runtimeBlocked?.sessionId ?? overlay?.blockedSessionId ?? null
                : null,
            priority: overlay?.priority ?? null,
            sortKey: overlay?.sortKey ?? baseTime - index,
            activeSessionId: overlay?.activeSessionId ?? null,
            workspaceId: overlay?.workspaceId ?? defaultWorkspace?.id ?? null,
            agentFlavor: overlay?.agentFlavor ?? options.project.defaultAgentFlavor,
            permissionMode: overlay?.permissionMode ?? options.project.defaultPermissionMode,
            model: overlay?.model ?? options.project.defaultModel,
            modelMode: overlay?.modelMode ?? options.project.defaultModelMode,
            attachments: overlay?.attachments ?? null,
            source: overlay?.source ?? 'manual',
            sourceTaskId: overlay?.sourceTaskId ?? null,
            workflowProfile: overlay?.workflowProfile ?? 'default',
            workflowPhase: overlay?.workflowPhase ?? null,
            subTasks: overlay?.subTasks ?? null,
            subTasksUpdatedAt: overlay?.subTasksUpdatedAt ?? null,
            worktreeMergedAt: overlay?.worktreeMergedAt ?? null,
            worktreeMergeCommit: overlay?.worktreeMergeCommit ?? null,
            mergedDiffSnapshot: overlay?.mergedDiffSnapshot ?? null,
            mergeRuntime: overlay?.mergeRuntime ?? syntheticMergeRuntime,
            previewRuntime: overlay?.previewRuntime ?? null,
            initRuntime: overlay?.initRuntime ?? syntheticInitRuntime,
            contract: overlay?.contract ?? null,
            handoff: overlay?.handoff ?? null,
            evidence: overlay?.evidence ?? null,
            createdAt: overlay?.createdAt ?? baseTime,
            updatedAt: Math.max(overlay?.updatedAt ?? 0, baseTime),
            finishedAt: overlay?.finishedAt ?? null,
            archivedAt: overlay?.archivedAt ?? null
        }]
    })
}

export function findGoalTodoTaskProjectionById(options: {
    store: Store
    namespace: string
    taskId: string
    includeArchived?: boolean
}): GoalTodoProjectedTask | null {
    const projects = options.store.projects.listProjectsByNamespace(options.namespace, {
        includeArchived: Boolean(options.includeArchived)
    })
    for (const project of projects) {
        const goals = options.store.goals.listGoalsByProjectAndNamespace(project.id, options.namespace, {
            includeArchived: Boolean(options.includeArchived)
        })
        for (const goal of goals) {
            const tasks = buildGoalTodoTaskProjection({
                store: options.store,
                project,
                goalId: goal.id,
                namespace: options.namespace,
                includeArchived: Boolean(options.includeArchived)
            })
            const task = tasks.find((candidate) => (
                candidate.id === options.taskId
                || candidate.goalTodoRef === options.taskId
            ))
            if (task) return task
        }
    }
    return null
}

export function getTaskByNamespaceOrGoalTodoProjection(options: {
    store: Store
    namespace: string
    taskId: string
}): GoalTodoProjectedTask | StoredTask | null {
    const stored = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (stored?.goalId) {
        const project = options.store.projects.getProjectByNamespace(stored.projectId, options.namespace)
        if (project) {
            const projected = buildGoalTodoTaskProjection({
                store: options.store,
                project,
                goalId: stored.goalId,
                namespace: options.namespace,
                includeArchived: true
            })
            const matched = projected.find((candidate) => (
                candidate.id === options.taskId
                || candidate.goalTodoRef === options.taskId
                || candidate.id === stored.id
                || candidate.goalTodoRef === stored.goalTodoRef
            ))
            if (matched) {
                return matched
            }

            const defaultWorkspace = getDefaultWorkspaceForProject(options.store, project)
            if (getDocsRoot(defaultWorkspace)) {
                return null
            }
        }
        return stored
    }

    return stored ?? findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId,
        includeArchived: true
    })
}

export function materializeGoalTodoTaskOverlayForWrite(options: {
    store: Store
    namespace: string
    taskId: string
}): StoredTask | null {
    const existing = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (existing && !existing.goalId) {
        return existing
    }

    const projected = findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId,
        includeArchived: true
    })
    if (existing?.goalId && !projected) {
        const project = options.store.projects.getProjectByNamespace(existing.projectId, options.namespace)
        const defaultWorkspace = project ? getDefaultWorkspaceForProject(options.store, project) : null
        if (getDocsRoot(defaultWorkspace)) {
            return null
        }
        return existing
    }
    if (!projected || !projected.goalId) {
        return null
    }

    const latest = options.store.tasks.getTaskByNamespace(projected.id, options.namespace)
    if (latest) {
        const effectiveGoalTodoRef = projected.goalTodoRef?.trim() || projected.id
        if (!latest.goalTodoRef && effectiveGoalTodoRef) {
            return options.store.tasks.updateTaskByNamespace(latest.id, options.namespace, {
                goalTodoRef: effectiveGoalTodoRef
            }) ?? latest
        }
        return latest
    }

    return options.store.tasks.createTask({
        id: projected.id,
        projectId: projected.projectId,
        goalId: projected.goalId,
        goalTodoRef: projected.goalTodoRef ?? projected.id,
        title: projected.title,
        description: projected.description,
        status: projected.status,
        blockedReason: projected.blockedReason,
        blockedAt: projected.blockedAt,
        blockedSource: projected.blockedSource,
        blockedSessionId: projected.blockedSessionId,
        priority: projected.priority,
        sortKey: projected.sortKey,
        activeSessionId: projected.activeSessionId,
        workspaceId: projected.workspaceId,
        agentFlavor: projected.agentFlavor,
        permissionMode: projected.permissionMode,
        model: projected.model,
        modelMode: projected.modelMode,
        attachments: projected.attachments ?? undefined,
        source: projected.source,
        sourceTaskId: projected.sourceTaskId,
        workflowProfile: projected.workflowProfile,
        workflowPhase: projected.workflowPhase,
        subTasks: projected.subTasks ?? undefined,
        subTasksUpdatedAt: projected.subTasksUpdatedAt,
        worktreeMergedAt: projected.worktreeMergedAt,
        worktreeMergeCommit: projected.worktreeMergeCommit,
        // Materialization creates a writable runtime overlay row. Synthetic runtime
        // state derived from docs projection should not be copied into SQLite.
        mergeRuntime: null,
        previewRuntime: null,
        initRuntime: null,
        contract: projected.contract,
        handoff: projected.handoff,
        evidence: projected.evidence
    })
}
