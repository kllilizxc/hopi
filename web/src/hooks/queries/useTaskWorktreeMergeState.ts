import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TaskWorktreeMergeStateResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useTaskWorktreeMergeState(
    api: ApiClient | null,
    taskId: string | null,
    options?: { enabled?: boolean }
): {
    state: TaskWorktreeMergeStateResponse | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const enabled = options?.enabled ?? true
    const query = useQuery({
        queryKey: taskId ? queryKeys.taskMergeState(taskId) : ['task-merge-state', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!taskId) {
                throw new Error('Task ID missing')
            }
            return await api.getTaskWorktreeMergeState(taskId)
        },
        enabled: Boolean(api && taskId && enabled),
    })

    return {
        state: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load merge state' : null,
        refetch: query.refetch,
    }
}
