import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

type ArchiveTaskInput = {
    taskId: string
    projectId: string
}

export function useArchiveTask(api: ApiClient | null): {
    archiveTask: (input: ArchiveTaskInput) => Promise<void>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: ArchiveTaskInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.archiveTask(input.taskId)
        },
        onSuccess: (_, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(input.projectId) })
        }
    })

    return {
        archiveTask: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to archive task' : null,
    }
}

