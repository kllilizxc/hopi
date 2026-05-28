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
    it('loads todo sections for a selected goal', async () => {
        const queryClient = createTestQueryClient()
        const response = {
            exists: true,
            path: '/repo/.hopi/docs/goals/goal-1/todo.yml',
            rawYaml: 'version: 1\ngoals: []\n',
            parseError: null,
            updatedAt: 1_700_000_000_000,
            sections: [
                {
                    kind: 'ready',
                    title: 'Implement first slice',
                    body: 'Acceptance details',
                    taskId: null,
                    todoRef: 'first-slice'
                }
            ]
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
