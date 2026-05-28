import { describe, expect, it } from 'vitest'
import { MESSAGE_STREAM_CLASS_NAME, MESSAGE_VIEWPORT_CONTENT_CLASS_NAME } from '@/components/AssistantChat/HappyThread'

describe('HappyThread message spacing', () => {
    it('keeps separate messages visually comfortable', () => {
        expect(MESSAGE_STREAM_CLASS_NAME).toContain('gap-4')
        expect(MESSAGE_STREAM_CLASS_NAME).toContain('sm:gap-5')
    })

    it('reserves left gutter for prompt-style tool cards', () => {
        expect(MESSAGE_VIEWPORT_CONTENT_CLASS_NAME).toContain('pl-5')
        expect(MESSAGE_VIEWPORT_CONTENT_CLASS_NAME).toContain('pr-3')
        expect(MESSAGE_VIEWPORT_CONTENT_CLASS_NAME).not.toContain('p-3')
    })
})
