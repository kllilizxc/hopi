import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task, TaskWorktreeMergeResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type MergeTaskWorktreeInput = {
    taskId: string
    payload?: {
        targetBranch?: string
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
                return {
                    ...prev,
                    task: {
                        ...prev.task,
                        worktreeMergedAt: result.mergedAt ?? prev.task.worktreeMergedAt ?? Date.now(),
                        worktreeMergeCommit: result.commitHash ?? prev.task.worktreeMergeCommit ?? null
                    }
                }
            })

            void queryClient.invalidateQueries({ queryKey: queryKeys.task(input.taskId) })
            void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        }
    })

    return {
        mergeTaskWorktree: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to merge worktree' : null,
    }
}
