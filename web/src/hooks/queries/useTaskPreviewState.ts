import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Task, TaskPreviewResponse, TaskPreviewRuntime, TaskPreviewStatus } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type ActivePreviewRuntimeStatus = 'queued' | 'waiting' | 'approval_pending' | 'running' | 'retrying'

const ACTIVE_PREVIEW_RUNTIME_STATUSES = new Set<ActivePreviewRuntimeStatus>([
    'queued',
    'waiting',
    'approval_pending',
    'running',
    'retrying'
])

function isActivePreviewRuntimeStatus(status: TaskPreviewRuntime['status'] | null | undefined): status is ActivePreviewRuntimeStatus {
    return status !== null && status !== undefined && ACTIVE_PREVIEW_RUNTIME_STATUSES.has(status as ActivePreviewRuntimeStatus)
}

function shouldPollPreview(response: TaskPreviewResponse | undefined, task: Task | null | undefined): boolean {
    const runtime = response?.previewRuntime ?? task?.previewRuntime ?? null
    const preview = response?.preview ?? null

    if (preview?.active) {
        return true
    }

    return isActivePreviewRuntimeStatus(runtime?.status)
}

export function useTaskPreviewState(
    api: ApiClient | null,
    task: Task | null,
    options?: {
        enabled?: boolean
        sessionId?: string | null
        sessionActive?: boolean
    }
): {
    preview: TaskPreviewStatus | null
    previewRuntime: TaskPreviewRuntime | null
    isLoading: boolean
    isFetching: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const enabled = options?.enabled ?? true
    const taskId = task?.id ?? null
    const sessionId = options?.sessionId ?? null
    const liveQueryEnabled = Boolean(
        api
        && taskId
        && enabled
        && options?.sessionActive !== false
        && task?.activeSessionId
        && (!sessionId || task.activeSessionId === sessionId)
    )

    const query = useQuery({
        queryKey: taskId ? queryKeys.taskPreview(taskId) : ['task-preview', 'none'],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!taskId) {
                throw new Error('Task ID missing')
            }
            return await api.getTaskPreview(taskId)
        },
        enabled: liveQueryEnabled,
        retry: false,
        refetchInterval: (currentQuery) => shouldPollPreview(currentQuery.state.data as TaskPreviewResponse | undefined, task) ? 2_000 : false,
    })

    return {
        preview: query.data?.preview ?? null,
        previewRuntime: query.data?.previewRuntime ?? task?.previewRuntime ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load preview state' : null,
        refetch: query.refetch,
    }
}
