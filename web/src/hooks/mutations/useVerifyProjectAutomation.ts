import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Project, ProjectAutomationVerificationResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useVerifyProjectAutomation(api: ApiClient | null): {
    verifyProjectAutomation: (projectId: string) => Promise<ProjectAutomationVerificationResponse>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (projectId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.verifyProjectAutomation(projectId)
        },
        onSuccess: (result) => {
            const project = result.project as Project & { workspaceCount: number }
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
            void queryClient.setQueryData(queryKeys.project(project.id), { project })
        }
    })

    return {
        verifyProjectAutomation: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to verify automation' : null
    }
}
