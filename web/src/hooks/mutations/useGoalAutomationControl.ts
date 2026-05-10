import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Goal } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGoalAutomationControl(api: ApiClient | null): {
    pauseGoalAutomation: (goalId: string) => Promise<Goal>
    resumeGoalAutomation: (goalId: string) => Promise<Goal>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const invalidateGoalAutomationCaches = (goal: Goal) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.goals(goal.projectId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(goal.projectId) })
    }

    const pauseMutation = useMutation({
        mutationFn: async (goalId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.pauseGoalAutomation(goalId)
            return result.goal
        },
        onSuccess: invalidateGoalAutomationCaches
    })

    const resumeMutation = useMutation({
        mutationFn: async (goalId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.resumeGoalAutomation(goalId)
            return result.goal
        },
        onSuccess: invalidateGoalAutomationCaches
    })

    const error = pauseMutation.error ?? resumeMutation.error

    return {
        pauseGoalAutomation: pauseMutation.mutateAsync,
        resumeGoalAutomation: resumeMutation.mutateAsync,
        isPending: pauseMutation.isPending || resumeMutation.isPending,
        error: error instanceof Error ? error.message : error ? 'Failed to update goal automation' : null
    }
}
