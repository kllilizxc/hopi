import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { GoalDecisionTopic } from '@/types/api'
import { useResolveGoalDecisionTopic } from './useResolveGoalDecisionTopic'

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

function createTopic(overrides: Partial<GoalDecisionTopic> = {}): GoalDecisionTopic {
    const now = 1_700_000_000_000
    return {
        id: overrides.id ?? 'topic-1',
        projectId: overrides.projectId ?? 'project-1',
        goalId: overrides.goalId ?? 'goal-1',
        taskId: overrides.taskId ?? 'task-1',
        title: overrides.title ?? 'Clarify rollout',
        body: overrides.body ?? 'Should deployment require approval?',
        status: overrides.status ?? 'resolved',
        blocking: overrides.blocking ?? true,
        resolution: overrides.resolution ?? 'Require approval.',
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useResolveGoalDecisionTopic', () => {
    it('resolves a topic and invalidates goal topic and task caches', async () => {
        const queryClient = createTestQueryClient()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        const topic = createTopic()
        const api = {
            resolveGoalDecisionTopic: vi.fn(async () => ({ topic }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useResolveGoalDecisionTopic(api), {
            wrapper: createWrapper(queryClient)
        })

        await act(async () => {
            await result.current.resolveTopic({
                topicId: topic.id,
                projectId: topic.projectId,
                goalId: topic.goalId,
                resolution: topic.resolution ?? ''
            })
        })

        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goalTopics(topic.goalId) })
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goals(topic.projectId) })
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasksRoot(topic.projectId) })
        })
        expect(api.resolveGoalDecisionTopic).toHaveBeenCalledWith(topic.id, {
            resolution: topic.resolution
        })
    })
})
