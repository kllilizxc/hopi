import type { StoredSession } from '../../store'

export function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function assistantMessage(text: string): unknown {
    return {
        role: 'assistant',
        content: {
            type: 'text',
            text
        }
    }
}

export function getSessionTitle(session: StoredSession): string | null {
    const metadata = isRecord(session.metadata) ? session.metadata : null
    const name = metadata?.name
    return typeof name === 'string' ? name : null
}

export function extractMessageText(value: unknown): string | null {
    if (typeof value === 'string') {
        return normalizeText(value) || null
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((item) => extractMessageText(item))
            .filter((item): item is string => Boolean(item))
        return parts.length > 0 ? parts.join('\n') : null
    }
    if (!isRecord(value)) {
        return null
    }
    if (value.type === 'text' && typeof value.text === 'string') {
        return normalizeText(value.text) || null
    }
    if ('content' in value) {
        const text = extractMessageText(value.content)
        if (text) return text
    }
    if ('message' in value) {
        const text = extractMessageText(value.message)
        if (text) return text
    }
    return null
}
