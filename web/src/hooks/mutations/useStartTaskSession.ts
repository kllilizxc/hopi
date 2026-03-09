import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AgentFlavor, ModelMode, PermissionMode, Task, TaskStartSessionResponse } from '@/types/api'
import { invalidateSessionCaches, replaceTaskInCaches } from '@/hooks/mutations/taskActionCache'
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
    startTaskSession: (input: StartTaskSessionInput) => Promise<TaskStartSessionResponse>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: StartTaskSessionInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.startTaskSession(input.taskId, input.payload)
        },
        onSuccess: (result) => {
            const previousTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(result.task.id))?.task ?? null
            replaceTaskInCaches({
                queryClient,
                taskId: result.task.id,
                task: result.task
            })
            invalidateSessionCaches(queryClient, [
                previousTask?.activeSessionId,
                result.task.activeSessionId,
                result.sessionId
            ])
        }
    })

    return {
        startTaskSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to start session' : null,
    }
}
