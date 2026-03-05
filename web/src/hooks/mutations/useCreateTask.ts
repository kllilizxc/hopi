import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { PermissionMode, Task } from '@/types/api'
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

type CreateTaskInput = {
    projectId: string
    title: string
    description?: string
    status?: 'planned' | 'in_progress' | 'in_review' | 'blocked' | 'finished'
    priority?: 'high' | 'medium' | 'low'
    workspaceId?: string
    agentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode'
    permissionMode?: PermissionMode
    modelMode?: string
    workflowPhase?: string | null
    sortKey?: number
    attachments?: TaskAttachmentInput[]
    subTasks?: TaskSubTaskInput[]
}

export function useCreateTask(api: ApiClient | null): {
    createTask: (input: CreateTaskInput) => Promise<Task>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: CreateTaskInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createProjectTask(input.projectId, {
                title: input.title,
                description: input.description,
                status: input.status,
                priority: input.priority,
                workspaceId: input.workspaceId,
                agentFlavor: input.agentFlavor,
                permissionMode: input.permissionMode,
                modelMode: input.modelMode,
                workflowPhase: input.workflowPhase,
                sortKey: input.sortKey,
                attachments: input.attachments,
                subTasks: input.subTasks
            })
            return result.task
        },
        onSuccess: (task) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(task.projectId) })
        }
    })

    return {
        createTask: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to create task' : null,
    }
}
