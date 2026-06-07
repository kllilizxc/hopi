import { describe, expect, it } from 'vitest'

import { normalizeSessionMessage } from './chat'

describe('normalizeSessionMessage', () => {
    it('surfaces codex error messages as error events instead of dropping them', () => {
        const normalized = normalizeSessionMessage({
            id: 'msg-1',
            createdAt: 1,
            content: JSON.stringify({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'error',
                        message: 'Task failed: Codex thread entered systemError state'
                    }
                }
            })
        })

        expect(normalized).toEqual({
            id: 'msg-1',
            localId: null,
            createdAt: 1,
            role: 'event',
            isSidechain: false,
            content: {
                type: 'error',
                message: 'Task failed: Codex thread entered systemError state',
                reason: 'task-failed'
            },
            status: undefined,
            originalText: undefined,
        })
    })
})
