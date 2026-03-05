import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { isObject } from '@hopi/protocol'
import type { DecryptedMessage, Session } from '@hopi/protocol/types'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredTask, StoredWorkspace } from '../store'
import type { SyncEngine } from './syncEngine'

export const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'
const MAX_IMPROVEMENTS_PER_SCAN = 3
type ImprovementPriority = 'high' | 'medium' | 'low'
type ImprovementCategory = 'feature' | 'architecture'

const suggestionSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(200_000).optional(),
    priority: z.string().max(64).optional(),
    category: z.string().max(64).optional(),
    type: z.string().max(64).optional(),
    kind: z.string().max(64).optional(),
    focus: z.string().max(64).optional(),
    workspacePath: z.string().min(1).max(4096).optional(),
    workspaceLabel: z.string().min(1).max(255).optional(),
    workspace: z.string().min(1).max(4096).optional(),
}).passthrough()

export type ImprovementsSuggestion = {
    title: string
    description?: string
    priority: ImprovementPriority
    category: ImprovementCategory
    workspacePath?: string
    workspaceLabel?: string
}

function normalizeLocaleTag(raw: string | undefined): string | null {
    if (!raw) return null

    let value = raw.trim()
    if (!value) return null

    if (value.includes(':')) {
        value = value.split(':')[0] ?? value
    }
    value = value.split('.')[0] ?? value
    value = value.split('@')[0] ?? value
    value = value.replace(/_/g, '-')

    if (!value) return null
    const lowered = value.toLowerCase()
    if (lowered === 'c' || lowered === 'posix') {
        return null
    }

    try {
        const [canonical] = Intl.getCanonicalLocales(value)
        return canonical ?? null
    } catch {
        return null
    }
}

function resolvePromptLocale(options: {
    store: Store
    targetSessionId: string
    preferredLocale?: string
}): string {
    const preferredLocale = normalizeLocaleTag(options.preferredLocale)
    if (preferredLocale) {
        return preferredLocale
    }

    const session = options.store.sessions.getSession(options.targetSessionId)
    if (session && isObject(session.metadata)) {
        const metadataLocale = typeof session.metadata.locale === 'string'
            ? session.metadata.locale
            : (typeof session.metadata.language === 'string' ? session.metadata.language : undefined)
        const parsed = normalizeLocaleTag(metadataLocale)
        if (parsed) {
            return parsed
        }
    }

    const envLocale = normalizeLocaleTag(
        process.env.LC_ALL
        ?? process.env.LC_MESSAGES
        ?? process.env.LANGUAGE
        ?? process.env.LANG
    )
    if (envLocale) {
        return envLocale
    }

    const fallbackLocale = normalizeLocaleTag(Intl.DateTimeFormat().resolvedOptions().locale)
    return fallbackLocale ?? 'en'
}

function normalizeTitle(value: string): string {
    return value
        .trim()
        .replace(/^\d+[\).\s]+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
}

function normalizeSuggestionPriority(raw: string | undefined): ImprovementPriority | null {
    const value = raw?.trim().toLowerCase()
    if (!value) {
        return null
    }

    if (value === 'high' || value === 'urgent' || value === 'critical' || value === 'p0' || value === 'p1') {
        return 'high'
    }

    if (value === 'medium' || value === 'med' || value === 'normal' || value === 'default' || value === 'p2') {
        return 'medium'
    }

    if (value === 'low' || value === 'minor' || value === 'nice-to-have' || value === 'nice_to_have' || value === 'p3' || value === 'p4') {
        return 'low'
    }

    return null
}

function inferSuggestionPriorityFromText(title: string, description?: string): ImprovementPriority {
    const text = `${title} ${description ?? ''}`.toLowerCase()

    if (/\b(blocker|critical|urgent|security|outage|data loss|crash|regression)\b/.test(text)) {
        return 'high'
    }

    if (/\b(polish|cleanup|docs|documentation|typo|minor|nice to have)\b/.test(text)) {
        return 'low'
    }

    return 'medium'
}

function normalizeSuggestionCategory(raw: string | undefined): ImprovementCategory | null {
    const value = raw?.trim().toLowerCase()
    if (!value) {
        return null
    }

    const compact = value.replace(/[\s_-]+/g, '')

    if (
        compact === 'feature'
        || compact === 'features'
        || compact === 'function'
        || compact === 'functional'
        || compact === 'functionality'
        || compact === 'userfacing'
        || compact === 'ux'
        || compact === 'ui'
        || compact === 'product'
        || compact === 'capability'
        || compact === 'behavior'
        || compact === 'behaviour'
    ) {
        return 'feature'
    }

    if (
        compact === 'architecture'
        || compact === 'architectural'
        || compact === 'arch'
        || compact === 'codestructure'
        || compact === 'codearchitecture'
        || compact === 'technicaldebt'
        || compact === 'techdebt'
        || compact === 'refactor'
        || compact === 'infrastructure'
        || compact === 'infra'
        || compact === 'maintainability'
        || compact === 'engineering'
    ) {
        return 'architecture'
    }

    return null
}

