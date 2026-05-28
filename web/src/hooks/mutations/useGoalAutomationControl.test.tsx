import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Goal } from '@/types/api'
import { useGoalAutomationControl } from './useGoalAutomationControl'

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

function createGoal(overrides: Partial<Goal> = {}): Goal {
    const now = 1_700_000_000_000
    return {
        id: overrides.id ?? 'goal-1',
        projectId: overrides.projectId ?? 'project-1',
        namespace: overrides.namespace ?? 'default',
        goalKey: overrides.goalKey ?? 'ship-goal-autopilot',
        title: overrides.title ?? 'Ship Goal Autopilot',
        description: overrides.description ?? null,
        status: overrides.status ?? 'active',
        successCriteria: overrides.successCriteria ?? null,
        autopilotEnabled: overrides.autopilotEnabled ?? true,
        automationPausedAt: overrides.automationPausedAt ?? null,
        deployRequiresApproval: overrides.deployRequiresApproval ?? true,
        currentFocus: overrides.currentFocus ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        archivedAt: overrides.archivedAt ?? null
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useGoalAutomationControl', () => {
    it('updates goal and project task caches after pausing and resuming automation', async () => {
        const queryClient = createTestQueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const paused = createGoal({ automationPausedAt: 1_700_000_000_100 })
        const resumed = createGoal({ automationPausedAt: null })
        const api = {
            pauseGoalAutomation: vi.fn(async () => ({ goal: paused })),
            resumeGoalAutomation: vi.fn(async () => ({ goal: resumed }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useGoalAutomationControl(api), {
            wrapper: createWrapper(queryClient)
        })

        await act(async () => {
            await result.current.pauseGoalAutomation(paused.id)
        })
        await act(async () => {
            await result.current.resumeGoalAutomation(resumed.id)
        })

        await waitFor(() => {
            expect(api.pauseGoalAutomation).toHaveBeenCalledWith(paused.id)
            expect(api.resumeGoalAutomation).toHaveBeenCalledWith(resumed.id)
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goals(resumed.projectId) })
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot(resumed.projectId) })
        })
    })

    it('marks a goal done by updating status then pausing automation', async () => {
        const queryClient = createTestQueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const done = createGoal({ status: 'done', automationPausedAt: 1_700_000_000_100 })
        const api = {
            updateGoal: vi.fn(async () => ({ goal: createGoal({ status: 'done' }) })),
            pauseGoalAutomation: vi.fn(async () => ({ goal: done }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useGoalAutomationControl(api), {
            wrapper: createWrapper(queryClient)
        })

        await act(async () => {
            await result.current.markGoalDone(done.id)
        })

        expect(api.updateGoal).toHaveBeenCalledWith(done.id, { status: 'done' })
        expect(api.pauseGoalAutomation).toHaveBeenCalledWith(done.id)
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goals(done.projectId) })
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot(done.projectId) })
    })

    it('reopens a done goal by updating status then resuming automation', async () => {
        const queryClient = createTestQueryClient()
        const active = createGoal({ status: 'active', automationPausedAt: null })
        const api = {
            updateGoal: vi.fn(async () => ({ goal: createGoal({ status: 'active' }) })),
            resumeGoalAutomation: vi.fn(async () => ({ goal: active }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useGoalAutomationControl(api), {
            wrapper: createWrapper(queryClient)
        })

        await act(async () => {
            await result.current.reopenGoal(active.id)
        })

        expect(api.updateGoal).toHaveBeenCalledWith(active.id, { status: 'active' })
        expect(api.resumeGoalAutomation).toHaveBeenCalledWith(active.id)
    })
})
