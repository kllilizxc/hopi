import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AgentFlavor, ModelMode, PermissionMode, Project } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type CreateProjectInput = {
    machineId: string
    name: string
    description?: string
    workspaces: Array<{ path: string; label?: string }>
    defaultSessionType?: 'simple' | 'worktree'
    worktreeTargetBranch?: string
    worktreeAutoCommitMode?: 'off' | 'per_conversation'
    worktreeCleanupAfterMerge?: boolean
    defaultAgentFlavor?: AgentFlavor
    defaultPermissionMode?: PermissionMode
    defaultModel?: string
    defaultModelMode?: ModelMode
    autoRunEnabled?: boolean
    maxRunningSessions?: number
    improvementsEnabled?: boolean
    improvementsMaxPendingTasks?: number
}

export function useCreateProject(api: ApiClient | null): {
    createProject: (input: CreateProjectInput) => Promise<Project & { workspaceCount: number }>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: CreateProjectInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createProject(input)
            return result.project
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return {
        createProject: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to create project' : null,
    }
}
