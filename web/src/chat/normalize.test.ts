import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { normalizeDecryptedMessage } from '@/chat/normalize'

function createMessage(content: unknown): DecryptedMessage {
    return {
        id: 'message-1',
        seq: 1,
        createdAt: 1,
        localId: null,
        content,
    }
}

describe('normalizeDecryptedMessage', () => {
    it('renders assistant text envelopes as plain agent text instead of JSON', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'assistant',
            content: {
                type: 'text',
                text: 'HOPI started preview directly from the task action.'
            },
            meta: {
                sentFrom: 'webapp'
            }
        }))

        expect(normalized?.role).toBe('agent')
        expect(Array.isArray(normalized?.content)).toBe(true)
        expect(Array.isArray(normalized?.content) ? normalized.content[0] : null).toMatchObject({
            type: 'text',
            text: 'HOPI started preview directly from the task action.'
        })
    })
})
