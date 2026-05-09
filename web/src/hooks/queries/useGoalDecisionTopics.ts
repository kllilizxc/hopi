import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GoalDecisionTopic } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGoalDecisionTopics(api: ApiClient | null, goalId: string | null): {
    topics: GoalDecisionTopic[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: goalId ? queryKeys.goalTopics(goalId) : ['goal-topics', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!goalId) {
                throw new Error('Goal ID missing')
            }
            return await api.listGoalDecisionTopics(goalId)
        },
        enabled: Boolean(api && goalId),
    })

    return {
        topics: query.data?.topics ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load decision topics' : null,
        refetch: query.refetch,
    }
}
