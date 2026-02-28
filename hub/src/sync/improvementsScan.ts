import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { isObject } from '@hapi/protocol'
import type { DecryptedMessage, Session } from '@hapi/protocol/types'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredTask, StoredWorkspace } from '../store'
import type { SyncEngine } from './syncEngine'

export const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'

const suggestionSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(200_000).optional(),
    workspacePath: z.string().min(1).max(4096).optional(),
    workspaceLabel: z.string().min(1).max(255).optional(),
    workspace: z.string().min(1).max(4096).optional(),
}).passthrough()

export type ImprovementsSuggestion = {
    title: string
    description?: string
    workspacePath?: string
    workspaceLabel?: string
}

function normalizeTitle(value: string): string {
    return value
        .trim()
        .replace(/^\d+[\).\s]+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
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
        '- Do NOT run tools, commands, or code edits.',
        '- Do NOT include markdown fences.',
        '- Output STRICT JSON ONLY: a JSON array of objects.',
        '',
        'JSON schema:',
        '[{"title":"string","description":"string?","workspacePath":"string?","workspaceLabel":"string?"}]',
        '',
        'Rules:',
        '- Return an empty array [] if no good suggestions.',
        '- Keep titles short and actionable.',
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
            suggestions.push({ title })
            continue
        }

        const parsed = suggestionSchema.safeParse(item)
        if (!parsed.success) {
            continue
        }

        const title = parsed.data.title.trim()
        if (!title) continue

        const description = parsed.data.description?.trim()
        const workspacePath = (parsed.data.workspacePath ?? parsed.data.workspace)?.trim()
        const workspaceLabel = parsed.data.workspaceLabel?.trim()

        suggestions.push({
            title,
            description: description || undefined,
            workspacePath: workspacePath || undefined,
            workspaceLabel: workspaceLabel || undefined
        })
    }

    return suggestions
}

async function waitForAssistantCompletion(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    namespace: string
    afterSeq: number
    timeoutMs: number
}): Promise<DecryptedMessage | null> {
    const start = Date.now()
    let lastAssistant: DecryptedMessage | null = null

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
            if (extractAssistantText(candidate)) {
                lastAssistant = {
                    id: msg.id,
                    seq: msg.seq,
                    localId: msg.localId,
                    content: msg.content,
                    createdAt: msg.createdAt
                }
            }
        }

        if (lastAssistant && !session.thinking) {
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
    project: { id: string; name: string; improvementsMaxGeneratedNew: number }
    finishedTask: StoredTask
    targetSessionId: string
    maxToCreate: number
}): Promise<
    | { ok: true; createdTaskIds: string[] }
    | { ok: false; error: string; rawAssistantText?: string }
> {
    const workspaces = options.store.workspaces.listWorkspacesByProject(options.project.id)
    const prompt = buildImprovementsPrompt({
        projectName: options.project.name,
        finishedTask: {
            title: options.finishedTask.title,
            description: options.finishedTask.description
        },
        workspaces,
        maxSuggestions: options.maxToCreate
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

    const createdTaskIds: string[] = []
    const seenTitles: Set<string> = new Set()

    for (const suggestion of suggestions) {
        if (createdTaskIds.length >= options.maxToCreate) {
            break
        }

        const normalized = normalizeTitle(suggestion.title)
        if (!normalized || seenTitles.has(normalized)) {
            continue
        }
        seenTitles.add(normalized)

        const workspaceId = mapWorkspaceHintToWorkspaceId(suggestion, workspaces)

        const taskId = randomUUID()
        options.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            title: suggestion.title.trim(),
            description: suggestion.description ?? null,
            status: 'new',
            priority: null,
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
