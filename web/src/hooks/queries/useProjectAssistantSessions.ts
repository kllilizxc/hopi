import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ProjectAssistantSessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useProjectAssistantSessions(
    api: ApiClient | null,
    projectId: string | null,
    goalId?: string | null
): {
    sessions: ProjectAssistantSessionSummary[]
    pendingCount: number
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId ? queryKeys.projectAssistantSessions(projectId, goalId ?? null) : ['project-assistant', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            return await api.listProjectAssistantSessions(projectId, { goalId: goalId ?? null })
        },
        enabled: Boolean(api && projectId)
    })

    return {
        sessions: query.data?.sessions ?? [],
        pendingCount: query.data?.pendingCount ?? 0,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load assistant sessions' : null,
        refetch: query.refetch
    }
}
