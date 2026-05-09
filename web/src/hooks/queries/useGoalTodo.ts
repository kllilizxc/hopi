import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { GoalTodoResponse } from '@/types/api'

export function useGoalTodo(api: ApiClient | null, projectId: string | null, goalId: string | null): {
    todo: GoalTodoResponse | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: projectId && goalId ? queryKeys.goalTodo(projectId, goalId) : ['goal-todo', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!projectId) {
                throw new Error('Project ID missing')
            }
            if (!goalId) {
                throw new Error('Goal ID missing')
            }
            return await api.getGoalTodo(projectId, goalId)
        },
        enabled: Boolean(api && projectId && goalId),
    })

    return {
        todo: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load goal todo' : null,
        refetch: query.refetch,
    }
}
