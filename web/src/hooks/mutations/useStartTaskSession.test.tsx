import { act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Task, TaskStartSessionResponse } from '@/types/api'
import { useStartTaskSession } from '@/hooks/mutations/useStartTaskSession'
import { queryKeys } from '@/lib/query-keys'
import { renderWithProviders } from '@/test/renderWithProviders'

type StartControls = ReturnType<typeof useStartTaskSession>

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Init runtime task',
        status: 'planned',
        workflowProfile: 'default',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function createStartResponse(overrides: Partial<TaskStartSessionResponse> = {}): TaskStartSessionResponse {
    return {
        sessionId: 'session-2',
        initRecoveryAttempted: true,
        task: createTask({
            status: 'in_progress',
            activeSessionId: 'session-2',
            initRuntime: {
                status: 'blocked',
                sessionId: 'session-2',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'init:abc123',
                latestNote: 'Same blocker repeated with no repo progress: npm install failed. User must fix the dependency manually before retry.',
                blockedReason: 'npm install failed'
            }
        }),
        ...overrides,
    }
}

function MutationHarness(props: {
    api: ApiClient
    onReady: (controls: StartControls) => void
}) {
    const controls = useStartTaskSession(props.api)

    useEffect(() => {
        props.onReady(controls)
    }, [controls, props])

    return null
}

describe('useStartTaskSession', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('writes durable init runtime into task caches on start-session success', async () => {
        const task = createTask({
            activeSessionId: 'session-1'
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })
        queryClient.setQueryData(queryKeys.tasks(task.projectId), { tasks: [task] })

        const response = createStartResponse()
        const api = {
            startTaskSession: vi.fn(async () => response)
        } as unknown as ApiClient

        let controls: StartControls | null = null
        renderWithProviders(
            <MutationHarness api={api} onReady={(next) => {
                controls = next
            }} />,
            { queryClient }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        let result: TaskStartSessionResponse | null = null
        await act(async () => {
            result = await controls!.startTaskSession({
                taskId: task.id,
                projectId: task.projectId,
                payload: { workspaceId: 'workspace-1' }
            })
        })

        const cachedTask = queryClient.getQueryData<{ task: Task }>(queryKeys.task(task.id))?.task
        const cachedTasks = queryClient.getQueryData<{ tasks: Task[] }>(queryKeys.tasks(task.projectId))?.tasks ?? []

        expect(result).toEqual(response)
        expect(cachedTask).toEqual(response.task)
        expect(cachedTasks[0]).toEqual(response.task)
        expect(cachedTask?.initRuntime?.status).toBe('blocked')
        expect(cachedTask?.initRuntime?.latestNote).toContain('Same blocker repeated')
    })

    it('invalidates both previous and current session caches after relinked start', async () => {
        const task = createTask({
            activeSessionId: 'session-1'
        })
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        })
        queryClient.setQueryData(queryKeys.task(task.id), { task })

        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const response = createStartResponse()
        const api = {
            startTaskSession: vi.fn(async () => response)
        } as unknown as ApiClient

        let controls: StartControls | null = null
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
            await controls!.startTaskSession({
                taskId: task.id,
                projectId: task.projectId
            })
        })

        expect(invalidateSpy.mock.calls).toEqual(expect.arrayContaining([
            [{ queryKey: queryKeys.session('session-1') }],
            [{ queryKey: queryKeys.messages('session-1') }],
            [{ queryKey: queryKeys.session('session-2') }],
            [{ queryKey: queryKeys.messages('session-2') }],
        ]))
    })
})
