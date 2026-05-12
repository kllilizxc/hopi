import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ModelMode, PermissionMode, Task, TaskStatus, TasksResponse } from '@/types/api'
import { createOptimisticTaskId } from '@/lib/optimistic-task'
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
    goalId?: string | null
    contract?: string | null
    handoff?: string | null
    evidence?: string | null
    status?: TaskStatus
    tag?: string | null
    priority?: 'high' | 'medium' | 'low'
    workspaceId?: string
    agentFlavor?: 'claude' | 'codex' | 'gemini' | 'opencode'
    permissionMode?: PermissionMode
    model?: string
    modelMode?: ModelMode
    workflowProfile: string
    workflowPhase?: string | null
    sortKey?: number
    attachments?: TaskAttachmentInput[]
    subTasks?: TaskSubTaskInput[]
}

type CreateTaskMutationContext = {
    projectId: string
    temporaryTaskId: string
    tasksKey: ReturnType<typeof queryKeys.tasks>
}

function upsertTask(tasks: Task[], task: Task): Task[] {
    const existingIndex = tasks.findIndex((entry) => entry.id === task.id)
    if (existingIndex === -1) {
        return [task, ...tasks]
    }

    const next = [...tasks]
    next[existingIndex] = task
    return next
}

function removeTask(tasks: Task[], taskId: string): Task[] {
    return tasks.filter((task) => task.id !== taskId)
}

function replaceTask(tasks: Task[], taskId: string, nextTask: Task): Task[] {
    const withoutCurrent = removeTask(tasks, taskId)
    return upsertTask(withoutCurrent, nextTask)
}

function buildOptimisticTask(input: CreateTaskInput, temporaryTaskId: string): Task {
    const now = Date.now()
    return {
        id: temporaryTaskId,
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'planning',
        tag: input.tag ?? null,
        priority: input.priority ?? null,
        sortKey: input.sortKey ?? now,
        activeSessionId: null,
        workspaceId: input.workspaceId ?? null,
        agentFlavor: input.agentFlavor ?? null,
        permissionMode: input.permissionMode ?? null,
        model: input.model ?? null,
        modelMode: input.modelMode ?? null,
        attachments: input.attachments ?? null,
        source: 'manual',
        sourceTaskId: null,
        goalId: input.goalId ?? null,
        contract: input.contract ?? null,
        handoff: input.handoff ?? null,
        evidence: input.evidence ?? null,
        workflowProfile: input.workflowProfile,
        workflowPhase: input.workflowPhase ?? null,
        subTasks: input.subTasks ?? null,
        subTasksUpdatedAt: input.subTasks ? now : null,
        worktreeMergedAt: null,
        worktreeMergeCommit: null,
        mergedDiffSnapshot: null,
        mergeRuntime: null,
        previewRuntime: null,
        initRuntime: null,
        createdAt: now,
        updatedAt: now,
        finishedAt: input.status === 'finished' || input.status === 'done' ? now : null,
        archivedAt: null,
    }
}

export function useCreateTask(api: ApiClient | null): {
    createTask: (input: CreateTaskInput) => Promise<Task>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation<Task, Error, CreateTaskInput, CreateTaskMutationContext>({
        mutationFn: async (input: CreateTaskInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createProjectTask(input.projectId, {
                title: input.title,
                description: input.description,
                status: input.status,
                tag: input.tag,
                priority: input.priority,
                workspaceId: input.workspaceId,
                agentFlavor: input.agentFlavor,
                permissionMode: input.permissionMode,
                model: input.model,
                modelMode: input.modelMode,
                workflowProfile: input.workflowProfile,
                workflowPhase: input.workflowPhase,
                sortKey: input.sortKey,
                attachments: input.attachments,
                goalId: input.goalId,
                contract: input.contract,
                handoff: input.handoff,
                evidence: input.evidence,
                subTasks: input.subTasks
            })
            return result.task
        },
        onMutate: async (input) => {
            const temporaryTaskId = createOptimisticTaskId()
            const optimisticTask = buildOptimisticTask(input, temporaryTaskId)
            const tasksKey = queryKeys.tasks(input.projectId, input.goalId ?? null)

            await queryClient.cancelQueries({ queryKey: queryKeys.tasksRoot(input.projectId) })

            queryClient.setQueryData<TasksResponse>(tasksKey, (current) => ({
                tasks: upsertTask(current?.tasks ?? [], optimisticTask)
            }))

            return {
                projectId: input.projectId,
                temporaryTaskId,
                tasksKey
            }
        },
        onSuccess: (task, _input, context) => {
            const projectId = context?.projectId ?? task.projectId
            const temporaryTaskId = context?.temporaryTaskId ?? null
            const tasksKey = context?.tasksKey ?? queryKeys.tasks(projectId, task.goalId ?? null)

            queryClient.setQueryData<TasksResponse>(tasksKey, (current) => {
                const tasks = current?.tasks ?? []
                return {
                    tasks: temporaryTaskId
                        ? replaceTask(tasks, temporaryTaskId, task)
                        : upsertTask(tasks, task)
                }
            })
            queryClient.setQueryData(queryKeys.task(task.id), { task })
            if (temporaryTaskId) {
                void queryClient.removeQueries({ queryKey: queryKeys.task(temporaryTaskId), exact: true })
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(projectId) })
        },
        onError: (_error, input, context) => {
            if (!context?.temporaryTaskId) {
                return
            }

            const tasksKey = context.tasksKey ?? queryKeys.tasks(input.projectId, input.goalId ?? null)
            queryClient.setQueryData<TasksResponse>(tasksKey, (current) => {
                if (!current?.tasks) {
                    return current
                }
                return {
                    ...current,
                    tasks: removeTask(current.tasks, context.temporaryTaskId)
                }
            })
        }
    })

    return {
        createTask: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Failed to create task' : null,
    }
}
