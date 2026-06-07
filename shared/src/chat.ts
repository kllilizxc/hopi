import type { AttachmentMetadata } from './schemas'
import { unwrapRoleWrappedRecordEnvelope } from './messages'
import { asNumber, asString, isObject, safeStringify } from './utils'

export type UsageData = {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    service_tier?: string
}

export type AgentEvent =
    | { type: 'switch'; mode: 'local' | 'remote' }
    | { type: 'message'; message: string }
    | { type: 'error'; message: string; reason?: 'aborted' | 'process-exited' | 'prompt-failed' | 'task-failed' | 'unknown' }
    | { type: 'title-changed'; title: string }
    | { type: 'limit-reached'; endsAt: number }
    | { type: 'ready'; forLocalKey?: string; hasAssistantReply?: boolean }
    | { type: 'api-error'; retryAttempt: number; maxRetries: number; error: unknown }
    | { type: 'turn-duration'; durationMs: number }
    | { type: 'microcompact'; trigger: string; preTokens: number; tokensSaved: number }
    | { type: 'compact'; trigger: string; preTokens: number }
    | ({ type: string } & Record<string, unknown>)

type AgentErrorReason = Extract<AgentEvent, { type: 'error' }>['reason']

export type ToolResultPermission = {
    date: number
    result: 'approved' | 'denied'
    mode?: string
    allowedTools?: string[]
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
}

export type ToolUse = {
    type: 'tool-call'
    id: string
    name: string
    input: unknown
    description: string | null
    uuid: string
    parentUUID: string | null
}

export type ToolResult = {
    type: 'tool-result'
    tool_use_id: string
    content: unknown
    is_error: boolean
    is_partial?: boolean
    uuid: string
    parentUUID: string | null
    permissions?: ToolResultPermission
}

export type NormalizedAgentContent =
    | {
        type: 'text'
        text: string
        uuid: string
        parentUUID: string | null
    }
    | {
        type: 'reasoning'
        text: string
        uuid: string
        parentUUID: string | null
    }
    | ToolUse
    | ToolResult
    | { type: 'summary'; summary: string }
    | { type: 'sidechain'; uuid: string; prompt: string }

export type NormalizedMessage = ({
    role: 'user'
    content: { type: 'text'; text: string; attachments?: AttachmentMetadata[] }
} | {
    role: 'agent'
    content: NormalizedAgentContent[]
} | {
    role: 'event'
    content: AgentEvent
}) & {
    id: string
    localId: string | null
    createdAt: number
    isSidechain: boolean
    meta?: unknown
    usage?: UsageData
    status?: string
    originalText?: string
}

const CODEX_PLAN_UPDATE_META_KEY = '__hopiCodexPlanUpdate'

export function isCodexPlanUpdateMeta(meta: unknown): boolean {
    return isObject(meta) && meta[CODEX_PLAN_UPDATE_META_KEY] === true
}

export function withCodexPlanUpdateMeta(meta: unknown): Record<string, unknown> {
    if (isObject(meta)) {
        return { ...meta, [CODEX_PLAN_UPDATE_META_KEY]: true }
    }
    return { [CODEX_PLAN_UPDATE_META_KEY]: true, originalMeta: meta }
}

export type TranscriptMessageLike = {
    id: string
    localId?: string | null
    createdAt: number
    content: unknown
    status?: string
    originalText?: string
}

function asBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null
}

function parseAttachments(raw: unknown): AttachmentMetadata[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const attachments: AttachmentMetadata[] = []
    for (const item of raw) {
        if (
            isObject(item) &&
            typeof item.id === 'string' &&
            typeof item.filename === 'string' &&
            typeof item.mimeType === 'string' &&
            typeof item.size === 'number' &&
            typeof item.path === 'string'
        ) {
            attachments.push({
                id: item.id,
                filename: item.filename,
                mimeType: item.mimeType,
                size: item.size,
                path: item.path,
                previewUrl: typeof item.previewUrl === 'string' ? item.previewUrl : undefined,
            })
        }
    }
    return attachments.length > 0 ? attachments : undefined
}

