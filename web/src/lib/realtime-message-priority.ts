import { isObject } from '@hopi/protocol'
import type { DecryptedMessage } from '@/types/api'

export function shouldFlushIncomingMessage(message: DecryptedMessage): boolean {
    const content = message.content
    if (!isObject(content) || content.role !== 'agent') return false

    const body = isObject(content.content) ? content.content : null
    if (!body || body.type !== 'codex') return false

    const data = isObject(body.data) ? body.data : null
    return data?.type === 'tool-call'
}
