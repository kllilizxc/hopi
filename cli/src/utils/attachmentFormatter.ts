import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { AttachmentMetadata } from '@/api/types'
import type { PromptContent } from '@/agent/types'

const IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
    '.tif',
    '.tiff',
    '.heic',
    '.heif',
    '.avif'
])

function isAttachmentPathToken(token: string): boolean {
    if (!token.startsWith('@')) {
        return false
    }
    const path = token.slice(1)
    if (!path) {
        return false
    }
    return (
        path.startsWith('/')
        || path.startsWith('\\\\')
        || /^[A-Za-z]:[\\/]/.test(path)
    )
}

export function isImageAttachmentPath(path: string): boolean {
    return IMAGE_EXTENSIONS.has(extname(path).toLowerCase())
}

export function getImageMediaTypeFromPath(path: string): string | null {
    switch (extname(path).toLowerCase()) {
        case '.png':
            return 'image/png'
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg'
        case '.gif':
            return 'image/gif'
        case '.webp':
            return 'image/webp'
        default:
            return null
    }
}

export function formatAttachmentsForClaude(attachments: AttachmentMetadata[] | undefined): string {
    if (!attachments || attachments.length === 0) {
        return ''
    }
    return attachments.map((attachment) => `@${attachment.path}`).join(' ')
}

export function formatMessageWithAttachments(
    text: string,
    attachments: AttachmentMetadata[] | undefined
): string {
    const attachmentText = formatAttachmentsForClaude(attachments)
    if (!attachmentText) {
        return text
    }
    if (!text) {
        return attachmentText
    }
    return `${attachmentText}\n\n${text}`
}

export function splitFormattedMessageAndAttachmentPaths(message: string): {
    text: string
    attachmentPaths: string[]
} {
    const normalized = message.replace(/\r\n/g, '\n')
    const firstParagraphEnd = normalized.indexOf('\n\n')
    const attachmentParagraph = firstParagraphEnd >= 0
        ? normalized.slice(0, firstParagraphEnd).trim()
        : normalized.trim()

    if (!attachmentParagraph.startsWith('@')) {
        return {
            text: normalized,
            attachmentPaths: []
        }
    }

    const tokens = attachmentParagraph.split(/\s+/).filter(Boolean)
    if (tokens.length === 0 || !tokens.every(isAttachmentPathToken)) {
        return {
            text: normalized,
            attachmentPaths: []
        }
    }

    const text = firstParagraphEnd >= 0
        ? normalized.slice(firstParagraphEnd + 2).trim()
        : ''

    return {
        text,
        attachmentPaths: tokens.map((token) => token.slice(1))
    }
}

export function buildPromptContentFromFormattedMessage(message: string): PromptContent[] {
    const { text, attachmentPaths } = splitFormattedMessageAndAttachmentPaths(message)
    const imagePaths = attachmentPaths.filter(isImageAttachmentPath)
    const filePaths = attachmentPaths.filter((path) => !isImageAttachmentPath(path))
    const content: PromptContent[] = imagePaths.map((path) => ({
        type: 'localImage',
        path
    }))

    const textWithFileRefs = filePaths.length > 0
        ? `${filePaths.map((path) => `@${path}`).join(' ')}${text ? `\n\n${text}` : ''}`
        : text

    if (textWithFileRefs || content.length === 0) {
        content.push({
            type: 'text',
            text: textWithFileRefs
        })
    }

    return content
}

export type ClaudeUserContentBlock =
    | {
        type: 'text'
        text: string
    }
    | {
        type: 'image'
        source: {
            type: 'base64'
            media_type: string
            data: string
        }
    }

export function buildClaudeUserContentFromFormattedMessage(message: string): string | ClaudeUserContentBlock[] {
    const { text, attachmentPaths } = splitFormattedMessageAndAttachmentPaths(message)
    if (attachmentPaths.length === 0) {
        return message
    }

    const content: ClaudeUserContentBlock[] = []
    const fileRefs: string[] = []

    for (const path of attachmentPaths) {
        const mediaType = getImageMediaTypeFromPath(path)
        if (!mediaType) {
            fileRefs.push(`@${path}`)
            continue
        }
        content.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: readFileSync(path, 'base64')
            }
        })
    }

    const textWithFileRefs = fileRefs.length > 0
        ? `${fileRefs.join(' ')}${text ? `\n\n${text}` : ''}`
        : text

    if (textWithFileRefs) {
        content.unshift({
            type: 'text',
            text: textWithFileRefs
        })
    }

    if (content.length === 0) {
        return text
    }

    return content
}
