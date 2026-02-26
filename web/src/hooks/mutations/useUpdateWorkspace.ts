import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Workspace } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type UpdateWorkspaceInput = {
    projectId: string
    workspaceId: string
    patch: { path?: string; label?: string | null; sort?: number | null }
}

export function useUpdateWorkspace(api: ApiClient | null): {
    updateWorkspace: (input: UpdateWorkspaceInput) => Promise<Workspace>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: UpdateWorkspaceInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.updateWorkspace(input.workspaceId, input.patch)
            return result.workspace
        },
        onSuccess: (_, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(input.projectId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return {
        updateWorkspace: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to update workspace' : null,
    }
}

