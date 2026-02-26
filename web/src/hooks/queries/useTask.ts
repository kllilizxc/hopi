import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useTask(api: ApiClient | null, taskId: string | null): {
    task: Task | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: taskId ? queryKeys.task(taskId) : ['task', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!taskId) {
                throw new Error('Task ID missing')
            }
            return await api.getTask(taskId)
        },
        enabled: Boolean(api && taskId),
    })

    return {
        task: query.data?.task ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load task' : null,
        refetch: query.refetch,
    }
}

