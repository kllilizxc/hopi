import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task, TaskPreviewResponse, TaskPreviewRuntime, TaskPreviewStatus } from '@/types/api'
import { areTaskActionRuntimesEqual } from '@/lib/task-action-runtime'
import { invalidateTaskCaches, updateTaskCaches } from '@/hooks/mutations/taskActionCache'
import { queryKeys } from '@/lib/query-keys'

type StartTaskPreviewInput = {
    taskId: string
    payload?: {
        mode?: 'auto' | 'local' | 'worktree'
        basePort?: number
    }
}

function arePreviewRuntimesEqual(left: TaskPreviewRuntime | null | undefined, right: TaskPreviewRuntime | null | undefined): boolean {
    return areTaskActionRuntimesEqual(left, right)
}

function arePreviewStatesEqual(left: TaskPreviewStatus | null | undefined, right: TaskPreviewStatus | null | undefined): boolean {
    if (!left && !right) {
        return true
    }

    if (!left || !right) {
        return false
    }

    return left.active === right.active
        && left.status === right.status
        && left.taskId === right.taskId
        && left.sessionId === right.sessionId
        && left.mode === right.mode
        && left.rootPath === right.rootPath
        && left.runPath === right.runPath
        && left.command === right.command
        && left.port === right.port
        && left.url === right.url
        && left.pid === right.pid
        && left.startedAt === right.startedAt
        && left.updatedAt === right.updatedAt
        && left.error === right.error
        && left.logTail.length === right.logTail.length
        && left.logTail.every((entry, index) => entry === right.logTail[index])
}

function applyPreviewResponseToTask(task: Task, result: TaskPreviewResponse): Task {
    const nextPreviewRuntime = result.previewRuntime ?? task.previewRuntime ?? null
    if (arePreviewRuntimesEqual(task.previewRuntime, nextPreviewRuntime)) {
        return task
    }

    return {
        ...task,
        previewRuntime: nextPreviewRuntime
    }
}

function updatePreviewQueryCache(options: {
    queryClient: ReturnType<typeof useQueryClient>
    taskId: string
    result: TaskPreviewResponse
}): void {
    const { queryClient, taskId, result } = options

    queryClient.setQueryData<TaskPreviewResponse | undefined>(queryKeys.taskPreview(taskId), (prev) => {
        if (!prev) {
            return result
        }
        if (
            arePreviewStatesEqual(prev.preview, result.preview)
            && arePreviewRuntimesEqual(prev.previewRuntime ?? null, result.previewRuntime ?? null)
            && prev.autoRepairAttempted === result.autoRepairAttempted
            && prev.autoSetupAttempted === result.autoSetupAttempted
        ) {
            return prev
        }
        return result
    })
}

export function useTaskPreview(api: ApiClient | null): {
    startTaskPreview: (input: StartTaskPreviewInput) => Promise<TaskPreviewResponse>
    stopTaskPreview: (taskId: string) => Promise<TaskPreviewResponse>
    isStartingPreview: boolean
    isStoppingPreview: boolean
    isUpdatingPreview: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const startMutation = useMutation({
        mutationFn: async (input: StartTaskPreviewInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.startTaskPreview(input.taskId, input.payload)
        },
        onSuccess: (result, input) => {
            updateTaskCaches({
                queryClient,
                taskId: input.taskId,
                updateTask: (task) => applyPreviewResponseToTask(task, result)
            })
            updatePreviewQueryCache({
                queryClient,
                taskId: input.taskId,
                result
            })
        },
        onSettled: (_result, _error, input) => {
            invalidateTaskCaches(queryClient, input.taskId, [queryKeys.taskPreview(input.taskId)])
        }
    })

    const stopMutation = useMutation({
        mutationFn: async (taskId: string) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.stopTaskPreview(taskId)
        },
        onSuccess: (result, taskId) => {
            updateTaskCaches({
                queryClient,
                taskId,
                updateTask: (task) => applyPreviewResponseToTask(task, result)
            })
            updatePreviewQueryCache({
                queryClient,
                taskId,
                result
            })
        },
        onSettled: (_result, _error, taskId) => {
            invalidateTaskCaches(queryClient, taskId, [queryKeys.taskPreview(taskId)])
        }
    })

    return {
        startTaskPreview: startMutation.mutateAsync,
        stopTaskPreview: stopMutation.mutateAsync,
        isStartingPreview: startMutation.isPending,
        isStoppingPreview: stopMutation.isPending,
        isUpdatingPreview: startMutation.isPending || stopMutation.isPending,
        error: startMutation.error instanceof Error
            ? startMutation.error.message
            : stopMutation.error instanceof Error
                ? stopMutation.error.message
                : startMutation.error || stopMutation.error
                    ? 'Failed to update preview runtime'
                    : null,
    }
}
