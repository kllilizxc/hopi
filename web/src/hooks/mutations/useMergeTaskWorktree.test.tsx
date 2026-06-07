import { act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Task } from '@/types/api'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { queryKeys } from '@/lib/query-keys'
import { renderWithProviders } from '@/test/renderWithProviders'

type MergeControls = ReturnType<typeof useMergeTaskWorktree>

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Merge runtime task',
        status: 'review',
        workflowProfile: 'default',
        activeSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function MutationHarness(props: {
    api: ApiClient
    onReady: (controls: MergeControls) => void
}) {
    const controls = useMergeTaskWorktree(props.api)

    useEffect(() => {
        props.onReady(controls)
    }, [controls, props])

    return null
}

describe('useMergeTaskWorktree', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('keeps kickoff responses in review while caching durable running runtime', async () => {
        const task = createTask()
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.status).toBe('review')
        expect(cachedTask?.finishedAt).toBeUndefined()
        expect(cachedTask?.mergeRuntime?.status).toBe('running')
        expect(cachedTask?.mergeRuntime?.latestNote).toBe('Merge requested in the linked session.')
    })

    it('returns a merge-blocked task to review while a retry is running', async () => {
        const task = createTask({
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 2,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Auto-merge blocked: conflicts persisted.',
                blockedReason: 'conflicts persisted'
            },
            finishedAt: null
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.status).toBe('review')
        expect(cachedTask?.finishedAt).toBeNull()
        expect(cachedTask?.mergeRuntime?.status).toBe('running')
        expect(cachedTask?.mergeRuntime?.blockedReason).toBeNull()
        expect(cachedTask?.blockedReason).toBeNull()
        expect(cachedTask?.blockedSource).toBeNull()
    })

    it('keeps canonical in_review while retrying a merge-blocked task', async () => {
        const task = createTask({
            goalId: 'goal-1',
            status: 'in_review',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Platform merge blocked on verification.',
                blockedReason: 'verification failed'
            },
            finishedAt: null
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.status).toBe('in_review')
        expect(cachedTask?.finishedAt).toBeNull()
        expect(cachedTask?.mergeRuntime?.status).toBe('running')
        expect(cachedTask?.mergeRuntime?.blockedReason).toBeNull()
        expect(cachedTask?.blockedReason).toBeNull()
        expect(cachedTask?.blockedSource).toBeNull()
    })

    it('recovers a legacy blocked goal task into canonical in_review while merge retry starts', async () => {
        const task = createTask({
            goalId: 'goal-1',
            status: 'blocked',
            blockedSource: 'merge',
            blockedReason: 'merge conflict',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Auto-merge blocked: conflicts persisted.',
                blockedReason: 'conflicts persisted'
            },
            finishedAt: null
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.status).toBe('in_review')
        expect(cachedTask?.finishedAt).toBeNull()
        expect(cachedTask?.mergeRuntime?.status).toBe('running')
        expect(cachedTask?.blockedReason).toBeNull()
        expect(cachedTask?.blockedSource).toBeNull()
    })

    it('marks a legacy blocked merge-lane task done when merge succeeds', async () => {
        const task = createTask({
            goalId: 'goal-1',
            status: 'blocked',
            blockedSource: 'merge',
            blockedReason: 'merge conflict',
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Merge requested in the linked session.',
                blockedReason: null
            },
            finishedAt: null
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const mergedAt = Date.now()
        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: 'abc123',
                skippedReason: null,
                mergedAt,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.status).toBe('done')
        expect(cachedTask?.finishedAt).toBe(mergedAt)
        expect(cachedTask?.mergeRuntime?.status).toBe('succeeded')
        expect(cachedTask?.blockedReason).toBeNull()
        expect(cachedTask?.blockedSource).toBeNull()
    })

    it('prefers the docs-projected task returned by merge responses when updating caches', async () => {
        const task = createTask({
            goalId: 'goal-1',
            goalTodoRef: 'goal-ref-1',
            status: 'blocked',
            blockedSource: 'merge',
            blockedReason: 'stale merge blocker',
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge-conflict',
                latestNote: 'Merge requested in the linked session.',
                blockedReason: null
            },
            finishedAt: null
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const projectedTask: Task = {
            ...task,
            status: 'done',
            tag: 'done',
            finishedAt: 100,
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            worktreeMergeCommit: 'abc123',
            worktreeMergedAt: 100,
            mergeRuntime: {
                status: 'succeeded',
                sessionId: 'session-1',
                updatedAt: 100,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 100,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Merge completed in the linked session.',
                blockedReason: null
            }
        }
        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: 'abc123',
                skippedReason: null,
                mergedAt: 100,
                task: projectedTask,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: null,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.mergeTaskWorktree({ taskId: task.id })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask).toEqual(projectedTask)
    })

    it('writes canceled runtime back into cached task state', async () => {
        const task = createTask({
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-1',
                updatedAt: 2,
                requestedAt: 1,
                startedAt: 2,
                completedAt: null,
                retryCount: 0,
                latestNote: 'Merge requested in the linked session.',
                blockedReason: null,
            }
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const canceledRuntime = {
            status: 'canceled' as const,
            sessionId: 'session-1',
            updatedAt: 5,
            requestedAt: 1,
            startedAt: 2,
            completedAt: 5,
            retryCount: 0,
            latestNote: 'Merge canceled from the task action.',
            blockedReason: null,
        }
        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                mergeRuntime: canceledRuntime,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.cancelTaskWorktreeMerge(task.id)
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask?.mergeRuntime).toEqual(canceledRuntime)
    })

    it('prefers the docs-projected task returned by merge cancel responses when updating caches', async () => {
        const task = createTask({
            goalId: 'goal-1',
            goalTodoRef: 'goal-ref-1',
            status: 'review',
            tag: 'merging',
            mergeRuntime: {
                status: 'running',
                sessionId: 'session-1',
                updatedAt: 2,
                requestedAt: 1,
                startedAt: 2,
                completedAt: null,
                retryCount: 0,
                latestNote: 'Merge requested in the linked session.',
                blockedReason: null,
            }
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const projectedTask: Task = {
            ...task,
            status: 'in_review',
            tag: 'in_review',
            mergeRuntime: {
                status: 'canceled',
                sessionId: 'session-1',
                updatedAt: 5,
                requestedAt: 1,
                startedAt: 2,
                completedAt: 5,
                retryCount: 0,
                latestNote: 'Merge canceled from the task action.',
                blockedReason: null,
            }
        }
        const api = {
            mergeTaskWorktree: vi.fn(async () => ({
                ok: true,
                commitHash: null,
                skippedReason: 'running' as const,
                mergedAt: null,
                autoResolved: null,
            })),
            cancelTaskWorktreeMerge: vi.fn(async () => ({
                ok: true,
                canceled: true,
                task: projectedTask,
                mergeRuntime: projectedTask.mergeRuntime,
            })),
        } as unknown as ApiClient

        let controls: MergeControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        await act(async () => {
            await controls!.cancelTaskWorktreeMerge(task.id)
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        expect(cachedTask).toEqual(projectedTask)
    })
})
