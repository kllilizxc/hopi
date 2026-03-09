import { act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Task, TaskPreviewResponse } from '@/types/api'
import { useTaskPreview } from '@/hooks/mutations/useTaskPreview'
import { queryKeys } from '@/lib/query-keys'
import { renderWithProviders } from '@/test/renderWithProviders'

type PreviewControls = ReturnType<typeof useTaskPreview>

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Preview runtime task',
        status: 'in_review',
        workflowProfile: 'default',
        activeSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function createPreviewResponse(overrides: Partial<TaskPreviewResponse> = {}): TaskPreviewResponse {
    return {
        preview: {
            active: true,
            status: 'starting',
            taskId: 'task-1',
            sessionId: 'session-1',
            command: 'bun run dev',
            updatedAt: 10,
            logTail: []
        },
        previewRuntime: {
            status: 'running',
            sessionId: 'session-1',
            updatedAt: 10,
            requestedAt: 9,
            startedAt: 10,
            completedAt: null,
            retryCount: 0,
            failureFingerprint: null,
            latestNote: 'Starting preview directly from the task action.',
            blockedReason: null
        },
        ...overrides,
    }
}

function MutationHarness(props: {
    api: ApiClient
    onReady: (controls: PreviewControls) => void
}) {
    const controls = useTaskPreview(props.api)

    useEffect(() => {
        props.onReady(controls)
    }, [controls, props])

    return null
}

describe('useTaskPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('writes kickoff runtime into task and preview caches', async () => {
        const task = createTask()
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const response = createPreviewResponse()
        const api = {
            startTaskPreview: vi.fn(async () => response),
            stopTaskPreview: vi.fn(async () => createPreviewResponse({
                preview: {
                    active: false,
                    status: 'stopped',
                    updatedAt: 20,
                    logTail: []
                },
                previewRuntime: {
                    status: 'stopped',
                    sessionId: 'session-1',
                    updatedAt: 20,
                    requestedAt: 9,
                    startedAt: 10,
                    completedAt: 20,
                    retryCount: 0,
                    failureFingerprint: null,
                    latestNote: 'Preview stopped from the task action.',
                    blockedReason: null
                }
            })),
        } as unknown as ApiClient

        let controls: PreviewControls | null = null
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
            await controls!.startTaskPreview({ taskId: task.id, payload: { mode: 'auto' } })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        const cachedPreview = queryClient.getQueryData<TaskPreviewResponse>(queryKeys.taskPreview(task.id))

        expect(cachedTask?.previewRuntime).toEqual(response.previewRuntime)
        expect(cachedPreview).toEqual(response)
    })

    it('writes stop response back into task and preview caches', async () => {
        const runningRuntime = {
            status: 'running' as const,
            sessionId: 'session-1',
            updatedAt: 10,
            requestedAt: 9,
            startedAt: 10,
            completedAt: null,
            retryCount: 1,
            failureFingerprint: null,
            latestNote: 'Starting preview directly from the task action.',
            blockedReason: null
        }
        const task = createTask({
            previewRuntime: runningRuntime
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })
        queryClient.setQueryData(queryKeys.taskPreview(task.id), createPreviewResponse({
            previewRuntime: runningRuntime
        }))

        const response = createPreviewResponse({
            preview: {
                active: false,
                status: 'stopped',
                updatedAt: 30,
                logTail: ['stopped']
            },
            previewRuntime: {
                status: 'stopped',
                sessionId: 'session-1',
                updatedAt: 30,
                requestedAt: 9,
                startedAt: 10,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Preview stopped from the task action.',
                blockedReason: null
            }
        })
        const api = {
            startTaskPreview: vi.fn(async () => createPreviewResponse()),
            stopTaskPreview: vi.fn(async () => response),
        } as unknown as ApiClient

        let controls: PreviewControls | null = null
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
            await controls!.stopTaskPreview(task.id)
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        const cachedPreview = queryClient.getQueryData<TaskPreviewResponse>(queryKeys.taskPreview(task.id))

        expect(cachedTask?.previewRuntime).toEqual(response.previewRuntime)
        expect(cachedPreview).toEqual(response)
    })
})
