import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Project } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export type ProjectListItem = Project & { workspaceCount: number }

export function useProjects(api: ApiClient | null, options?: { includeArchived?: boolean }): {
    projects: ProjectListItem[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const includeArchived = Boolean(options?.includeArchived)

    const query = useQuery({
        queryKey: [...queryKeys.projects, includeArchived ? 'all' : 'active'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getProjects({ includeArchived })
        },
        enabled: Boolean(api),
    })

    return {
        projects: query.data?.projects ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load projects' : null,
        refetch: query.refetch,
    }
}
