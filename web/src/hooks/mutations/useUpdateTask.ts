import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ModelMode, PermissionMode, Task } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type TaskAttachmentInput = {
    id: string
    filename: string
    mimeType: string
    size: number
    dataUrl: string
    previewUrl?: string
}

type TaskSubTaskInput = {
    id: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    priority: 'high' | 'medium' | 'low'
}

type UpdateTaskInput = {
    taskId: string
    patch: {
        title?: string
        description?: string | null
        status?: 'planned' | 'in_progress' | 'in_review' | 'blocked' | 'finished'
        source?: 'manual'
        priority?: 'high' | 'medium' | 'low' | null
        workspaceId?: string | null
        agentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode' | null
        permissionMode?: PermissionMode | null
        modelMode?: ModelMode | null
        workflowPhase?: string | null
        sortKey?: number | null
        activeSessionId?: string | null
        attachments?: TaskAttachmentInput[]
        subTasks?: TaskSubTaskInput[]
    }
}

export function useUpdateTask(api: ApiClient | null): {
    updateTask: (input: UpdateTaskInput) => Promise<Task>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: UpdateTaskInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.updateTask(input.taskId, input.patch)
            return result.task
        },
        onSuccess: (task) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(task.projectId) })
            void queryClient.setQueryData(queryKeys.task(task.id), { task })
        }
    })

    return {
        updateTask: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to update task' : null,
    }
}
