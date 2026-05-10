import { describe, expect, it } from 'vitest'
import { MESSAGE_STREAM_CLASS_NAME } from '@/components/AssistantChat/HappyThread'

describe('HappyThread message spacing', () => {
    it('keeps separate messages visually comfortable', () => {
        expect(MESSAGE_STREAM_CLASS_NAME).toContain('gap-4')
        expect(MESSAGE_STREAM_CLASS_NAME).toContain('sm:gap-5')
    })
})