function inferSuggestionCategoryFromText(title: string, description?: string): ImprovementCategory {
    const text = `${title} ${description ?? ''}`.toLowerCase()

    if (/\b(refactor|restructure|cleanup|abstraction|modular|architecture|maintainability|technical debt|coupling|decoupl|infra|infrastructure|schema)\b/.test(text)) {
        return 'architecture'
    }

    if (/\b(feature|ux|ui|flow|experience|support|expose|add|enable|improve|user)\b/.test(text)) {
        return 'feature'
    }

    return 'feature'
}

function mapWorkspaceHintToWorkspaceId(
    suggestion: ImprovementsSuggestion,
    workspaces: StoredWorkspace[]
): string | null {
    const pathHint = suggestion.workspacePath?.trim()
    if (pathHint) {
        const exact = workspaces.find((ws) => ws.path === pathHint)
        if (exact) return exact.id

        const prefixMatches = workspaces
            .filter((ws) => pathHint.startsWith(ws.path))
            .sort((a, b) => b.path.length - a.path.length)
        if (prefixMatches[0]) return prefixMatches[0].id
    }

    const labelHint = suggestion.workspaceLabel?.trim()
        || suggestion.workspacePath?.trim()
        || undefined
    if (labelHint) {
        const lowered = labelHint.toLowerCase()
        const exactLabel = workspaces.find((ws) => (ws.label ?? '').toLowerCase() === lowered)
        if (exactLabel) return exactLabel.id
    }

    return null
}

function buildImprovementsPrompt(options: {
    projectName: string
    finishedTask: Pick<StoredTask, 'title' | 'description'>
    workspaces: StoredWorkspace[]
    maxSuggestions: number
    locale: string
}): string {
    const workspaceLines = options.workspaces.length > 0
        ? options.workspaces.map((ws) => {
            const label = ws.label ? `${ws.label}: ` : ''
            return `- ${label}${ws.path}`
        }).join('\n')
        : '- (none)'

    const taskDescription = (options.finishedTask.description ?? '').trim()

    return [
        'You are helping maintain a kanban backlog for an AI coding project.',
        '',
        `Project: ${options.projectName}`,
        '',
        'We just marked this task as Finished:',
        `Title: ${options.finishedTask.title}`,
        taskDescription ? `Description:\n${taskDescription}` : 'Description: (none)',
        '',
        'Workspaces (directories):',
        workspaceLines,
        '',
        `Task: Suggest up to ${options.maxSuggestions} follow-up improvement tasks.`,
        `- Use the system language for this session (${options.locale}) in task titles/descriptions.`,
        '- Keep the output split close to 50/50: feature optimizations vs code architecture optimizations.',
        '- Do NOT run tools, commands, or code edits.',
        '- Do NOT include markdown fences.',
        '- Output STRICT JSON ONLY: a JSON array of objects.',
        '',
        'JSON schema:',
        '[{"title":"string","description":"string?","priority":"high|medium|low","category":"feature|architecture","workspacePath":"string?","workspaceLabel":"string?"}]',
        '',
        'Rules:',
        '- Return an empty array [] if no good suggestions.',
        '- Focus on necessary, high-impact follow-ups only; fewer is better.',
        '- Keep titles short and actionable.',
        '- Include a "priority" for each item using ONLY: "high", "medium", or "low".',
        '- Include a "category" for each item using ONLY: "feature" or "architecture".',
        '- If the total count is odd, keep category difference at most 1.',
        '- No duplicates.'
    ].join('\n')
}

function extractTextFromClaudeOutput(content: Record<string, unknown>): string | null {
    if (content.type !== 'output') return null

    const data = isObject(content.data) ? content.data : null
    if (!data) return null

    if (data.type === 'text' && typeof data.text === 'string' && data.text.trim().length > 0) {
        return data.text
    }

    if (data.type !== 'assistant') return null

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const modelContent = message.content
    if (typeof modelContent === 'string' && modelContent.trim().length > 0) {
        return modelContent
    }

    if (!Array.isArray(modelContent)) return null

    const chunks: string[] = []
    for (const block of modelContent) {
        if (!isObject(block)) continue
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
            chunks.push(block.text)
        }
    }

    return chunks.length > 0 ? chunks.join('\n') : null
}