function normalizeToolResultPermissions(value: unknown): ToolResultPermission | undefined {
    if (!isObject(value)) return undefined
    const date = asNumber(value.date)
    const result = value.result
    if (date === null) return undefined
    if (result !== 'approved' && result !== 'denied') return undefined

    const mode = asString(value.mode) ?? undefined
    const allowedTools = Array.isArray(value.allowedTools)
        ? value.allowedTools.filter((tool) => typeof tool === 'string')
        : undefined
    const decision = value.decision
    const normalizedDecision = decision === 'approved' || decision === 'approved_for_session' || decision === 'denied' || decision === 'abort'
        ? decision
        : undefined

    return {
        date,
        result,
        mode,
        allowedTools,
        decision: normalizedDecision,
    }
}

function normalizeAgentEvent(value: unknown): AgentEvent | null {
    if (!isObject(value) || typeof value.type !== 'string') return null
    return value as AgentEvent
}

type PlanStatus = 'pending' | 'in_progress' | 'completed'

type PlanEntry = {
    content: string
    status: PlanStatus
}

function normalizePlanStatus(value: unknown): PlanStatus | null {
    if (typeof value !== 'string') return null
    const normalized = value.toLowerCase().replace(/[\s_-]/g, '')
    if (normalized === 'pending') return 'pending'
    if (normalized === 'inprogress') return 'in_progress'
    if (normalized === 'completed') return 'completed'
    return null
}

function normalizePlanEntries(value: unknown): PlanEntry[] {
    if (!Array.isArray(value)) return []

    const entries: PlanEntry[] = []
    for (const item of value) {
        if (!isObject(item)) continue

        const content = asString(item.content ?? item.step ?? item.text)?.trim()
        const status = normalizePlanStatus(item.status)
        if (!content || !status) continue

        entries.push({ content, status })
    }

    return entries
}

function formatPlanText(entries: PlanEntry[], explanation?: string): string {
    const lines: string[] = []

    if (explanation) {
        lines.push(explanation)
    }

    if (entries.length > 0) {
        if (lines.length > 0) {
            lines.push('')
        }
        for (const entry of entries) {
            const checkbox = entry.status === 'completed' ? 'x' : ' '
            lines.push(`- [${checkbox}] ${entry.content}`)
        }
    }

    return lines.join('\n')
}

function normalizeAssistantOutput(
    messageId: string,
    localId: string | null,
    createdAt: number,
    data: Record<string, unknown>,
    meta?: unknown,
): NormalizedMessage | null {
    const uuid = asString(data.uuid) ?? messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const modelContent = message.content
    const blocks: NormalizedAgentContent[] = []

    if (typeof modelContent === 'string') {
        blocks.push({ type: 'text', text: modelContent, uuid, parentUUID })
    } else if (Array.isArray(modelContent)) {
        for (const block of modelContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                blocks.push({ type: 'text', text: block.text, uuid, parentUUID })
                continue
            }
            if (block.type === 'thinking' && typeof block.thinking === 'string') {
                blocks.push({ type: 'reasoning', text: block.thinking, uuid, parentUUID })
                continue
            }
            if (block.type === 'tool_use' && typeof block.id === 'string') {
                const name = asString(block.name) ?? 'Tool'
                const input = 'input' in block ? (block as Record<string, unknown>).input : undefined
                const description = isObject(input) && typeof input.description === 'string' ? input.description : null
                blocks.push({ type: 'tool-call', id: block.id, name, input, description, uuid, parentUUID })
            }
        }
    }

    const usage = isObject(message.usage) ? (message.usage as Record<string, unknown>) : null
    const inputTokens = usage ? asNumber(usage.input_tokens) : null
    const outputTokens = usage ? asNumber(usage.output_tokens) : null

    return {
        id: messageId,
        localId,
        createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta,
        usage: inputTokens !== null && outputTokens !== null
            ? {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_input_tokens: asNumber(usage?.cache_creation_input_tokens) ?? undefined,
                cache_read_input_tokens: asNumber(usage?.cache_read_input_tokens) ?? undefined,
                service_tier: asString(usage?.service_tier) ?? undefined,
            }
            : undefined,
    }
}

