import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AgentFlavor, ModelMode, PermissionMode, Project } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type UpdateProjectInput = {
    projectId: string
    patch: {
        name?: string
        description?: string | null
        defaultAgentFlavor?: AgentFlavor | null
        defaultPermissionMode?: PermissionMode | null
        defaultModelMode?: ModelMode | null
        defaultSessionType?: 'simple' | 'worktree' | null
        worktreeTargetBranch?: string | null
        worktreeAutoCommitMode?: 'off' | 'per_conversation' | null
        worktreeCleanupAfterMerge?: boolean
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }
}

export function useUpdateProject(api: ApiClient | null): {
    updateProject: (input: UpdateProjectInput) => Promise<Project & { workspaceCount: number }>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: UpdateProjectInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.updateProject(input.projectId, input.patch)
            return result.project
        },
        onSuccess: (project) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
            void queryClient.setQueryData(queryKeys.project(project.id), { project })
        }
    })

    return {
        updateProject: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to update project' : null,
    }
}
