import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type {
    ProjectAssistantSessionSummary
} from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function invalidateAssistant(queryClient: ReturnType<typeof useQueryClient>, projectId: string, goalId?: string | null): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssistantRoot(projectId) })
    if (goalId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssistantSessions(projectId, goalId) })
    }
}

export function useProjectAssistantActions(api: ApiClient | null, projectId: string): {
    ensureSession: (input: {
        kind: 'normal'
        goalId?: string | null
    }) => Promise<ProjectAssistantSessionSummary>
    resolveIntervention: (input: {
        sessionId: string
        status: 'resolved' | 'dismissed'
        actionId?: string | null
        note?: string | null
    }) => Promise<void>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const ensureSessionMutation = useMutation({
        mutationFn: async (input: {
            kind: 'normal'
            goalId?: string | null
        }) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const response = await api.ensureProjectAssistantSession(projectId, input)
            return response.session
        },
        onSuccess: (session) => {
            invalidateAssistant(queryClient, projectId, session.goalId)
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.messages(session.id) })
        }
    })

    const resolveMutation = useMutation({
        mutationFn: async (input: {
            sessionId: string
            status: 'resolved' | 'dismissed'
            actionId?: string | null
            note?: string | null
        }) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.resolveProjectAssistantIntervention(projectId, input.sessionId, {
                status: input.status,
                actionId: input.actionId,
                note: input.note
            })
        },
        onSuccess: (_result, input) => {
            invalidateAssistant(queryClient, projectId)
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(input.sessionId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.messages(input.sessionId) })
        }
    })

    const pending = ensureSessionMutation.isPending
        || resolveMutation.isPending
    const error = ensureSessionMutation.error
        ?? resolveMutation.error

    return {
        ensureSession: ensureSessionMutation.mutateAsync,
        resolveIntervention: resolveMutation.mutateAsync,
        isPending: pending,
        error: error instanceof Error ? error.message : error ? 'Assistant action failed' : null
    }
}
