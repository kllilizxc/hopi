import { useMutation } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TaskWorktreeMergeResponse } from '@/types/api'

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
    const mutation = useMutation({
        mutationFn: async (input: MergeTaskWorktreeInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.mergeTaskWorktree(input.taskId, input.payload)
        }
    })

    return {
        mergeTaskWorktree: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to merge worktree' : null,
    }
}