function extractTextFromCodex(content: Record<string, unknown>): string | null {
    if (content.type !== 'codex') return null
    const data = isObject(content.data) ? content.data : null
    if (!data) return null
    if (data.type === 'message' && typeof data.message === 'string' && data.message.trim().length > 0) {
        return data.message
    }
    return null
}

function extractAssistantText(message: DecryptedMessage): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record || (record.role !== 'assistant' && record.role !== 'agent')) return null

    const content = record.content
    if (typeof content === 'string') {
        return content
    }

    if (!isObject(content)) {
        return null
    }

    if (typeof content.text === 'string' && content.text.trim().length > 0) {
        return content.text
    }

    return extractTextFromClaudeOutput(content) ?? extractTextFromCodex(content)
}

function tryParseJsonArray(raw: string): unknown[] | null {
    const trimmed = raw.trim()
    if (!trimmed) return null

    try {
        const parsed = JSON.parse(trimmed) as unknown
        return Array.isArray(parsed) ? parsed : null
    } catch {
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenced?.[1]) {
        try {
            const parsed = JSON.parse(fenced[1]) as unknown
            return Array.isArray(parsed) ? parsed : null
        } catch {
        }
    }

    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) {
        const slice = trimmed.slice(start, end + 1)
        try {
            const parsed = JSON.parse(slice) as unknown
            return Array.isArray(parsed) ? parsed : null
        } catch {
        }
    }

    return null
}

function coerceSuggestions(rawItems: unknown[]): ImprovementsSuggestion[] {
    const suggestions: ImprovementsSuggestion[] = []

    for (const item of rawItems) {
        if (typeof item === 'string') {
            const title = item.trim()
            if (!title) continue
            suggestions.push({
                title,
                priority: inferSuggestionPriorityFromText(title),
                category: inferSuggestionCategoryFromText(title)
            })
            continue
        }

        const parsed = suggestionSchema.safeParse(item)
        if (!parsed.success) {
            continue
        }

        const title = parsed.data.title.trim()
        if (!title) continue

        const description = parsed.data.description?.trim()
        const priority = normalizeSuggestionPriority(parsed.data.priority)
            ?? inferSuggestionPriorityFromText(title, description)
        const rawCategory = parsed.data.category ?? parsed.data.type ?? parsed.data.kind ?? parsed.data.focus
        const category = normalizeSuggestionCategory(rawCategory)
            ?? inferSuggestionCategoryFromText(title, description)
        const workspacePath = (parsed.data.workspacePath ?? parsed.data.workspace)?.trim()
        const workspaceLabel = parsed.data.workspaceLabel?.trim()

        suggestions.push({
            title,
            description: description || undefined,
            priority,
            category,
            workspacePath: workspacePath || undefined,
            workspaceLabel: workspaceLabel || undefined
        })
    }

    return suggestions
}

function selectBalancedSuggestions(suggestions: ImprovementsSuggestion[], maxSuggestions: number): ImprovementsSuggestion[] {
    const limit = Math.max(0, Math.min(maxSuggestions, suggestions.length))
    if (limit <= 1) {
        return suggestions.slice(0, limit)
    }

    const selected: ImprovementsSuggestion[] = []
    const selectedIndexes = new Set<number>()
    const baseQuota = Math.floor(limit / 2)

    const takeCategory = (category: ImprovementCategory, amount: number) => {
        if (amount <= 0) return
        let taken = 0
        for (let i = 0; i < suggestions.length && taken < amount; i += 1) {
            if (selectedIndexes.has(i)) continue
            const suggestion = suggestions[i]
            if (!suggestion || suggestion.category !== category) continue
            selected.push(suggestion)
            selectedIndexes.add(i)
            taken += 1
        }
    }

    takeCategory('feature', baseQuota)
    takeCategory('architecture', baseQuota)

    for (let i = 0; i < suggestions.length && selected.length < limit; i += 1) {
        if (selectedIndexes.has(i)) continue
        const suggestion = suggestions[i]
        if (!suggestion) continue
        selected.push(suggestion)
        selectedIndexes.add(i)
    }

    return selected
}