function normalizeUserOutput(
    messageId: string,
    localId: string | null,
    createdAt: number,
    data: Record<string, unknown>,
    meta?: unknown,
): NormalizedMessage | null {
    const uuid = asString(data.uuid) ?? messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const messageContent = message.content

    if (isSidechain && typeof messageContent === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'agent',
            isSidechain: true,
            content: [{ type: 'sidechain', uuid, prompt: messageContent }],
        }
    }

    if (typeof messageContent === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text: messageContent },
            meta,
        }
    }

    const blocks: NormalizedAgentContent[] = []

    if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                blocks.push({ type: 'text', text: block.text, uuid, parentUUID })
                continue
            }
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                const isError = Boolean(block.is_error)
                const rawContent = 'content' in block ? (block as Record<string, unknown>).content : undefined
                const embeddedToolUseResult = 'toolUseResult' in data ? (data as Record<string, unknown>).toolUseResult : null

                const permissions = normalizeToolResultPermissions(block.permissions)

                blocks.push({
                    type: 'tool-result',
                    tool_use_id: block.tool_use_id,
                    content: embeddedToolUseResult ?? rawContent,
                    is_error: isError,
                    uuid,
                    parentUUID,
                    permissions,
                })
            }
        }
    }

    return {
        id: messageId,
        localId,
        createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta,
    }
}

export function isSkippableAgentContent(content: unknown): boolean {
    if (!isObject(content) || content.type !== 'output') return false
    const data = isObject(content.data) ? content.data : null
    if (!data) return false
    return Boolean(data.isMeta) || Boolean(data.isCompactSummary)
}

export function isCodexContent(content: unknown): boolean {
    return isObject(content) && content.type === 'codex'
}

function normalizeInlineAgentText(message: TranscriptMessageLike, content: unknown, meta?: unknown): NormalizedMessage | null {
    if (typeof content === 'string') {
        return {
            id: message.id,
            localId: message.localId ?? null,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: content, uuid: message.id, parentUUID: null }],
            meta,
            status: message.status,
            originalText: message.originalText,
        }
    }

    if (!isObject(content) || content.type !== 'text' || typeof content.text !== 'string') {
        return null
    }

    return {
        id: message.id,
        localId: message.localId ?? null,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: content.text, uuid: message.id, parentUUID: null }],
        meta,
        status: message.status,
        originalText: message.originalText,
    }
}

