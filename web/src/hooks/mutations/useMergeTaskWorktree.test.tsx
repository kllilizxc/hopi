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
        status: 'in_review',
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
        expect(cachedTask?.status).toBe('in_review')
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
        expect(cachedTask?.status).toBe('in_review')
        expect(cachedTask?.finishedAt).toBeNull()
        expect(cachedTask?.mergeRuntime?.status).toBe('running')
        expect(cachedTask?.mergeRuntime?.blockedReason).toBeNull()
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
})
