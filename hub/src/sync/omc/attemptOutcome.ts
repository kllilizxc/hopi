import { isObject } from '@hopi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { OmcAttemptOutcomeSchema } from '@hopi/protocol/schemas'
import type { DecryptedMessage, OmcAttemptOutcome, OmcAttemptTerminationReason } from '@hopi/protocol/types'

const OMC_ATTEMPT_OUTCOME_MARKER = 'OMC_ATTEMPT_OUTCOME'

function sanitizeFingerprint(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'attempt-failure'
}

function extractText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((item) => extractText(item))
            .filter((item): item is string => Boolean(item))
        return parts.length > 0 ? parts.join('\n\n') : null
    }

    if (!isObject(value)) {
        return null
    }

    if (typeof value.text === 'string') {
        return value.text
    }

    if ('content' in value) {
        return extractText(value.content)
    }

    if ('message' in value) {
        return extractText(value.message)
    }

    return null
}

function parseCandidateObject(value: unknown, source: OmcAttemptOutcome['source']): OmcAttemptOutcome | null {
    if (!isObject(value)) {
        return null
    }

    const parsed = OmcAttemptOutcomeSchema.safeParse({
        ...value,
        source,
        terminationReason: typeof value.terminationReason === 'string'
            ? value.terminationReason
            : 'structured-completion'
    })

    return parsed.success ? parsed.data : null
}

function parseJsonCandidate(text: string): unknown | null {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return null
    }
}

function parseOutcomeFromText(text: string): OmcAttemptOutcome | null {
    const trimmed = text.trim()
    if (!trimmed) {
        return null
    }

    const direct = parseJsonCandidate(trimmed)
    const directParsed = direct ? parseCandidateObject(direct, 'assistant-structured') : null
    if (directParsed) {
        return directParsed
    }

    const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)]
    for (const match of fencedMatches) {
        const candidate = parseJsonCandidate(match[1] ?? '')
        const parsed = candidate ? parseCandidateObject(candidate, 'assistant-structured') : null
        if (parsed) {
            return parsed
        }
    }

    const markerIndex = trimmed.indexOf(OMC_ATTEMPT_OUTCOME_MARKER)
    if (markerIndex >= 0) {
        const afterMarker = trimmed.slice(markerIndex + OMC_ATTEMPT_OUTCOME_MARKER.length).trim()
        const markerDirect = parseJsonCandidate(afterMarker)
        const parsed = markerDirect ? parseCandidateObject(markerDirect, 'assistant-structured') : null
        if (parsed) {
            return parsed
        }
    }

    return null
}

export function buildSystemOmcAttemptOutcome(options: {
    status: OmcAttemptOutcome['status']
    summary: string
    terminationReason: OmcAttemptTerminationReason
    failureFingerprint?: string | null
    changedFiles?: string[]
    nextSuggestedStep?: string | null
}): OmcAttemptOutcome {
    return OmcAttemptOutcomeSchema.parse({
        status: options.status,
        summary: options.summary,
        failureFingerprint: options.failureFingerprint ?? null,
        changedFiles: options.changedFiles ?? [],
        checks: [],
        nextSuggestedStep: options.nextSuggestedStep ?? null,
        terminationReason: options.terminationReason,
        source: 'system-fallback'
    })
}

export function parseOmcAttemptOutcome(value: unknown): OmcAttemptOutcome | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record) {
        if (record.role !== 'assistant' && record.role !== 'agent') {
            return null
        }

        const fromRecord = parseCandidateObject(record.content, 'assistant-structured')
        if (fromRecord) {
            return fromRecord
        }

        const text = extractText(record.content)
        if (text) {
            return parseOutcomeFromText(text)
        }

        return null
    }

    const direct = parseCandidateObject(value, 'assistant-structured')
    if (direct) {
        return direct
    }

    if (typeof value === 'string') {
        return parseOutcomeFromText(value)
    }

    return null
}

export function parseOmcFallbackTerminationMessage(message: DecryptedMessage): OmcAttemptOutcome | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record || (record.role !== 'assistant' && record.role !== 'agent')) {
        return null
    }

    const content = record.content
    if (!isObject(content) || content.type !== 'event' || !isObject(content.data)) {
        return null
    }

    if (content.data.type === 'error') {
        const rawMessage = typeof content.data.message === 'string' ? content.data.message.trim() : ''
        const rawReason = typeof content.data.reason === 'string' ? content.data.reason.trim() : ''
        const detail = rawMessage || rawReason
        if (!detail) {
            return null
        }

        return buildSystemOmcAttemptOutcome({
            status: 'failed',
            summary: detail,
            terminationReason: 'session-error',
            failureFingerprint: sanitizeFingerprint(rawReason || rawMessage),
            nextSuggestedStep: 'Inspect the linked session, fix the runtime error, then resume the loop.'
        })
    }

    if (content.data.type === 'message') {
        const detail = typeof content.data.message === 'string' ? content.data.message.trim() : ''
        if (!detail || !detail.toLowerCase().includes('process exited unexpectedly')) {
            return null
        }

        return buildSystemOmcAttemptOutcome({
            status: 'failed',
            summary: detail,
            terminationReason: 'session-error',
            failureFingerprint: 'process-exited',
            nextSuggestedStep: 'Inspect the linked session and restart the loop after fixing the process exit.'
        })
    }

    return null
}