export function normalizeAgentRecord(
    messageId: string,
    localId: string | null,
    createdAt: number,
    content: unknown,
    meta?: unknown,
): NormalizedMessage | null {
    if (!isObject(content) || typeof content.type !== 'string') return null

    if (content.type === 'output') {
        const data = isObject(content.data) ? content.data : null
        if (!data || typeof data.type !== 'string') return null

        if (data.isMeta) return null
        if (data.isCompactSummary) return null

        if (data.type === 'assistant') {
            return normalizeAssistantOutput(messageId, localId, createdAt, data, meta)
        }
        if (data.type === 'user') {
            return normalizeUserOutput(messageId, localId, createdAt, data, meta)
        }
        if (data.type === 'summary' && typeof data.summary === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'summary', summary: data.summary }],
                meta,
            }
        }
        if (data.type === 'system' && data.subtype === 'api_error') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'api-error',
                    retryAttempt: asNumber(data.retryAttempt) ?? 0,
                    maxRetries: asNumber(data.maxRetries) ?? 0,
                    error: data.error,
                },
                isSidechain: false,
                meta,
            }
        }
        if (data.type === 'system' && data.subtype === 'turn_duration') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'turn-duration',
                    durationMs: asNumber(data.durationMs) ?? 0,
                },
                isSidechain: false,
                meta,
            }
        }
        if (data.type === 'system' && data.subtype === 'microcompact_boundary') {
            const metadata = isObject(data.microcompactMetadata) ? data.microcompactMetadata : null
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'microcompact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: asNumber(metadata?.preTokens) ?? 0,
                    tokensSaved: asNumber(metadata?.tokensSaved) ?? 0,
                },
                isSidechain: false,
                meta,
            }
        }
        if (data.type === 'system' && data.subtype === 'compact_boundary') {
            const metadata = isObject(data.compactMetadata) ? data.compactMetadata : null
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'compact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: asNumber(metadata?.preTokens) ?? 0,
                },
                isSidechain: false,
                meta,
            }
        }
        return null
    }

    if (content.type === 'event') {
        const event = normalizeAgentEvent(content.data)
        if (!event) return null
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'event',
            content: event,
            isSidechain: false,
            meta,
        }
    }

    if (content.type === 'codex') {
        const data = isObject(content.data) ? content.data : null
        if (!data || typeof data.type !== 'string') return null

        if (data.type === 'message' && typeof data.message === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'text', text: data.message, uuid: messageId, parentUUID: null }],
                meta,
            }
        }

        if (data.type === 'reasoning' && typeof data.message === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'reasoning', text: data.message, uuid: messageId, parentUUID: null }],
                meta,
            }
        }

        if (data.type === 'error' && typeof data.message === 'string') {
            const lowered = data.message.toLowerCase()
            let reason: AgentErrorReason = 'unknown'
            if (lowered.includes('aborted by user')) {
                reason = 'aborted'
            } else if (lowered.includes('process exited unexpectedly') || lowered.includes('timeout waiting for child process to exit')) {
                reason = 'process-exited'
            } else if (lowered.includes('prompt failed')) {
                reason = 'prompt-failed'
            } else if (lowered.includes('task failed')) {
                reason = 'task-failed'
            }
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'error',
                    message: data.message,
                    reason,
                },
                meta,
            }
        }

        if (data.type === 'plan') {
            const entries = normalizePlanEntries(data.entries)
            const explanation = asString(data.explanation) ?? undefined
            const text = formatPlanText(entries, explanation)
            if (!text) return null

            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'text', text, uuid: messageId, parentUUID: null }],
                meta: withCodexPlanUpdateMeta(meta),
            }
        }

        if (data.type === 'tool-call' && typeof data.callId === 'string') {
            const uuid = asString(data.id) ?? messageId
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-call',
                    id: data.callId,
                    name: asString(data.name) ?? 'unknown',
                    input: data.input,
                    description: null,
                    uuid,
                    parentUUID: null,
                }],
                meta,
            }
        }

        if (data.type === 'tool-call-result' && typeof data.callId === 'string') {
            const uuid = asString(data.id) ?? messageId
            const isError = asBoolean(data.is_error) ?? false
            const isPartial = asBoolean(data.is_partial ?? data.partial) ?? false
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-result',
                    tool_use_id: data.callId,
                    content: data.output,
                    is_error: isError,
                    is_partial: isPartial,
                    uuid,
                    parentUUID: null,
                }],
                meta,
            }
        }
    }

    return null
}

function normalizeUserRecord(
    messageId: string,
    localId: string | null,
    createdAt: number,
    content: unknown,
    meta?: unknown,
): NormalizedMessage | null {
    if (typeof content === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            content: { type: 'text', text: content },
            isSidechain: false,
            meta,
        }
    }

    if (isObject(content) && content.type === 'text' && typeof content.text === 'string') {
        const attachments = parseAttachments(content.attachments)
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            content: { type: 'text', text: content.text, attachments },
            isSidechain: false,
            meta,
        }
    }

    return null
}

