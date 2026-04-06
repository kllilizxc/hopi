import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, MessageStatus } from '@/types/api'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import {
    createSessionMessageWindowStore,
    DEFAULT_PENDING_WINDOW_SIZE,
    DEFAULT_VISIBLE_WINDOW_SIZE,
    type SessionMessageWindowState,
} from '@hopi/protocol/session-messages'

const store = createSessionMessageWindowStore<DecryptedMessage>({
    isVisibleMessage: (message) => normalizeDecryptedMessage(message) !== null,
    isUserMessage: (message) => {
        const content = message.content
        if (content && typeof content === 'object' && 'role' in content) {
            return (content as { role?: unknown }).role === 'user'
        }
        return false
    },
})

export type MessageWindowState = SessionMessageWindowState<DecryptedMessage>

export const VISIBLE_WINDOW_SIZE = DEFAULT_VISIBLE_WINDOW_SIZE
export const PENDING_WINDOW_SIZE = DEFAULT_PENDING_WINDOW_SIZE

export const getActiveMessageWindowSessionIds = store.getActiveMessageWindowSessionIds
export const getMessageWindowState = store.getMessageWindowState
export const subscribeMessageWindow = store.subscribeMessageWindow
export const clearMessageWindow = store.clearMessageWindow
export const seedMessageWindowFromSession = store.seedMessageWindowFromSession
export const ingestIncomingMessages = store.ingestIncomingMessages
export const flushPendingMessages = store.flushPendingMessages
export const setAtBottom = store.setAtBottom
export const appendOptimisticMessage = store.appendOptimisticMessage

export function updateMessageStatus(sessionId: string, localId: string, status: MessageStatus): void {
    store.updateMessageStatus(sessionId, localId, status)
}

export async function fetchLatestMessages(api: ApiClient, sessionId: string): Promise<void> {
    await store.fetchLatestMessages(api, sessionId)
}

export async function fetchOlderMessages(api: ApiClient, sessionId: string): Promise<void> {
    await store.fetchOlderMessages(api, sessionId)
}
