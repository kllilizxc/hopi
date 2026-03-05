import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { WorkflowStrategyDescriptor } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useWorkflowStrategies(api: ApiClient | null): {
    strategies: WorkflowStrategyDescriptor[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.workflowStrategies,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.listWorkflowStrategies()
        },
        enabled: Boolean(api),
    })

    return {
        strategies: query.data?.strategies ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load workflow strategies' : null,
        refetch: query.refetch,
    }
}
