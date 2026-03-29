import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TaskSessionStartErrorResponseSchema } from '@hopi/protocol/task-session-start'
import type { ApiClient, ApiError } from '@/api/client'
import type { AgentFlavor, ModelMode, PermissionMode, Task, TaskSessionStartFailure, TaskStartSessionResponse } from '@/types/api'
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
    error: TaskSessionStartFailure | null
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

    const resolvedError = (() => {
        if (mutation.error && typeof mutation.error === 'object') {
            const apiError = mutation.error as ApiError
            const parsed = TaskSessionStartErrorResponseSchema.safeParse(apiError.payload)
            if (parsed.success) {
                return parsed.data.error
            }
        }

        if (!mutation.error) {
            return null
        }

        const message = mutation.error instanceof Error
            ? mutation.error.message
            : String(mutation.error)

        return {
            code: 'unexpected_error' as const,
            message,
            blockedReason: null,
            retry: {
                count: 0,
                action: 'retry_start' as const,
                available: true
            }
        }
    })()

    return {
        startTaskSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: resolvedError,
    }
}