export function normalizeSessionMessage(message: TranscriptMessageLike): NormalizedMessage | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) {
        return {
            id: message.id,
            localId: message.localId ?? null,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(message.content), uuid: message.id, parentUUID: null }],
            status: message.status,
            originalText: message.originalText,
        }
    }

    if (record.role === 'user') {
        const normalized = normalizeUserRecord(message.id, message.localId ?? null, message.createdAt, record.content, record.meta)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText }
            : {
                id: message.id,
                localId: message.localId ?? null,
                createdAt: message.createdAt,
                role: 'user',
                isSidechain: false,
                content: { type: 'text', text: safeStringify(record.content) },
                meta: record.meta,
                status: message.status,
                originalText: message.originalText,
            }
    }

    if (record.role === 'assistant' || record.role === 'agent') {
        if (isSkippableAgentContent(record.content)) {
            return null
        }
        const normalized = normalizeAgentRecord(message.id, message.localId ?? null, message.createdAt, record.content, record.meta)
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
                    localId: message.localId ?? null,
                    createdAt: message.createdAt,
                    role: 'agent',
                    isSidechain: false,
                    content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
                    meta: record.meta,
                    status: message.status,
                    originalText: message.originalText,
                }
    }

    return {
        id: message.id,
        localId: message.localId ?? null,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
        meta: record.meta,
        status: message.status,
        originalText: message.originalText,
    }
}

export function formatUnixTimestamp(value: number): string {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
}

function formatDuration(ms: number): string {
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
}

export type EventPresentation = {
    icon: string | null
    text: string
}

export function getEventPresentation(event: AgentEvent): EventPresentation {
    if (event.type === 'api-error') {
        const { retryAttempt, maxRetries } = event as { retryAttempt: number; maxRetries: number }
        if (maxRetries > 0 && retryAttempt >= maxRetries) {
            return { icon: '⚠️', text: 'API error: Max retries reached' }
        }
        if (maxRetries > 0) {
            return { icon: '⏳', text: `API error: Retrying (${retryAttempt}/${maxRetries})` }
        }
        if (retryAttempt > 0) {
            return { icon: '⏳', text: 'API error: Retrying...' }
        }
        return { icon: '⚠️', text: 'API error' }
    }
    if (event.type === 'switch') {
        const mode = event.mode === 'local' ? 'local' : 'remote'
        return { icon: '🔄', text: `Switched to ${mode}` }
    }
    if (event.type === 'title-changed') {
        const title = typeof event.title === 'string' ? event.title : ''
        return { icon: null, text: title ? `Title changed to "${title}"` : 'Title changed' }
    }
    if (event.type === 'permission-mode-changed') {
        const modeValue = (event as Record<string, unknown>).mode
        const mode = typeof modeValue === 'string' ? modeValue : 'default'
        return { icon: '🔐', text: `Permission mode: ${mode}` }
    }
    if (event.type === 'limit-reached') {
        const endsAt = typeof event.endsAt === 'number' ? event.endsAt : null
        return { icon: '⏳', text: endsAt ? `Usage limit reached until ${formatUnixTimestamp(endsAt)}` : 'Usage limit reached' }
    }
    if (event.type === 'message') {
        return { icon: null, text: typeof event.message === 'string' ? event.message : 'Message' }
    }
    if (event.type === 'error') {
        return { icon: '⚠️', text: typeof event.message === 'string' && event.message.trim().length > 0 ? event.message : 'Error' }
    }
    if (event.type === 'turn-duration') {
        const ms = typeof event.durationMs === 'number' ? event.durationMs : 0
        return { icon: '⏱️', text: `Turn: ${formatDuration(ms)}` }
    }
    if (event.type === 'microcompact') {
        const saved = typeof event.tokensSaved === 'number' ? event.tokensSaved : 0
        const formatted = saved >= 1000 ? `${Math.round(saved / 1000)}K` : String(saved)
        return { icon: '📦', text: `Context compacted (saved ${formatted} tokens)` }
    }
    if (event.type === 'compact') {
        return { icon: '📦', text: 'Conversation compacted' }
    }
    try {
        return { icon: null, text: JSON.stringify(event) }
    } catch {
        return { icon: null, text: String(event.type) }
    }
}

export function renderEventLabel(event: AgentEvent): string {
    return getEventPresentation(event).text
}
