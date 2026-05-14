import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { clearMessageWindow, getMessageWindowState } from '@/lib/message-window-store'
import { useSendMessage } from './useSendMessage'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTelegram: false,
        isTouch: false,
        haptic: {
            impact: vi.fn(),
            notification: vi.fn(),
            selection: vi.fn(),
        },
    }),
}))

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })
    return function Wrapper(props: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {props.children}
            </QueryClientProvider>
        )
    }
}

afterEach(() => {
    clearMessageWindow('assistant-session')
    vi.restoreAllMocks()
})

describe('useSendMessage', () => {
    it('shows the user message while session resolution is still pending', async () => {
        let resolveSession: ((sessionId: string) => void) | null = null
        const api = {
            sendMessage: vi.fn(async () => undefined),
        } as unknown as ApiClient

        const { result } = renderHook(() => useSendMessage(api, 'assistant-session', {
            resolveSessionId: () => new Promise<string>((resolve) => {
                resolveSession = resolve
            }),
        }), { wrapper: createWrapper() })

        await act(async () => {
            result.current.sendMessage('解决了')
        })

        const pendingState = getMessageWindowState('assistant-session')
        expect(pendingState.messages).toHaveLength(1)
        expect(pendingState.messages[0]?.status).toBe('sending')
        expect(api.sendMessage).not.toHaveBeenCalled()

        await act(async () => {
            resolveSession?.('assistant-session')
        })

        await waitFor(() => {
            expect(api.sendMessage).toHaveBeenCalledWith(
                'assistant-session',
                '解决了',
                expect.stringMatching(/^local[-:]/),
                undefined
            )
        })
    })

    it('notifies callers when resolution activates the same session id', async () => {
        const onSessionResolved = vi.fn()
        const api = {
            sendMessage: vi.fn(async () => undefined),
        } as unknown as ApiClient

        const { result } = renderHook(() => useSendMessage(api, 'assistant-session', {
            resolveSessionId: async () => ({ sessionId: 'assistant-session', notify: true }),
            onSessionResolved,
        }), { wrapper: createWrapper() })

        await act(async () => {
            result.current.sendMessage('继续')
        })

        await waitFor(() => {
            expect(api.sendMessage).toHaveBeenCalled()
        })
        expect(onSessionResolved).toHaveBeenCalledWith('assistant-session')
    })

    it('skips the normal send when session resolution already sent the message', async () => {
        const onSessionResolved = vi.fn()
        const resolveSessionId = vi.fn(async (_sessionId: string, message: { text: string; localId: string }) => {
            expect(message.text).toBe('啥意思')
            expect(message.localId).toMatch(/^local[-:]/)
            return { sessionId: 'assistant-session', notify: true, handled: true }
        })
        const api = {
            sendMessage: vi.fn(async () => undefined),
        } as unknown as ApiClient

        const { result } = renderHook(() => useSendMessage(api, 'assistant-session', {
            resolveSessionId,
            onSessionResolved,
        }), { wrapper: createWrapper() })

        await act(async () => {
            result.current.sendMessage('啥意思')
        })

        await waitFor(() => {
            expect(resolveSessionId).toHaveBeenCalled()
        })
        expect(api.sendMessage).not.toHaveBeenCalled()
        expect(onSessionResolved).toHaveBeenCalledWith('assistant-session')
        const state = getMessageWindowState('assistant-session')
        expect(state.messages[0]?.status).toBe('sent')
    })

    it('does not notify callers when a resolver returns the unchanged active session id', async () => {
        const onSessionResolved = vi.fn()
        const api = {
            sendMessage: vi.fn(async () => undefined),
        } as unknown as ApiClient

        const { result } = renderHook(() => useSendMessage(api, 'assistant-session', {
            resolveSessionId: async () => 'assistant-session',
            onSessionResolved,
        }), { wrapper: createWrapper() })

        await act(async () => {
            result.current.sendMessage('继续')
        })

        await waitFor(() => {
            expect(api.sendMessage).toHaveBeenCalled()
        })
        expect(onSessionResolved).not.toHaveBeenCalled()
    })
})
