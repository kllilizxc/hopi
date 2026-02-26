import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Workspace } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type CreateWorkspacesInput = {
    projectId: string
    workspaces: Array<{ path: string; label?: string }>
}

export function useCreateWorkspaces(api: ApiClient | null): {
    createWorkspaces: (input: CreateWorkspacesInput) => Promise<Workspace[]>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: CreateWorkspacesInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createProjectWorkspaces(input.projectId, input.workspaces)
            return result.workspaces
        },
        onSuccess: (_, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(input.projectId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return {
        createWorkspaces: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to create workspaces' : null,
    }
}

