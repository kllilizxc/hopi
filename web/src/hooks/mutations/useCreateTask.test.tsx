import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Task, TasksResponse } from '@/types/api'
import { useCreateTask } from './useCreateTask'

function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
}

function createWrapper(queryClient: QueryClient) {
    return function Wrapper(props: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {props.children}
            </QueryClientProvider>
        )
    }
}

function createTask(overrides: Partial<Task> = {}): Task {
    const now = 1_700_000_000_000
    return {
        id: overrides.id ?? 'task-existing',
        projectId: overrides.projectId ?? 'project-1',
        title: overrides.title ?? 'Existing task',
        description: overrides.description ?? null,
        status: overrides.status ?? 'planned',
        priority: overrides.priority ?? null,
        sortKey: overrides.sortKey ?? now,
        activeSessionId: overrides.activeSessionId ?? null,
        workspaceId: overrides.workspaceId ?? null,
        agentFlavor: overrides.agentFlavor ?? null,
        permissionMode: overrides.permissionMode ?? null,
        model: overrides.model ?? null,
        modelMode: overrides.modelMode ?? null,
        attachments: overrides.attachments ?? null,
        source: overrides.source ?? 'manual',
        sourceTaskId: overrides.sourceTaskId ?? null,
        workflowProfile: overrides.workflowProfile ?? 'default',
        workflowPhase: overrides.workflowPhase ?? null,
        subTasks: overrides.subTasks ?? null,
        subTasksUpdatedAt: overrides.subTasksUpdatedAt ?? null,
        worktreeMergedAt: overrides.worktreeMergedAt ?? null,
        worktreeMergeCommit: overrides.worktreeMergeCommit ?? null,
        mergedDiffSnapshot: overrides.mergedDiffSnapshot ?? null,
        mergeRuntime: overrides.mergeRuntime ?? null,
        previewRuntime: overrides.previewRuntime ?? null,
        initRuntime: overrides.initRuntime ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        finishedAt: overrides.finishedAt ?? null,
        archivedAt: overrides.archivedAt ?? null,
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useCreateTask', () => {
    it('adds a temporary task immediately and replaces it after success', async () => {
        const queryClient = createTestQueryClient()
        const existingTask = createTask()
        queryClient.setQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId), { tasks: [existingTask] })

        let resolveRequest: ((value: { task: Task }) => void) | null = null
        const api = {
            createProjectTask: vi.fn(() => new Promise<{ task: Task }>((resolve) => {
                resolveRequest = resolve
            }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useCreateTask(api), {
            wrapper: createWrapper(queryClient)
        })

        const input = {
            projectId: existingTask.projectId,
            title: 'New task',
            workflowProfile: 'default' as const,
            sortKey: (existingTask.sortKey ?? 0) + 1
        }

        let requestPromise: Promise<Task>
        await act(async () => {
            requestPromise = result.current.createTask(input)
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId))
            expect(cached?.tasks).toHaveLength(2)
            expect(cached?.tasks.some((task) => task.id.startsWith('temp:') && task.title === 'New task')).toBe(true)
        })

        const serverTask = createTask({
            id: 'task-created',
            projectId: existingTask.projectId,
            title: 'New task',
            sortKey: input.sortKey,
            createdAt: existingTask.createdAt + 10,
            updatedAt: existingTask.updatedAt + 10
        })

        if (!resolveRequest) {
            throw new Error('expected pending createProjectTask request')
        }
        const finishRequest = resolveRequest as (value: { task: Task }) => void
        finishRequest({ task: serverTask })
        await act(async () => {
            await requestPromise!
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId))
            expect(cached?.tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['task-existing', 'task-created']))
            expect(cached?.tasks.some((task) => task.id.startsWith('temp:'))).toBe(false)
            expect(queryClient.getQueryData<{ task: Task }>(queryKeys.task(serverTask.id))?.task).toEqual(serverTask)
        })
    })

    it('removes the temporary task if creation fails', async () => {
        const queryClient = createTestQueryClient()
        const existingTask = createTask()
        queryClient.setQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId), { tasks: [existingTask] })

        let rejectRequest: ((error?: unknown) => void) | null = null
        const api = {
            createProjectTask: vi.fn(() => new Promise<{ task: Task }>((_resolve, reject) => {
                rejectRequest = reject
            }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useCreateTask(api), {
            wrapper: createWrapper(queryClient)
        })

        const input = {
            projectId: existingTask.projectId,
            title: 'Will fail',
            workflowProfile: 'default' as const,
            sortKey: (existingTask.sortKey ?? 0) + 1
        }

        let requestPromise: Promise<Task>
        await act(async () => {
            requestPromise = result.current.createTask(input)
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId))
            expect(cached?.tasks).toHaveLength(2)
        })

        if (!rejectRequest) {
            throw new Error('expected pending createProjectTask request')
        }
        const failRequest = rejectRequest as (error?: unknown) => void
        failRequest(new Error('boom'))
        await act(async () => {
            await expect(requestPromise!).rejects.toThrow('boom')
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(queryKeys.tasks(existingTask.projectId))
            expect(cached?.tasks).toEqual([existingTask])
        })
    })
})
