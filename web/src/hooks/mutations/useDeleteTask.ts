import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

type DeleteTaskInput = {
    taskId: string
    projectId: string
}

export function useDeleteTask(api: ApiClient | null): {
    deleteTask: (input: DeleteTaskInput) => Promise<void>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: DeleteTaskInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.deleteTask(input.taskId)
        },
        onSuccess: (_, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(input.projectId) })
            void queryClient.removeQueries({ queryKey: queryKeys.task(input.taskId) })
        }
    })

    return {
        deleteTask: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to delete task' : null,
    }
}
