import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

type DeleteWorkspaceInput = {
    projectId: string
    workspaceId: string
}

export function useDeleteWorkspace(api: ApiClient | null): {
    deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<void>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: DeleteWorkspaceInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.deleteWorkspace(input.workspaceId)
        },
        onSuccess: (_, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(input.projectId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return {
        deleteWorkspace: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to delete workspace' : null,
    }
}

