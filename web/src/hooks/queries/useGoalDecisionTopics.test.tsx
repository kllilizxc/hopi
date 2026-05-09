import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { GoalDecisionTopic } from '@/types/api'
import { useGoalDecisionTopics } from './useGoalDecisionTopics'

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
        status: overrides.status ?? 'waiting',
        blocking: overrides.blocking ?? true,
        resolution: overrides.resolution ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useGoalDecisionTopics', () => {
    it('loads decision topics for a goal', async () => {
        const queryClient = createTestQueryClient()
        const topic = createTopic()
        const api = {
            listGoalDecisionTopics: vi.fn(async () => ({ topics: [topic] }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useGoalDecisionTopics(api, topic.goalId), {
            wrapper: createWrapper(queryClient)
        })

        await waitFor(() => {
            expect(result.current.topics).toEqual([topic])
        })
        expect(api.listGoalDecisionTopics).toHaveBeenCalledWith(topic.goalId)
    })
})
