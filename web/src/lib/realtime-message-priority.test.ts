import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { shouldFlushIncomingMessage } from '@/lib/realtime-message-priority'

function codexMessage(type: string): DecryptedMessage {
    return {
        id: type,
        seq: 1,
        localId: null,
        createdAt: 1,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type,
                    callId: 'call-1',
                },
            },
        },
    }
}

describe('shouldFlushIncomingMessage', () => {
    it('flushes tool-call starts immediately', () => {
        expect(shouldFlushIncomingMessage(codexMessage('tool-call'))).toBe(true)
    })

    it('leaves tool results on the normal buffered path', () => {
        expect(shouldFlushIncomingMessage(codexMessage('tool-call-result'))).toBe(false)
    })
})
