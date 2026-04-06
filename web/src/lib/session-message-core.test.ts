import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import {
    createSessionMessageWindowStore,
    type SessionMessagesClient,
    type SessionMessagesPage,
} from '@hopi/protocol/session-messages'

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

function buildPage(messages: DecryptedMessage[], hasMore: boolean): SessionMessagesPage<DecryptedMessage> {
    return {
        messages,
        page: {
            limit: 50,
            beforeSeq: null,
            nextBeforeSeq: null,
            hasMore,
        },
    }
}

describe('createSessionMessageWindowStore', () => {
    const sessionId = 'session-core'
    let api: SessionMessagesClient<DecryptedMessage>

    beforeEach(() => {
        vi.useFakeTimers()
        api = {
            getMessages: vi.fn(),
        }
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('populates the latest page into visible state', async () => {
        vi.mocked(api.getMessages).mockResolvedValue(buildPage([
            buildMessage('message-1', 1),
            buildMessage('message-2', 2),
        ], true))

        const store = createSessionMessageWindowStore<DecryptedMessage>({
            isVisibleMessage: () => true,
        })

        await store.fetchLatestMessages(api, sessionId)

        expect(store.getMessageWindowState(sessionId)).toEqual(expect.objectContaining({
            sessionId,
            hasMore: true,
            messages: [
                expect.objectContaining({ id: 'message-1' }),
                expect.objectContaining({ id: 'message-2' }),
            ],
            pending: [],
        }))
    })

    it('prepends older pages ahead of the current window', async () => {
        vi.mocked(api.getMessages)
            .mockResolvedValueOnce(buildPage([
                buildMessage('message-3', 3),
                buildMessage('message-4', 4),
            ], true))
            .mockResolvedValueOnce(buildPage([
                buildMessage('message-1', 1),
                buildMessage('message-2', 2),
            ], false))

        const store = createSessionMessageWindowStore<DecryptedMessage>({
            isVisibleMessage: () => true,
        })

        await store.fetchLatestMessages(api, sessionId)
        await store.fetchOlderMessages(api, sessionId)

        expect(store.getMessageWindowState(sessionId).messages.map((message) => message.id)).toEqual([
            'message-1',
            'message-2',
            'message-3',
            'message-4',
        ])
        expect(store.getMessageWindowState(sessionId).hasMore).toBe(false)
    })

    it('merges live incoming messages into the visible list while at bottom', async () => {
        vi.mocked(api.getMessages).mockResolvedValue(buildPage([
            buildMessage('message-1', 1),
        ], false))

        const store = createSessionMessageWindowStore<DecryptedMessage>({
            isVisibleMessage: () => true,
        })
        const unsubscribe = store.subscribeMessageWindow(sessionId, () => {})

        await store.fetchLatestMessages(api, sessionId)
        store.ingestIncomingMessages(sessionId, [buildMessage('message-2', 2)])
        await vi.advanceTimersByTimeAsync(40)

        expect(store.getMessageWindowState(sessionId).messages.map((message) => message.id)).toEqual([
            'message-1',
            'message-2',
        ])
        expect(store.getMessageWindowState(sessionId).pendingCount).toBe(0)

        unsubscribe()
    })

    it('queues live incoming messages into pending when the viewport is away from bottom', async () => {
        vi.mocked(api.getMessages).mockResolvedValue(buildPage([
            buildMessage('message-1', 1),
        ], false))

        const store = createSessionMessageWindowStore<DecryptedMessage>({
            isVisibleMessage: () => true,
        })
        const unsubscribe = store.subscribeMessageWindow(sessionId, () => {})

        await store.fetchLatestMessages(api, sessionId)
        store.setAtBottom(sessionId, false)
        store.ingestIncomingMessages(sessionId, [buildMessage('message-2', 2)])
        await vi.advanceTimersByTimeAsync(40)

        expect(store.getMessageWindowState(sessionId).messages.map((message) => message.id)).toEqual([
            'message-1',
        ])
        expect(store.getMessageWindowState(sessionId).pending.map((message) => message.id)).toEqual([
            'message-2',
        ])
        expect(store.getMessageWindowState(sessionId).pendingCount).toBe(1)

        unsubscribe()
    })
})
