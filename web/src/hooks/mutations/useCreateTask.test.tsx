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
        goalCanonicalStatus: overrides.goalCanonicalStatus ?? null,
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
        goalId: overrides.goalId ?? null,
        contract: overrides.contract ?? null,
        handoff: overrides.handoff ?? null,
        evidence: overrides.evidence ?? null,
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

    it('optimistically updates the goal-scoped task cache and forwards goal payload fields', async () => {
        const queryClient = createTestQueryClient()
        const existingTask = createTask()
        const goalScopedKey = queryKeys.tasks(existingTask.projectId, 'goal-1')

        expect(goalScopedKey).toEqual(['tasks', existingTask.projectId, 'goal-1'])
        queryClient.setQueryData<TasksResponse>(goalScopedKey, { tasks: [existingTask] })

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
            title: 'Goal task',
            workflowProfile: 'default' as const,
            goalId: 'goal-1',
            contract: 'Ship the first slice'
        }

        let requestPromise: Promise<Task>
        await act(async () => {
            requestPromise = result.current.createTask(input)
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(goalScopedKey)
            const optimisticTask = cached?.tasks.find((task) => task.id.startsWith('temp:'))
            expect(optimisticTask?.goalId).toBe('goal-1')
            expect(optimisticTask?.goalCanonicalStatus).toBe('planned')
            expect(optimisticTask?.contract).toBe('Ship the first slice')
        })

        expect(api.createProjectTask).toHaveBeenCalledWith(existingTask.projectId, expect.objectContaining({
            goalId: 'goal-1',
            contract: 'Ship the first slice'
        }))

        if (!resolveRequest) {
            throw new Error('expected pending createProjectTask request')
        }
        const serverTask = createTask({
            id: 'task-goal-created',
            projectId: existingTask.projectId,
            title: 'Goal task',
            goalId: 'goal-1',
            contract: 'Ship the first slice'
        })
        const finishRequest = resolveRequest as (value: { task: Task }) => void
        finishRequest({ task: serverTask })
        await act(async () => {
            await requestPromise!
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(goalScopedKey)
            expect(cached?.tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['task-existing', 'task-goal-created']))
            expect(cached?.tasks.some((task) => task.id.startsWith('temp:'))).toBe(false)
        })
    })

    it('derives canonical merge lane for optimistic goal-scoped review tasks', async () => {
        const queryClient = createTestQueryClient()
        const existingTask = createTask()
        const goalScopedKey = queryKeys.tasks(existingTask.projectId, 'goal-1')
        queryClient.setQueryData<TasksResponse>(goalScopedKey, { tasks: [existingTask] })

        let resolveRequest: ((value: { task: Task }) => void) | null = null
        const api = {
            createProjectTask: vi.fn(() => new Promise<{ task: Task }>((resolve) => {
                resolveRequest = resolve
            }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useCreateTask(api), {
            wrapper: createWrapper(queryClient)
        })

        let requestPromise: Promise<Task>
        await act(async () => {
            requestPromise = result.current.createTask({
                projectId: existingTask.projectId,
                title: 'Merge review task',
                workflowProfile: 'default',
                goalId: 'goal-1',
                status: 'review',
                tag: 'merging'
            })
        })

        await waitFor(() => {
            const cached = queryClient.getQueryData<TasksResponse>(goalScopedKey)
            const optimisticTask = cached?.tasks.find((task) => task.id.startsWith('temp:'))
            expect(optimisticTask?.goalCanonicalStatus).toBe('merging')
        })

        if (!resolveRequest) {
            throw new Error('expected pending createProjectTask request')
        }
        ;(resolveRequest as (value: { task: Task }) => void)({
            task: createTask({
                id: 'task-goal-merge',
                projectId: existingTask.projectId,
                goalId: 'goal-1',
                status: 'review',
                goalCanonicalStatus: 'merging',
                tag: 'merging',
                title: 'Merge review task'
            })
        })

        await act(async () => {
            await requestPromise!
        })
    })
})
