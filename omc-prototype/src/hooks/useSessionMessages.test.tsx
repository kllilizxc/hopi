import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecryptedMessage } from '@hopi/protocol/types'
import { useSessionMessages } from './useSessionMessages'

function buildMessage(id: string, seq: number): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        createdAt: seq,
        content: {
            role: seq % 2 === 0 ? 'assistant' : 'user',
            content: {
                type: 'text',
                text: `message-${seq}`,
            },
        },
    }
}

describe('useSessionMessages', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('fetches the latest message page when mounted', async () => {
        const api = {
            getMessages: vi.fn().mockResolvedValue({
                messages: [buildMessage('message-1', 1)],
                page: {
                    limit: 50,
                    beforeSeq: null,
                    nextBeforeSeq: null,
                    hasMore: false,
                },
            }),
        }

        const { result } = renderHook(() => useSessionMessages(api, 'session-1'))

        await waitFor(() => {
            expect(result.current.messages.map((message) => message.id)).toEqual(['message-1'])
        })
        expect(api.getMessages).toHaveBeenCalledWith('session-1', { beforeSeq: null, limit: 50 })
    })

    it('loads older history when loadMore is called', async () => {
        const api = {
            getMessages: vi.fn()
                .mockResolvedValueOnce({
                    messages: [buildMessage('message-2', 2), buildMessage('message-3', 3)],
                    page: {
                        limit: 50,
                        beforeSeq: null,
                        nextBeforeSeq: 2,
                        hasMore: true,
                    },
                })
                .mockResolvedValueOnce({
                    messages: [buildMessage('message-1', 1)],
                    page: {
                        limit: 50,
                        beforeSeq: 2,
                        nextBeforeSeq: null,
                        hasMore: false,
                    },
                }),
        }

        const { result } = renderHook(() => useSessionMessages(api, 'session-2'))

        await waitFor(() => {
            expect(result.current.messages.map((message) => message.id)).toEqual(['message-2', 'message-3'])
        })

        await result.current.loadMore()

        await waitFor(() => {
            expect(result.current.messages.map((message) => message.id)).toEqual([
                'message-1',
                'message-2',
                'message-3',
            ])
        })
    })

    it('merges the refreshed latest page into the visible window when refetch is called', async () => {
        const api = {
            getMessages: vi.fn()
                .mockResolvedValueOnce({
                    messages: [buildMessage('message-1', 1)],
                    page: {
                        limit: 50,
                        beforeSeq: null,
                        nextBeforeSeq: null,
                        hasMore: false,
                    },
                })
                .mockResolvedValueOnce({
                    messages: [buildMessage('message-2', 2)],
                    page: {
                        limit: 50,
                        beforeSeq: null,
                        nextBeforeSeq: null,
                        hasMore: false,
                    },
                }),
        }

        const { result } = renderHook(() => useSessionMessages(api, 'session-3'))

        await waitFor(() => {
            expect(result.current.messages.map((message) => message.id)).toEqual(['message-1'])
        })

        await result.current.refetch()

        await waitFor(() => {
            expect(result.current.messages.map((message) => message.id)).toEqual(['message-1', 'message-2'])
        })
    })
})
