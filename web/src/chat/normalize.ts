import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { isObject, safeStringify } from '@hopi/protocol'
import type { DecryptedMessage } from '@/types/api'
import type { NormalizedMessage } from '@/chat/types'
import { isCodexContent, isSkippableAgentContent, normalizeAgentRecord } from '@/chat/normalizeAgent'
import { normalizeUserRecord } from '@/chat/normalizeUser'

function normalizeInlineAgentText(message: DecryptedMessage, content: unknown, meta?: unknown): NormalizedMessage | null {
    if (typeof content === 'string') {
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: content, uuid: message.id, parentUUID: null }],
            meta,
            status: message.status,
            originalText: message.originalText
        }
    }

    if (!isObject(content) || content.type !== 'text' || typeof content.text !== 'string') {
        return null
    }

    return {
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: content.text, uuid: message.id, parentUUID: null }],
        meta,
        status: message.status,
        originalText: message.originalText
    }
}

export function normalizeDecryptedMessage(message: DecryptedMessage): NormalizedMessage | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) {
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(message.content), uuid: message.id, parentUUID: null }],
            status: message.status,
            originalText: message.originalText
        }
    }

    if (record.role === 'user') {
        const normalized = normalizeUserRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText }
            : {
                id: message.id,
                localId: message.localId,
                createdAt: message.createdAt,
                role: 'user',
                isSidechain: false,
                content: { type: 'text', text: safeStringify(record.content) },
                meta: record.meta,
                status: message.status,
                originalText: message.originalText
            }
    }
    if (record.role === 'assistant' || record.role === 'agent') {
        if (isSkippableAgentContent(record.content)) {
            return null
        }
        const normalized = normalizeAgentRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        if (!normalized && isCodexContent(record.content)) {
            return null
        }
        const inlineText = normalizeInlineAgentText(message, record.content, record.meta)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText }
            : inlineText
                ? inlineText
                : {
                    id: message.id,
                    localId: message.localId,
                    createdAt: message.createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
                    meta: record.meta,
                    status: message.status,
                    originalText: message.originalText
                }
    }

    return {
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
        meta: record.meta,
        status: message.status,
        originalText: message.originalText
    }
}
