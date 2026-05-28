import { normalizeSessionMessage } from '@hopi/protocol/chat'
import type { DecryptedMessage } from '@/types/api'
import type { NormalizedMessage } from '@/chat/types'

export function normalizeDecryptedMessage(message: DecryptedMessage): NormalizedMessage | null {
    const normalized = normalizeSessionMessage(message)
    return normalized ? normalized as NormalizedMessage : null
}
