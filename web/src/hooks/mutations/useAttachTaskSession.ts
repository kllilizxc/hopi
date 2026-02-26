import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type AttachTaskSessionInput = {
    taskId: string
    projectId: string
    sessionId: string
}

export function useAttachTaskSession(api: ApiClient | null): {
    attachTaskSession: (input: AttachTaskSessionInput) => Promise<Task>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: AttachTaskSessionInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.attachTaskSession(input.taskId, input.sessionId)
            return result.task
        },
        onSuccess: (task, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(input.projectId) })
            void queryClient.setQueryData(queryKeys.task(task.id), { task })
            if (task.activeSessionId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.session(task.activeSessionId) })
            }
        }
    })

    return {
        attachTaskSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to attach session' : null,
    }
}

