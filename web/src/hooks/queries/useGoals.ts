import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Goal } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGoals(api: ApiClient | null, projectId: string | null): {
    goals: Goal[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId ? queryKeys.goals(projectId) : ['goals', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            return await api.listProjectGoals(projectId)
        },
        enabled: Boolean(api && projectId),
    })

    return {
        goals: query.data?.goals ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load goals' : null,
        refetch: query.refetch,
    }
}
