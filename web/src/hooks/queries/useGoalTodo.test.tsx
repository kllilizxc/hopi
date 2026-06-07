import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useGoalTodo } from './useGoalTodo'

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

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useGoalTodo', () => {
    it('loads the canonical todo board for a selected goal', async () => {
        const queryClient = createTestQueryClient()
        const response = {
            board: {
                goal: {
                    goalKey: 'goal-1',
                    goalId: 'goal-1',
                    title: 'Goal 1'
                },
                items: [{
                    ref: 'first-slice',
                    kind: 'engineering',
                    status: 'planned',
                    title: 'Implement first slice',
                    description: 'Acceptance details',
                    acceptanceCriteria: [],
                    dependencyTaskList: [],
                    blockedBy: [],
                    taskId: null
                }]
            }
        }
        const api = {
            getGoalTodo: vi.fn(async () => response)
        } as unknown as ApiClient

        const { result } = renderHook(() => useGoalTodo(api, 'project-1', 'goal-1'), {
            wrapper: createWrapper(queryClient)
        })

        await waitFor(() => {
            expect(result.current.todo).toEqual(response)
        })
        expect(api.getGoalTodo).toHaveBeenCalledWith('project-1', 'goal-1')
    })
})
