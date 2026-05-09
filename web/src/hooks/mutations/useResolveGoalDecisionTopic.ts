import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GoalDecisionTopic } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type ResolveGoalDecisionTopicInput = {
    topicId: string
    projectId: string
    goalId: string
    resolution: string
}

export function useResolveGoalDecisionTopic(api: ApiClient | null): {
    resolveTopic: (input: ResolveGoalDecisionTopicInput) => Promise<GoalDecisionTopic>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: ResolveGoalDecisionTopicInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.resolveGoalDecisionTopic(input.topicId, {
                resolution: input.resolution
            })
            return result.topic
        },
        onSuccess: (topic, input) => {
            const goalId = topic.goalId || input.goalId
            const projectId = topic.projectId || input.projectId
            void queryClient.invalidateQueries({ queryKey: queryKeys.goalTopics(goalId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(projectId) })
            if (topic.taskId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.task(topic.taskId) })
            }
        }
    })

    return {
        resolveTopic: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to resolve decision topic' : null,
    }
}
