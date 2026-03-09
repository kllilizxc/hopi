import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type {
    Task,
    TaskWorktreeMergeCancelResponse,
    TaskWorktreeMergeResponse,
    TaskWorktreeMergeSkippedReason
} from '@/types/api'
import { areTaskActionRuntimesEqual } from '@/lib/task-action-runtime'
import { invalidateTaskCaches, updateTaskCaches } from '@/hooks/mutations/taskActionCache'
import { queryKeys } from '@/lib/query-keys'

type MergeTaskWorktreeInput = {
    taskId: string
    payload?: {
        targetBranch?: string
        conflictStrategy?: 'manual' | 'agent'
    }
}

type ActiveMergeRuntimeStatus = 'queued' | 'waiting' | 'approval_pending' | 'running' | 'retrying'

const ACTIVE_MERGE_RUNTIME_STATUSES = new Set<ActiveMergeRuntimeStatus>([
    'queued',
    'waiting',
    'approval_pending',
    'running',
    'retrying'
])

function isActiveMergeSkippedReason(reason: TaskWorktreeMergeSkippedReason | null): reason is ActiveMergeRuntimeStatus {
    return reason !== null && ACTIVE_MERGE_RUNTIME_STATUSES.has(reason as ActiveMergeRuntimeStatus)
}

function areMergeRuntimesEqual(left: Task['mergeRuntime'] | null | undefined, right: Task['mergeRuntime'] | null | undefined): boolean {
    return areTaskActionRuntimesEqual(left, right)
}

function buildRuntimeNoteFromSkippedReason(reason: TaskWorktreeMergeSkippedReason): string {
    switch (reason) {
        case 'queued':
            return 'Merge queued behind the current session turn.'
        case 'waiting':
            return 'Waiting for the linked session to confirm the merge result.'
        case 'approval_pending':
            return 'Merge queued until the current approval request is resolved.'
        case 'running':
            return 'Merge requested in the linked session.'
        case 'retrying':
            return 'Merge retry already in progress.'
        case 'already_merged':
            return 'Target branch already contains this task.'
        case 'no_changes':
            return 'No committed changes are waiting to merge.'
    }
}

function buildOptimisticMergeRuntime(task: Task, result: TaskWorktreeMergeResponse): Task['mergeRuntime'] | null | undefined {
    const current = task.mergeRuntime
    const sessionId = current?.sessionId ?? task.activeSessionId ?? null
    const now = Date.now()

    if (isActiveMergeSkippedReason(result.skippedReason)) {
        const status = result.skippedReason
        const requestedAt = current?.requestedAt ?? now
        const startedAt = status === 'running' || status === 'retrying'
            ? current?.startedAt ?? now
            : current?.startedAt ?? null

        return {
            status,
            sessionId,
            updatedAt: now,
            requestedAt,
            startedAt,
            completedAt: null,
            retryCount: current?.retryCount,
            failureFingerprint: current?.failureFingerprint,
            latestNote: buildRuntimeNoteFromSkippedReason(status),
            blockedReason: null
        }
    }

    if (result.mergedAt || result.skippedReason === 'already_merged' || result.skippedReason === 'no_changes') {
        const completedAt = result.mergedAt ?? now
        const latestNote = result.skippedReason === 'already_merged' || result.skippedReason === 'no_changes'
            ? buildRuntimeNoteFromSkippedReason(result.skippedReason)
            : 'Merge completed in the linked session.'

        return {
            status: 'succeeded',
            sessionId,
            updatedAt: now,
            requestedAt: current?.requestedAt ?? completedAt,
            startedAt: current?.startedAt ?? current?.requestedAt ?? result.mergedAt ?? null,
            completedAt,
            retryCount: current?.retryCount,
            failureFingerprint: null,
            latestNote,
            blockedReason: null
        }
    }

    return current
}

function applyMergeResultToTask(task: Task, result: TaskWorktreeMergeResponse): Task {
    const mergedAt = result.mergedAt ?? task.worktreeMergedAt ?? null
    const mergeCommit = result.commitHash ?? task.worktreeMergeCommit ?? null
    const shouldMarkFinished = task.status === 'in_review' && result.mergedAt !== null && result.skippedReason === null
    const nextStatus = shouldMarkFinished ? 'finished' : task.status
    const nextFinishedAt = shouldMarkFinished
        ? (result.mergedAt ?? task.finishedAt ?? Date.now())
        : task.finishedAt
    const nextMergeRuntime = buildOptimisticMergeRuntime(task, result)

    if (
        mergedAt === task.worktreeMergedAt
        && mergeCommit === task.worktreeMergeCommit
        && nextStatus === task.status
        && nextFinishedAt === task.finishedAt
        && areMergeRuntimesEqual(nextMergeRuntime, task.mergeRuntime)
    ) {
        return task
    }

    return {
        ...task,
        worktreeMergedAt: mergedAt,
        worktreeMergeCommit: mergeCommit,
        mergeRuntime: nextMergeRuntime,
        status: nextStatus,
        finishedAt: nextFinishedAt
    }
}

function applyMergeCancelResultToTask(task: Task, result: TaskWorktreeMergeCancelResponse): Task {
    const nextMergeRuntime = result.mergeRuntime ?? null
    if (areMergeRuntimesEqual(nextMergeRuntime, task.mergeRuntime)) {
        return task
    }

    return {
        ...task,
        mergeRuntime: nextMergeRuntime
    }
}

export function useMergeTaskWorktree(api: ApiClient | null): {
    mergeTaskWorktree: (input: MergeTaskWorktreeInput) => Promise<TaskWorktreeMergeResponse>
    cancelTaskWorktreeMerge: (taskId: string) => Promise<TaskWorktreeMergeCancelResponse>
    isMerging: boolean
    isCanceling: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mergeMutation = useMutation({
        mutationFn: async (input: MergeTaskWorktreeInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.mergeTaskWorktree(input.taskId, input.payload)
        },
        onSuccess: (result, input) => {
            updateTaskCaches({
                queryClient,
                taskId: input.taskId,
                updateTask: (task) => applyMergeResultToTask(task, result)
            })
        },
        onSettled: (_result, _error, input) => {
            invalidateTaskCaches(queryClient, input.taskId, [queryKeys.taskMergeState(input.taskId)])
        }
    })

    const cancelMutation = useMutation({
        mutationFn: async (taskId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.cancelTaskWorktreeMerge(taskId)
        },
        onSuccess: (result, taskId) => {
            updateTaskCaches({
                queryClient,
                taskId,
                updateTask: (task) => applyMergeCancelResultToTask(task, result)
            })
        },
        onSettled: (_result, _error, taskId) => {
            invalidateTaskCaches(queryClient, taskId, [queryKeys.taskMergeState(taskId)])
        }
    })

    return {
        mergeTaskWorktree: mergeMutation.mutateAsync,
        cancelTaskWorktreeMerge: cancelMutation.mutateAsync,
        isMerging: mergeMutation.isPending,
        isCanceling: cancelMutation.isPending,
        error: mergeMutation.error instanceof Error
            ? mergeMutation.error.message
            : cancelMutation.error instanceof Error
                ? cancelMutation.error.message
                : mergeMutation.error || cancelMutation.error
                    ? 'Failed to update merge runtime'
                    : null,
    }
}
