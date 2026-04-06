import type { PrototypeRemoteApiClient, PrototypeSessionMessagesResponse } from '@/prototype/remoteApi'
import {
    createSessionMessageWindowStore,
    type SessionMessagesClient,
    type SessionMessageWindowState,
} from '@hopi/protocol/session-messages'

export type PrototypeSessionMessage = PrototypeSessionMessagesResponse['messages'][number]
export type PrototypeSessionMessageState = SessionMessageWindowState<PrototypeSessionMessage>
export type PrototypeSessionMessagesClient = Pick<PrototypeRemoteApiClient, 'getMessages'>

export const sessionMessageStore = createSessionMessageWindowStore<PrototypeSessionMessage>({
    isVisibleMessage: () => true,
    isUserMessage: (message) => {
        const content = message.content
        if (content && typeof content === 'object' && 'role' in content) {
            return (content as { role?: unknown }).role === 'user'
        }
        return false
    },
})

export const getMessageWindowState = sessionMessageStore.getMessageWindowState
export const subscribeMessageWindow = sessionMessageStore.subscribeMessageWindow
export const clearMessageWindow = sessionMessageStore.clearMessageWindow
export const seedMessageWindowFromSession = sessionMessageStore.seedMessageWindowFromSession
export const fetchLatestMessages = (api: PrototypeSessionMessagesClient, sessionId: string) => (
    sessionMessageStore.fetchLatestMessages(api as SessionMessagesClient<PrototypeSessionMessage>, sessionId)
)
export const fetchOlderMessages = (api: PrototypeSessionMessagesClient, sessionId: string) => (
    sessionMessageStore.fetchOlderMessages(api as SessionMessagesClient<PrototypeSessionMessage>, sessionId)
)
export const ingestIncomingMessages = sessionMessageStore.ingestIncomingMessages
export const flushPendingMessages = sessionMessageStore.flushPendingMessages
export const setAtBottom = sessionMessageStore.setAtBottom
export const appendOptimisticMessage = sessionMessageStore.appendOptimisticMessage
export const updateMessageStatus = sessionMessageStore.updateMessageStatus
