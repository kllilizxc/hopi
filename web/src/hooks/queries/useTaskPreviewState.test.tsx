import { waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Task, TaskPreviewRuntime, TaskPreviewStatus } from '@/types/api'
import { useTaskPreviewState } from '@/hooks/queries/useTaskPreviewState'
import { renderWithProviders } from '@/test/renderWithProviders'

type PreviewStateControls = {
    preview: TaskPreviewStatus | null
    previewRuntime: TaskPreviewRuntime | null
    isLoading: boolean
    isFetching: boolean
    error: string | null
    refetch: () => Promise<unknown>
}

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Preview rehydrate task',
        status: 'in_review',
        workflowProfile: 'default',
        activeSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function QueryHarness(props: {
    api: ApiClient | null
    task: Task | null
    sessionId?: string | null
    sessionActive?: boolean
    enabled?: boolean
    onReady: (controls: PreviewStateControls) => void
}) {
    const controls = useTaskPreviewState(props.api, props.task, {
        enabled: props.enabled,
        sessionId: props.sessionId,
        sessionActive: props.sessionActive,
    })

    useEffect(() => {
        props.onReady(controls)
    }, [controls, props])

    return null
}

describe('useTaskPreviewState', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('rehydrates durable preview runtime without a live fetch when the session is inactive', async () => {
        const task = createTask({
            previewRuntime: {
                status: 'ready',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 12,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Preview is ready at http://127.0.0.1:3000.',
                blockedReason: null
            }
        })
        const api = {
            getTaskPreview: vi.fn()
        } as unknown as ApiClient

        let controls: PreviewStateControls | null = null
        renderWithProviders(
            <QueryHarness
                api={api}
                task={task}
                sessionId="session-1"
                sessionActive={false}
                onReady={(next) => {
                    controls = next
                }}
            />,
            { queryClient: new QueryClient() }
        )

        await waitFor(() => {
            expect(controls).not.toBeNull()
        })

        if (!controls) {
            throw new Error('Expected preview state controls')
        }
        const state = controls as PreviewStateControls

        expect(api.getTaskPreview).not.toHaveBeenCalled()
        expect(state.preview).toBeNull()
        expect(state.previewRuntime).toEqual(task.previewRuntime)
        expect(state.isLoading).toBe(false)
    })

    it('overrides durable fallback with live preview state when the session is active', async () => {
        const task = createTask({
            previewRuntime: {
                status: 'waiting',
                sessionId: 'session-1',
                updatedAt: 10,
                requestedAt: 9,
                startedAt: 10,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Preview is booting and waiting to report ready.',
                blockedReason: null
            }
        })
        const response = {
            preview: {
                active: true,
                status: 'ready' as const,
                taskId: task.id,
                sessionId: 'session-1',
                url: 'http://127.0.0.1:3000',
                updatedAt: 30,
                logTail: ['ready']
            },
            previewRuntime: {
                status: 'ready' as const,
                sessionId: 'session-1',
                updatedAt: 30,
                requestedAt: 9,
                startedAt: 10,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Preview is ready at http://127.0.0.1:3000.',
                blockedReason: null
            }
        }
        const api = {
            getTaskPreview: vi.fn(async () => response)
        } as unknown as ApiClient

        let controls: PreviewStateControls | null = null
        renderWithProviders(
            <QueryHarness
                api={api}
                task={task}
                sessionId="session-1"
                sessionActive
                onReady={(next) => {
                    controls = next
                }}
            />,
            { queryClient: new QueryClient() }
        )

        await waitFor(() => {
            expect(api.getTaskPreview).toHaveBeenCalledWith(task.id)
            expect(controls?.preview).toEqual(response.preview)
            expect(controls?.previewRuntime).toEqual(response.previewRuntime)
        })
    })
})
