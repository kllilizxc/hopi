import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Goal } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type CreateGoalInput = {
    projectId: string
    title: string
    description?: string | null
    successCriteria?: string | null
    autopilotEnabled?: boolean
    deployRequiresApproval?: boolean
}

export function useCreateGoal(api: ApiClient | null): {
    createGoal: (input: CreateGoalInput) => Promise<Goal>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: CreateGoalInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createProjectGoal(input.projectId, {
                title: input.title,
                description: input.description,
                successCriteria: input.successCriteria,
                autopilotEnabled: input.autopilotEnabled,
                deployRequiresApproval: input.deployRequiresApproval
            })
            return result.goal
        },
        onSuccess: (goal) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.goals(goal.projectId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(goal.projectId) })
        }
    })

    return {
        createGoal: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to create goal' : null,
    }
}
