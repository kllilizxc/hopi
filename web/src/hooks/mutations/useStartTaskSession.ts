import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AgentFlavor, ModelMode, PermissionMode, Task } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type StartTaskSessionInput = {
    taskId: string
    projectId: string
    payload?: {
        workspaceId?: string
        agent?: AgentFlavor
        model?: string
        yolo?: boolean
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }
}

export function useStartTaskSession(api: ApiClient | null): {
    startTaskSession: (input: StartTaskSessionInput) => Promise<{ task: Task; sessionId: string }>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: StartTaskSessionInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.startTaskSession(input.taskId, input.payload)
            return { task: result.task, sessionId: result.sessionId }
        },
        onSuccess: ({ task }, input) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(input.projectId) })
            void queryClient.setQueryData(queryKeys.task(task.id), { task })
            if (task.activeSessionId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.session(task.activeSessionId) })
                void queryClient.invalidateQueries({ queryKey: queryKeys.messages(task.activeSessionId) })
            }
        }
    })

    return {
        startTaskSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to start session' : null,
    }
}

