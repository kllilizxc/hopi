import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Project } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export type ProjectItem = Project & { workspaceCount: number }

export function useProject(api: ApiClient | null, projectId: string | null): {
    project: ProjectItem | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId ? queryKeys.project(projectId) : ['project', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            return await api.getProject(projectId)
        },
        enabled: Boolean(api && projectId),
    })

    return {
        project: query.data?.project ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load project' : null,
        refetch: query.refetch,
    }
}