export async function waitForAssistantCompletion(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    namespace: string
    afterSeq: number
    timeoutMs: number
    requireAssistantText?: boolean
}): Promise<DecryptedMessage | null> {
    const start = Date.now()
    let lastAssistant: DecryptedMessage | null = null
    const requireAssistantText = options.requireAssistantText ?? true
    let sawAssistantMessage = false

    while (Date.now() - start < options.timeoutMs) {
        const session = options.engine.getSessionByNamespace(options.sessionId, options.namespace)
        if (!session || !session.active) {
            return null
        }

        const stored = options.store.messages.getMessagesAfter(options.sessionId, options.afterSeq, 200)
        for (const msg of stored) {
            const candidate: DecryptedMessage = {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                content: msg.content,
                createdAt: msg.createdAt
            }
            const assistantText = extractAssistantText(candidate)
            if (assistantText) {
                sawAssistantMessage = true
                lastAssistant = candidate
                continue
            }

            const record = unwrapRoleWrappedRecordEnvelope(candidate.content)
            if (record && (record.role === 'assistant' || record.role === 'agent')) {
                sawAssistantMessage = true
                if (!requireAssistantText) {
                    lastAssistant = candidate
                }
            }
        }

        if (requireAssistantText && lastAssistant && !session.thinking) {
            return lastAssistant
        }
        if (!requireAssistantText && sawAssistantMessage && !session.thinking) {
            return lastAssistant
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return null
}

export function selectLatestActiveProjectSession(options: {
    engine: SyncEngine
    namespace: string
    projectId: string
}): Session | null {
    const sessions = options.engine.getSessionsByNamespace(options.namespace)
        .filter((session) => session.active && session.metadata?.projectId === options.projectId)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

    return sessions[0] ?? null
}

export async function runImprovementsScan(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    project: { id: string; name: string; improvementsMaxPendingTasks: number }
    finishedTask: StoredTask
    targetSessionId: string
    maxToCreate: number
    preferredLocale?: string
}): Promise<
    | { ok: true; createdTaskIds: string[] }
    | { ok: false; error: string; rawAssistantText?: string }
> {
    const maxSuggestions = Math.max(0, Math.min(options.maxToCreate, MAX_IMPROVEMENTS_PER_SCAN))
    if (maxSuggestions <= 0) {
        return { ok: true, createdTaskIds: [] }
    }

    const locale = resolvePromptLocale({
        store: options.store,
        targetSessionId: options.targetSessionId,
        preferredLocale: options.preferredLocale
    })
    const workspaces = options.store.workspaces.listWorkspacesByProject(options.project.id)
    const prompt = buildImprovementsPrompt({
        projectName: options.project.name,
        finishedTask: {
            title: options.finishedTask.title,
            description: options.finishedTask.description
        },
        workspaces,
        maxSuggestions,
        locale
    })

    const latest = options.store.messages.getMessages(options.targetSessionId, 1)
    const afterSeq = latest[0]?.seq ?? 0

    const localId = `${IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX}${options.finishedTask.id}:${Date.now()}`

    try {
        await options.engine.sendMessage(options.targetSessionId, {
            text: prompt,
            localId,
            sentFrom: 'webapp'
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send improvements scan prompt'
        return { ok: false, error: message }
    }

    const assistantMessage = await waitForAssistantCompletion({
        store: options.store,
        engine: options.engine,
        sessionId: options.targetSessionId,
        namespace: options.namespace,
        afterSeq,
        timeoutMs: 90_000
    })

    if (!assistantMessage) {
        return { ok: false, error: 'Improvements scan timed out or session inactive' }
    }

    const assistantText = extractAssistantText(assistantMessage)
    if (!assistantText) {
        return { ok: false, error: 'Improvements scan response missing text' }
    }

    const items = tryParseJsonArray(assistantText)
    if (!items) {
        return { ok: false, error: 'Improvements scan response is not valid JSON array', rawAssistantText: assistantText }
    }

    const suggestions = coerceSuggestions(items)
    if (suggestions.length === 0) {
        return { ok: true, createdTaskIds: [] }
    }

    const uniqueSuggestions: ImprovementsSuggestion[] = []
    const seenTitles: Set<string> = new Set()

    for (const suggestion of suggestions) {
        const normalized = normalizeTitle(suggestion.title)
        if (!normalized || seenTitles.has(normalized)) {
            continue
        }
        seenTitles.add(normalized)
        uniqueSuggestions.push(suggestion)
    }

    const selectedSuggestions = selectBalancedSuggestions(uniqueSuggestions, maxSuggestions)
    const createdTaskIds: string[] = []

    for (const suggestion of selectedSuggestions) {
        const workspaceId = mapWorkspaceHintToWorkspaceId(suggestion, workspaces)

        const taskId = randomUUID()
        options.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            title: suggestion.title.trim(),
            description: suggestion.description ?? null,
            status: 'planned',
            priority: suggestion.priority,
            sortKey: Date.now() + createdTaskIds.length,
            workspaceId,
            attachments: undefined,
            source: 'improvements_scan',
            sourceTaskId: options.finishedTask.id
        })

        createdTaskIds.push(taskId)
        options.engine.handleRealtimeEvent({
            type: 'task-added',
            taskId,
            projectId: options.project.id,
            namespace: options.namespace,
            data: { taskId }
        })
    }

    return { ok: true, createdTaskIds }
}
