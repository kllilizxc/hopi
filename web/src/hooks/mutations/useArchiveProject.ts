import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useArchiveProject(api: ApiClient | null): {
    archiveProject: (projectId: string) => Promise<void>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (projectId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.archiveProject(projectId)
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return {
        archiveProject: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to archive project' : null,
    }
}

