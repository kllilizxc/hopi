import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Workspace } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useWorkspaces(api: ApiClient | null, projectId: string | null): {
    workspaces: Workspace[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId ? queryKeys.workspaces(projectId) : ['workspaces', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            return await api.listProjectWorkspaces(projectId)
        },
        enabled: Boolean(api && projectId),
    })

    return {
        workspaces: query.data?.workspaces ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load workspaces' : null,
        refetch: query.refetch,
    }
}

