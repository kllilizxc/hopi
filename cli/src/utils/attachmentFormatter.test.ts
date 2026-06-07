import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    buildClaudeUserContentFromFormattedMessage,
    buildPromptContentFromFormattedMessage,
    formatMessageWithAttachments,
    splitFormattedMessageAndAttachmentPaths
} from './attachmentFormatter'

describe('attachmentFormatter', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('formats attachments ahead of the user text', () => {
        const formatted = formatMessageWithAttachments('please review this', [
            {
                id: 'a1',
                filename: 'diagram.png',
                mimeType: 'image/png',
                size: 12,
                path: '/tmp/hopi/diagram.png'
            }
        ])

        expect(formatted).toBe('@/tmp/hopi/diagram.png\n\nplease review this')
    })

    it('extracts attachment paths from the formatted prefix', () => {
        expect(
            splitFormattedMessageAndAttachmentPaths('@/tmp/a.png @/tmp/spec.txt\n\nplease review this')
        ).toEqual({
            text: 'please review this',
            attachmentPaths: ['/tmp/a.png', '/tmp/spec.txt']
        })
    })

    it('keeps normal @mentions as plain text', () => {
        expect(
            splitFormattedMessageAndAttachmentPaths('@teammate please check this image')
        ).toEqual({
            text: '@teammate please check this image',
            attachmentPaths: []
        })
    })

    it('builds prompt content with localImage items for pasted images', () => {
        expect(
            buildPromptContentFromFormattedMessage('@/tmp/a.png @/tmp/spec.txt\n\nplease review this')
        ).toEqual([
            { type: 'localImage', path: '/tmp/a.png' },
            { type: 'text', text: '@/tmp/spec.txt\n\nplease review this' }
        ])
    })

    it('supports attachment-only image messages', () => {
        expect(
            buildPromptContentFromFormattedMessage('@/tmp/a.png')
        ).toEqual([
            { type: 'localImage', path: '/tmp/a.png' }
        ])
    })

    it('builds Claude image content blocks for pasted images', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hopi-attachment-'))
        tempDirs.push(dir)
        const imagePath = join(dir, 'diagram.png')
        writeFileSync(imagePath, Buffer.from('png-bytes'))

        expect(
            buildClaudeUserContentFromFormattedMessage(`@${imagePath}\n\nplease review this`)
        ).toEqual([
            {
                type: 'text',
                text: 'please review this'
            },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: Buffer.from('png-bytes').toString('base64')
                }
            }
        ])
    })

    it('keeps non-image attachments as file refs in Claude text blocks', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hopi-attachment-'))
        tempDirs.push(dir)
        const imagePath = join(dir, 'diagram.png')
        const filePath = join(dir, 'spec.md')
        writeFileSync(imagePath, Buffer.from('png-bytes'))
        writeFileSync(filePath, '# spec')

        expect(
            buildClaudeUserContentFromFormattedMessage(`@${imagePath} @${filePath}\n\nplease review this`)
        ).toEqual([
            {
                type: 'text',
                text: `@${filePath}\n\nplease review this`
            },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: Buffer.from('png-bytes').toString('base64')
                }
            }
        ])
    })
})
