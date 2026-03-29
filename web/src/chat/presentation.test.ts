import { describe, expect, it } from 'vitest'

import { getEventPresentation } from '@/chat/presentation'

describe('chat event presentation', () => {
    it('renders error events as readable text instead of raw JSON', () => {
        expect(getEventPresentation({
            type: 'error',
            message: 'Process exited unexpectedly',
            reason: 'process-exited'
        })).toEqual({
            icon: '⚠️',
            text: 'Process exited unexpectedly'
        })
    })
})
