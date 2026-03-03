import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task, TaskWorktreeMergeResponse, TasksResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type MergeTaskWorktreeInput = {
    taskId: string
    payload?: {
        targetBranch?: string
        conflictStrategy?: 'manual' | 'agent'
    }
}

function applyMergeResultToTask(task: Task, result: TaskWorktreeMergeResponse): Task {
    const mergedAt = result.mergedAt ?? task.worktreeMergedAt ?? null
    const mergeCommit = result.commitHash ?? task.worktreeMergeCommit ?? null
    const shouldMarkFinished = task.status === 'in_review' && result.skippedReason !== 'already_merged'
    const nextStatus = shouldMarkFinished ? 'finished' : task.status
    const nextFinishedAt = shouldMarkFinished
        ? (result.mergedAt ?? task.finishedAt ?? Date.now())
        : task.finishedAt

    if (
        mergedAt === task.worktreeMergedAt
        && mergeCommit === task.worktreeMergeCommit
        && nextStatus === task.status
        && nextFinishedAt === task.finishedAt
    ) {
        return task
    }

    return {
        ...task,
        worktreeMergedAt: mergedAt,
        worktreeMergeCommit: mergeCommit,
        status: nextStatus,
        finishedAt: nextFinishedAt
    }
}

export function useMergeTaskWorktree(api: ApiClient | null): {
    mergeTaskWorktree: (input: MergeTaskWorktreeInput) => Promise<TaskWorktreeMergeResponse>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: MergeTaskWorktreeInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.mergeTaskWorktree(input.taskId, input.payload)
        },
        onSuccess: (result, input) => {
            queryClient.setQueryData<{ task: Task } | undefined>(queryKeys.task(input.taskId), (prev) => {
                if (!prev?.task) {
                    return prev
                }
                const nextTask = applyMergeResultToTask(prev.task, result)
                if (nextTask === prev.task) {
                    return prev
                }
                return {
                    ...prev,
                    task: nextTask
                }
            })

            queryClient.setQueriesData<TasksResponse>({ queryKey: ['tasks'] }, (prev) => {
                if (!prev?.tasks || prev.tasks.length === 0) {
                    return prev
                }

                let changed = false
                const nextTasks = prev.tasks.map((task) => {
                    if (task.id !== input.taskId) {
                        return task
                    }
                    const nextTask = applyMergeResultToTask(task, result)
                    if (nextTask !== task) {
                        changed = true
                    }
                    return nextTask
                })

                if (!changed) {
                    return prev
                }

                return {
                    ...prev,
                    tasks: nextTasks
                }
            })
        },
        onSettled: (_result, _error, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.task(input.taskId) })
            void queryClient.invalidateQueries({ queryKey: ['tasks'] })
            void queryClient.invalidateQueries({ queryKey: queryKeys.taskMergeState(input.taskId) })
        }
    })

    return {
        mergeTaskWorktree: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to merge worktree' : null,
    }
}
