import type { StoredTask } from '../../store'
import type { GoalTodoCanonicalStatus, GoalTodoStatus } from './goalTodo'

type GoalTodoStoredTaskInput = Pick<
    StoredTask,
    'status' | 'blockedSource' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'
>

type GoalTodoBlockedStateInput = Pick<
    StoredTask,
    'blockedReason' | 'blockedSource' | 'blockedAt' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'
>

type RecoverStoredTaskStatusInput = Pick<
    StoredTask,
    'goalId' | 'status' | 'blockedSource' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'
>

type StoredTaskBlockInput = Pick<
    StoredTask,
    'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'
>

function hasGoalTodoMergeLaneRuntime(task: Pick<StoredTask, 'mergeRuntime'>): boolean {
    const status = task.mergeRuntime?.status
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
        || status === 'blocked'
}

export function getGoalCanonicalStatusForStoredTask(task: GoalTodoStoredTaskInput): Exclude<GoalTodoCanonicalStatus, 'candidate'> {
    const status = getGoalTodoStatusForStoredTask(task)
    switch (status) {
        case 'planning':
            return 'planned'
        case 'running':
            return 'in_progress'
        case 'review':
            return hasGoalTodoMergeLaneRuntime(task) ? 'merging' : 'in_review'
        case 'done':
        default:
            return 'done'
    }
}

export function getGoalTodoStatusForStoredTask(task: GoalTodoStoredTaskInput): GoalTodoStatus {
    switch (task.status) {
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
            if (task.blockedSource === 'merge' || task.mergeRuntime?.status === 'blocked') {
                return 'review'
            }
            if (
                task.blockedSource === 'preview'
                || task.blockedSource === 'init'
                || task.previewRuntime?.status === 'blocked'
                || task.initRuntime?.status === 'blocked'
            ) {
                return 'running'
            }
            if (task.blockedSource === 'evaluator') {
                return 'review'
            }
            return 'planning'
        case 'done':
        case 'finished':
            return 'done'
        default:
            return 'planning'
    }
}

export function getGoalTodoTagForStoredTask(task: GoalTodoStoredTaskInput): string | null {
    const status = getGoalTodoStatusForStoredTask(task)
    switch (status) {
        case 'planning':
            return 'ready'
        case 'running':
            return 'promoted'
        case 'review':
            return hasGoalTodoMergeLaneRuntime(task) ? 'merging' : 'in_review'
        case 'done':
            return 'accepted'
    }
    return null
}

export function getStoredTaskRuntimeBlockedSource(task: Pick<StoredTask, 'mergeRuntime' | 'previewRuntime' | 'initRuntime'> | null | undefined): string | null {
    if (!task) return null
    if (task.mergeRuntime?.status === 'blocked') return 'merge'
    if (task.previewRuntime?.status === 'blocked') return 'preview'
    if (task.initRuntime?.status === 'blocked') return 'init'
    return null
}

export function getStoredTaskRuntimeBlockedReason(task: Pick<StoredTask, 'mergeRuntime' | 'previewRuntime' | 'initRuntime'> | null | undefined): string | null {
    if (!task) return null
    if (task.mergeRuntime?.status === 'blocked') {
        return task.mergeRuntime.blockedReason?.trim() || null
    }
    if (task.previewRuntime?.status === 'blocked') {
        return task.previewRuntime.blockedReason?.trim() || null
    }
    if (task.initRuntime?.status === 'blocked') {
        return task.initRuntime.blockedReason?.trim() || null
    }
    return null
}

export function hasStoredTaskBlock(task: StoredTaskBlockInput | null | undefined): boolean {
    return Boolean(
        task
        && (
            task.status === 'blocked'
            || task.blockedReason
            || task.blockedSource
            || task.blockedSessionId
        )
    )
}

export function isStoredTaskDecisionBlocked(task: StoredTaskBlockInput | null | undefined): boolean {
    return Boolean(
        task
        && (
            task.blockedSource === 'decision'
            || (task.status === 'blocked' && !task.blockedSource && hasStoredTaskBlock(task))
        )
    )
}

export function buildGoalTodoBlockedStateFromStoredTask(task: GoalTodoBlockedStateInput): {
    kind: string | null
    summary: string | null
    updatedAt: number
} | null {
    const runtimeBlockedSource = getStoredTaskRuntimeBlockedSource(task)
    const runtimeBlockedReason = getStoredTaskRuntimeBlockedReason(task)
    const explicitBlockedSource = task.blockedSource?.trim() || null
    const explicitBlockedReason = task.blockedReason?.trim() || null
    const explicitBlockPresent = Boolean(explicitBlockedSource || explicitBlockedReason)
    const summary = explicitBlockedReason
        ?? (
            explicitBlockedSource && runtimeBlockedSource && runtimeBlockedSource !== explicitBlockedSource
                ? null
                : runtimeBlockedReason
        )
        ?? null
    const kind = explicitBlockedSource
        ?? runtimeBlockedSource
        ?? (explicitBlockPresent || summary ? 'intervention' : null)

    if (!kind && !summary) {
        return null
    }

    return {
        kind,
        summary,
        updatedAt: task.blockedAt ?? Date.now()
    }
}

export function recoverStoredTaskStatusFromLegacyBlocked(
    task: RecoverStoredTaskStatusInput,
    options?: {
        nonGoalFallback?: StoredTask['status']
    }
): StoredTask['status'] {
    if (!task.goalId) {
        return options?.nonGoalFallback ?? 'blocked'
    }
    if (task.status !== 'blocked') {
        return task.status
    }

    switch (getGoalTodoStatusForStoredTask(task)) {
        case 'review':
            return 'review'
        case 'running':
            return 'running'
        case 'done':
            return 'done'
        case 'planning':
        default:
            return 'planning'
    }
}
