import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Goal } from '@/types/api'
import { useCreateGoal } from './useCreateGoal'

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
        status: overrides.status ?? 'planning',
        successCriteria: overrides.successCriteria ?? null,
        autopilotEnabled: overrides.autopilotEnabled ?? false,
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

describe('useCreateGoal', () => {
    it('invalidates goals and project task caches after creating a goal', async () => {
        const queryClient = createTestQueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const goal = createGoal()
        const api = {
            createProjectGoal: vi.fn(async () => ({ goal }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useCreateGoal(api), {
            wrapper: createWrapper(queryClient)
        })

        await act(async () => {
            await result.current.createGoal({
                projectId: goal.projectId,
                title: goal.title,
                clientRequestId: 'create-goal-request-1'
            })
        })

        await waitFor(() => {
            expect(api.createProjectGoal).toHaveBeenCalledWith(goal.projectId, expect.objectContaining({
                title: goal.title,
                clientRequestId: 'create-goal-request-1'
            }))
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goals(goal.projectId) })
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot(goal.projectId) })
        })
    })
})
