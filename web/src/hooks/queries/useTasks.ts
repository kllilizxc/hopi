import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useTasks(api: ApiClient | null, projectId: string | null): {
    tasks: Task[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId ? queryKeys.tasks(projectId) : ['tasks', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            return await api.listProjectTasks(projectId)
        },
        enabled: Boolean(api && projectId),
    })

    return {
        tasks: query.data?.tasks ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load tasks' : null,
        refetch: query.refetch,
    }
}

