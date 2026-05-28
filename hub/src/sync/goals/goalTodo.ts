import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { z } from 'zod'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import {
    getDocsRoot,
    getGoalDocsDir,
    getGoalTodoPath,
    getLegacyTodoMarkdownPath,
    getLegacyTodoYamlPath
} from './goalDocPaths'

export type GoalTodoStatus = 'planning' | 'running' | 'review' | 'blocked' | 'done' | 'unknown'
export type GoalTodoTag = string | null
export type GoalTodoSectionKind = 'ready' | 'candidate' | 'promoted' | 'in_review' | 'blocked' | 'done' | 'unknown'

export type GoalTodoBlocked = {
    kind: string | null
    summary: string | null
    updatedAt: number | null
}

export type GoalTodoDependency = {
    ref: string
}

export type GoalTodoSection = {
    id: string
    status: GoalTodoStatus
    tag: GoalTodoTag
    kind: GoalTodoSectionKind
    title: string
    body: string
    taskId: string | null
    todoRef: string | null
    blocked: GoalTodoBlocked | null
    dependencyTaskList: GoalTodoDependency[]
}

export type GoalTodoResponse = {
    exists: boolean
    path: string | null
    rawYaml: string | null
    parseError: string | null
    sections: GoalTodoSection[]
    updatedAt: number | null
}

type GoalTodoScope = {
    goalId: string
    goalKey?: string | null
}

export type GoalTodoUpdateKind = 'promoted' | 'in_review' | 'blocked' | 'done' | 'planning' | 'running' | 'review'

type GoalTodoYamlItem = {
    id: string
    ref?: string | null
    status: GoalTodoStatus
    tag?: string | null
    title: string
    taskId?: string | null
    body?: string | null
    blocked?: GoalTodoBlocked | null
    dependencyTaskList?: GoalTodoDependency[]
    [key: string]: unknown
}

type GoalTodoYamlGoal = {
    goalKey?: string | null
    goalId?: string | null
    title?: string | null
    items: GoalTodoYamlItem[]
    [key: string]: unknown
}

type GoalTodoYamlDocument = {
    version: 1
    goals: GoalTodoYamlGoal[]
}

class GoalTodoParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'GoalTodoParseError'
    }
}

type GoalTodoParsedProjection = Pick<GoalTodoResponse, 'rawYaml' | 'sections'>

const lastValidProjectionCache = new Map<string, GoalTodoParsedProjection>()

const yamlItemStatusSchema = z.enum(['planning', 'running', 'review', 'blocked', 'done'])
const legacyYamlItemStatusSchema = z.enum(['ready', 'candidate', 'promoted', 'in_review'])
const yamlBlockedSchema = z.object({
    kind: z.string().trim().min(1).nullable().optional(),
    summary: z.string().trim().min(1).nullable().optional(),
    updatedAt: z.number().nullable().optional()
}).passthrough()
const yamlDependencySchema = z.union([
    z.string().trim().min(1),
    z.object({
        ref: z.string().trim().min(1).optional()
    }).passthrough()
])
const yamlItemSchema = z.object({
    id: z.string().trim().min(1).optional(),
    ref: z.string().trim().min(1).nullable().optional(),
    status: z.string().trim().min(1).optional(),
    tag: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).nullable().optional(),
    body: z.string().nullable().optional(),
    blocked: yamlBlockedSchema.nullable().optional(),
    dependencyTaskList: z.array(yamlDependencySchema).optional(),
    notes: z.string().nullable().optional(),
    description: z.string().nullable().optional()
}).passthrough()
const yamlGoalSchema = z.object({
    goalKey: z.string().trim().min(1).nullable().optional(),
    goalId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional(),
    items: z.array(yamlItemSchema).optional()
}).passthrough()
const yamlRootGoalSchema = z.object({
    goalKey: z.string().trim().min(1).nullable().optional(),
    goalId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional()
}).passthrough()
const yamlDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    goal: yamlRootGoalSchema.nullable().optional(),
    items: z.array(yamlItemSchema).optional(),
    goals: z.array(yamlGoalSchema).optional()
}).passthrough()

function normalizeNewlines(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeKey(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

function projectionCacheKey(path: string, scope: GoalTodoScope): string {
    return [
        path,
        normalizeKey(scope.goalKey),
        normalizeKey(scope.goalId)
    ].join('\0')
}

function formatTodoParseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return `todo.yml parse error: ${message}`
}

function normalizeReservoirTag(value: string | null): string | null {
    return value === 'deferred' ? 'candidate' : value
}

function normalizeStatusAndTag(value: unknown, rawTag: unknown): { status: GoalTodoStatus; tag: string | null; kind: GoalTodoSectionKind } {
    const normalizedTag = normalizeReservoirTag(cleanNullableString(rawTag))
    if (typeof value !== 'string') {
        return { status: 'planning', tag: normalizedTag ?? 'candidate', kind: 'candidate' }
    }
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'planned') {
        return { status: 'planning', tag: normalizedTag ?? 'ready', kind: normalizedTag === 'candidate' ? 'candidate' : 'ready' }
    }
    if (normalized === 'in_progress') {
        return { status: 'running', tag: normalizedTag ?? 'promoted', kind: 'promoted' }
    }
    if (normalized === 'in_review' || normalized === 'merging') {
        return { status: 'review', tag: normalizedTag ?? normalized, kind: 'in_review' }
    }
    const statusParsed = yamlItemStatusSchema.safeParse(normalized)
    if (statusParsed.success) {
        return {
            status: statusParsed.data,
            tag: normalizedTag ?? defaultTagForStatus(statusParsed.data),
            kind: kindFromStatusTag(statusParsed.data, normalizedTag)
        }
    }

    const legacyNormalized = normalized === 'active'
        ? 'promoted'
        : normalized === 'review' || normalized === 'inreview'
            ? 'in_review'
            : normalized === 'completed' || normalized === 'complete'
                ? 'done'
                : normalized
    if (legacyNormalized === 'deferred') {
        return { status: 'planning', tag: 'candidate', kind: 'candidate' }
    }
    const legacyParsed = legacyYamlItemStatusSchema.safeParse(legacyNormalized)
    if (legacyParsed.success) {
        const mapped = mapLegacyKindToStatusTag(legacyParsed.data)
        return { ...mapped, tag: normalizedTag ?? mapped.tag, kind: legacyParsed.data }
    }
    if (legacyNormalized === 'done') {
        return { status: 'done', tag: normalizedTag ?? 'accepted', kind: 'done' }
    }
    return { status: 'planning', tag: normalizedTag ?? 'candidate', kind: 'unknown' }
}

function defaultTagForStatus(status: GoalTodoStatus): string | null {
    switch (status) {
        case 'planning':
            return 'candidate'
        case 'running':
            return 'promoted'
        case 'review':
            return 'in_review'
        case 'blocked':
            return 'unknown'
        case 'done':
            return 'accepted'
        case 'unknown':
            return null
    }
}

function kindFromStatusTag(status: GoalTodoStatus, tag: string | null | undefined): GoalTodoSectionKind {
    if (status === 'planning') {
        if (tag === 'ready') return 'ready'
        return 'candidate'
    }
    if (status === 'running') return 'promoted'
    if (status === 'review') return 'in_review'
    if (status === 'blocked') return 'blocked'
    if (status === 'done') return 'done'
    return 'unknown'
}

function mapLegacyKindToStatusTag(kind: Exclude<GoalTodoSectionKind, 'blocked' | 'done' | 'unknown'>): {
    status: GoalTodoStatus
    tag: string
} {
    switch (kind) {
        case 'ready':
        case 'candidate':
            return { status: 'planning', tag: kind }
        case 'promoted':
            return { status: 'running', tag: 'promoted' }
        case 'in_review':
            return { status: 'review', tag: 'in_review' }
    }
}

function normalizeStatus(value: unknown): GoalTodoSectionKind {
    if (typeof value !== 'string') return 'unknown'
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'planning') return 'candidate'
    if (normalized === 'running') return 'promoted'
    if (normalized === 'review') return 'in_review'
    if (normalized === 'active') return 'promoted'
    if (normalized === 'inreview') return 'in_review'
    if (normalized === 'completed' || normalized === 'complete') return 'done'
    if (normalized === 'deferred') return 'candidate'
    const parsed = yamlItemStatusSchema.safeParse(normalized)
    if (parsed.success) return kindFromStatusTag(parsed.data, null)
    if (normalized === 'done') return 'done'
    if (normalized === 'blocked') return 'blocked'
    const legacyParsed = legacyYamlItemStatusSchema.safeParse(normalized)
    return legacyParsed.success ? legacyParsed.data : 'unknown'
}

function cleanNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeYamlItem(item: z.infer<typeof yamlItemSchema>): GoalTodoYamlItem {
    const rawId = cleanNullableString(item.id)
        ?? cleanNullableString(item.ref)
        ?? cleanNullableString(item.taskId)
        ?? cleanNullableString(item.title)
        ?? 'todo'
    const statusAndTag = normalizeStatusAndTag(item.status ?? 'planning', item.tag)
    const blocked = normalizeBlocked(item.blocked)
    return {
        ...item,
        id: rawId,
        ref: cleanNullableString(item.ref),
        status: statusAndTag.status,
        tag: statusAndTag.tag,
        title: cleanNullableString(item.title) ?? rawId,
        taskId: cleanNullableString(item.taskId),
        body: cleanNullableString(item.body ?? item.notes ?? item.description),
        blocked,
        dependencyTaskList: normalizeDependencyTaskList(item.dependencyTaskList)
    }
}

function normalizeYamlGoal(goal: z.infer<typeof yamlGoalSchema>): GoalTodoYamlGoal {
    return {
        ...goal,
        goalKey: cleanNullableString(goal.goalKey),
        goalId: cleanNullableString(goal.goalId),
        title: cleanNullableString(goal.title),
        items: (goal.items ?? []).map(normalizeYamlItem)
    }
}

function getCanonicalGoalTodoYamlPath(defaultWorkspace: StoredWorkspace | null, scope: GoalTodoScope): string | null {
    const docsRoot = getDocsRoot(defaultWorkspace)
    const goalKey = scope.goalKey?.trim() || scope.goalId
    return docsRoot ? getGoalTodoPath(docsRoot, goalKey) : null
}

function goalMatchesScope(goal: Pick<GoalTodoYamlGoal, 'goalId' | 'goalKey'>, scope: GoalTodoScope): boolean {
    const goalId = normalizeKey(goal.goalId)
    const goalKey = normalizeKey(goal.goalKey)
    const scopeGoalId = normalizeKey(scope.goalId)
    const scopeGoalKey = normalizeKey(scope.goalKey)
    return Boolean(
        (goalId && goalId === scopeGoalId)
        || (goalKey && goalKey === scopeGoalKey)
        || (goalKey && goalKey === scopeGoalId)
        || (goalId && scopeGoalKey && goalId === scopeGoalKey)
    )
}

function parseYamlDocument(rawYaml: string): GoalTodoYamlDocument {
    try {
        const parsed = YAML.parse(rawYaml)
        const result = yamlDocumentSchema.safeParse(parsed && typeof parsed === 'object' ? parsed : {})
        if (!result.success) {
            throw new GoalTodoParseError(result.error.issues.map((issue) => issue.message).join('; '))
        }
        const goals: GoalTodoYamlGoal[] = []
        if (result.data.goal || result.data.items) {
            goals.push(normalizeYamlGoal({
                ...(result.data.goal ?? {}),
                items: result.data.items ?? []
            }))
        }
        goals.push(...(result.data.goals ?? []).map(normalizeYamlGoal))
        return {
            version: 1,
            goals
        }
    } catch (error) {
        if (error instanceof GoalTodoParseError) {
            throw error
        }
        throw new GoalTodoParseError(error instanceof Error ? error.message : String(error))
    }
}

function normalizeBlocked(value: unknown): GoalTodoBlocked | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    const record = value as Record<string, unknown>
    const kind = cleanNullableString(record.kind)
    const summary = cleanNullableString(record.summary)
    const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : null
    if (!kind && !summary && updatedAt === null) {
        return null
    }
    return { kind, summary, updatedAt }
}

function normalizeDependencyTaskList(value: unknown): GoalTodoDependency[] {
    if (!Array.isArray(value)) {
        return []
    }
    const dependencies: GoalTodoDependency[] = []
    const seen = new Set<string>()
    for (const entry of value) {
        const ref = typeof entry === 'string'
            ? cleanNullableString(entry)
            : entry && typeof entry === 'object' && !Array.isArray(entry)
                ? cleanNullableString((entry as { ref?: unknown }).ref)
                : null
        if (!ref || seen.has(ref)) {
            continue
        }
        dependencies.push({ ref })
        seen.add(ref)
    }
    return dependencies
}

function cleanYamlItem(item: GoalTodoYamlItem): Record<string, unknown> {
    const next: Record<string, unknown> = {
        ref: item.id,
        status: yamlStatusFromGoalTodoStatus(item.status, item.tag),
        title: item.title
    }
    if (item.body) next.body = item.body
    if (item.dependencyTaskList && item.dependencyTaskList.length > 0) {
        next.dependencyTaskList = item.dependencyTaskList.map((dependency) => ({ ref: dependency.ref }))
    }
    if (item.blocked) next.blocked = item.blocked
    for (const [key, value] of Object.entries(item)) {
        if (['id', 'ref', 'status', 'tag', 'title', 'taskId', 'body', 'blocked', 'dependencyTaskList', 'notes', 'description'].includes(key)) continue
        if (value !== undefined && value !== null) next[key] = value
    }
    return next
}

function yamlStatusFromGoalTodoStatus(status: GoalTodoStatus, tag?: string | null): string {
    switch (status) {
        case 'planning':
            if (tag === 'candidate') return 'candidate'
            return 'planned'
        case 'running':
            return 'in_progress'
        case 'review':
            return tag === 'merging' ? 'merging' : 'in_review'
        case 'blocked':
            if (tag === 'candidate') return 'candidate'
            return 'planned'
        case 'done':
            return 'done'
        case 'unknown':
            return 'candidate'
    }
}

function stringifyYamlDocument(document: GoalTodoYamlDocument): string {
    if (document.goals.length === 1) {
        const goal = document.goals[0]!
        const serializable: Record<string, unknown> = {
            version: 1
        }
        const goalMeta: Record<string, unknown> = {}
        if (goal.goalKey) goalMeta.goalKey = goal.goalKey
        if (goal.goalId) goalMeta.goalId = goal.goalId
        if (goal.title) goalMeta.title = goal.title
        if (Object.keys(goalMeta).length > 0) {
            serializable.goal = goalMeta
        }
        serializable.items = goal.items.map(cleanYamlItem)
        return YAML.stringify(serializable, { lineWidth: 0 }).trimEnd() + '\n'
    }

    const serializable = {
        version: 1,
        goals: document.goals.map((goal) => {
            const next: Record<string, unknown> = {}
            if (goal.goalKey) next.goalKey = goal.goalKey
            if (goal.goalId) next.goalId = goal.goalId
            if (goal.title) next.title = goal.title
            next.items = goal.items.map(cleanYamlItem)
            return next
        })
    }
    return YAML.stringify(serializable, { lineWidth: 0 }).trimEnd() + '\n'
}

function sectionFromYamlItem(item: GoalTodoYamlItem): GoalTodoSection | null {
    const id = item.id.trim()
    const title = item.title.trim()
    if (!id || !title) return null
    return {
        id,
        status: item.status,
        tag: item.tag?.trim() || null,
        kind: kindFromStatusTag(item.status, item.tag),
        title,
        body: item.body?.trim() ?? '',
        taskId: item.taskId?.trim() || id,
        todoRef: id,
        blocked: item.blocked ?? null,
        dependencyTaskList: item.dependencyTaskList ?? []
    }
}

export function parseGoalTodoYaml(rawYaml: string, scope: GoalTodoScope): Pick<GoalTodoResponse, 'rawYaml' | 'parseError' | 'sections'> {
    const normalizedYaml = normalizeNewlines(rawYaml)
    const document = parseYamlDocument(normalizedYaml)
    const goal = document.goals.find((candidate) => goalMatchesScope(candidate, scope))
    return {
        rawYaml: goal ? stringifyYamlDocument({ version: 1, goals: [goal] }) : normalizedYaml,
        parseError: null,
        sections: (goal?.items ?? [])
            .map(sectionFromYamlItem)
            .filter((section): section is GoalTodoSection => Boolean(section))
    }
}

function parseGoalTodoYamlForPath(path: string, rawYaml: string, scope: GoalTodoScope): Pick<GoalTodoResponse, 'rawYaml' | 'parseError' | 'sections'> {
    const cacheKey = projectionCacheKey(path, scope)
    try {
        const parsed = parseGoalTodoYaml(rawYaml, scope)
        lastValidProjectionCache.set(cacheKey, {
            rawYaml: parsed.rawYaml,
            sections: parsed.sections
        })
        return parsed
    } catch (error) {
        const cached = lastValidProjectionCache.get(cacheKey)
        return {
            rawYaml: normalizeNewlines(rawYaml),
            parseError: formatTodoParseError(error),
            sections: cached?.sections ?? []
        }
    }
}

function buildEmptyGoalTodoYaml(input: GoalTodoScope & {
    goalTitle?: string | null
}): string {
    return stringifyYamlDocument({
        version: 1,
        goals: [{
            goalKey: input.goalKey?.trim() || input.goalId,
            goalId: input.goalId,
            title: input.goalTitle?.trim() || null,
            items: []
        }]
    })
}

function selectGoalTodoYaml(rawYaml: string, input: GoalTodoScope & {
    goalTitle?: string | null
}): string {
    const document = parseYamlDocument(rawYaml)
    const goal = document.goals.find((candidate) => goalMatchesScope(candidate, input))
    return goal
        ? stringifyYamlDocument({ version: 1, goals: [goal] })
        : buildEmptyGoalTodoYaml(input)
}

function findOrCreateYamlGoal(document: GoalTodoYamlDocument, input: GoalTodoScope & {
    goalTitle?: string | null
}): GoalTodoYamlGoal {
    const existing = document.goals.find((goal) => goalMatchesScope(goal, input))
    if (existing) return existing

    const created: GoalTodoYamlGoal = {
        goalKey: input.goalKey?.trim() || input.goalId,
        goalId: input.goalId,
        title: input.goalTitle?.trim() || null,
        items: []
    }
    document.goals.push(created)
    return created
}

function findYamlItem(goal: GoalTodoYamlGoal, todoRef: string, taskId: string): GoalTodoYamlItem | null {
    const normalizedRef = normalizeKey(todoRef)
    return goal.items.find((item) => (
        normalizeKey(item.id) === normalizedRef
        || normalizeKey(item.ref) === normalizedRef
        || Boolean(item.taskId && item.taskId === taskId)
    )) ?? null
}

function statusTagFromUpdateKind(kind: GoalTodoUpdateKind): { status: GoalTodoStatus; tag: string | null } {
    switch (kind) {
        case 'promoted':
        case 'running':
            return { status: 'running', tag: 'promoted' }
        case 'in_review':
        case 'review':
            return { status: 'review', tag: 'in_review' }
        case 'blocked':
            return { status: 'blocked', tag: 'unknown' }
        case 'done':
            return { status: 'done', tag: 'accepted' }
        case 'planning':
            return { status: 'planning', tag: 'ready' }
    }
}

export function updateGoalTodoYaml(rawYaml: string, input: GoalTodoScope & {
    goalTitle?: string | null
    todoRef: string
    taskId: string
    kind: GoalTodoUpdateKind
    title?: string | null
}): string {
    const document = parseYamlDocument(rawYaml)
    const goal = findOrCreateYamlGoal(document, input)
    goal.goalKey = input.goalKey?.trim() || goal.goalKey || input.goalId
    goal.goalId = input.goalId
    if (input.goalTitle?.trim()) {
        goal.title = input.goalTitle.trim()
    }
    const todoRef = input.todoRef.trim()
    const taskTitle = input.title?.trim() || todoRef
    const statusTag = statusTagFromUpdateKind(input.kind)
    let item = findYamlItem(goal, todoRef, input.taskId)
    if (!item) {
        item = {
            id: todoRef,
            status: statusTag.status,
            tag: statusTag.tag,
            title: taskTitle
        }
        goal.items.push(item)
    }
    item.id = item.id?.trim() || todoRef
    item.status = statusTag.status
    item.tag = statusTag.tag ?? item.tag ?? null
    if (item.status !== 'blocked') {
        item.blocked = null
    }
    if (!item.title?.trim() || item.title.trim() === item.id || input.title?.trim()) {
        item.title = taskTitle
    }
    return stringifyYamlDocument(document)
}

function classifyLegacyKind(text: string): GoalTodoSectionKind {
    const normalized = text.toLowerCase()
    if (/\bpromoted\b|\bactive\b/.test(normalized)) return 'promoted'
    if (/\bin[_\s-]?review\b/.test(normalized)) return 'in_review'
    if (/\bblocked\b/.test(normalized)) return 'blocked'
    if (/\bdone\b|\bcompleted\b/.test(normalized)) return 'done'
    if (/\bdeferred\b|not ready|later|parked/.test(normalized)) return 'candidate'
    if (/\bready\b/.test(normalized)) return 'ready'
    if (/\bcandidate\b|\breservoir\b|\bbacklog\b/.test(normalized)) return 'candidate'
    return 'unknown'
}

type LegacyTodoLineMetadata = {
    kind: GoalTodoSectionKind | null
    todoRef: string | null
    text: string
}

function parseLegacyTodoRefToken(token: string): string | null {
    const match = /^(?:todoRef|todo-ref|todo_ref)\s*:\s*(.+)$/iu.exec(token.trim())
    const todoRef = match?.[1]?.trim()
    return todoRef || null
}

function sectionFromLegacyTodo(input: {
    kind: GoalTodoSectionKind
    title: string
    body: string
    taskId: string | null
    todoRef: string | null
}): GoalTodoSection {
    const mapped = input.kind === 'unknown'
        ? { status: 'planning' as const, tag: 'candidate' }
        : input.kind === 'blocked'
            ? { status: 'blocked' as const, tag: 'unknown' }
            : input.kind === 'done'
                ? { status: 'done' as const, tag: 'accepted' }
                : mapLegacyKindToStatusTag(input.kind)
    const id = input.todoRef ?? input.taskId ?? input.title
    return {
        id,
        status: mapped.status,
        tag: mapped.tag,
        kind: input.kind,
        title: input.title,
        body: input.body,
        taskId: input.taskId ?? id,
        todoRef: id,
        blocked: null,
        dependencyTaskList: []
    }
}

function parseLeadingLegacyTodoMetadata(text: string): LegacyTodoLineMetadata {
    let remaining = text.trim()
    let kind: GoalTodoSectionKind | null = null
    let todoRef: string | null = null

    while (remaining.startsWith('[')) {
        const match = /^\[([^\]]+)\]\s*/u.exec(remaining)
        if (!match) break

        const token = match[1]!.trim()
        const tokenTodoRef = parseLegacyTodoRefToken(token)
        const tokenKind = tokenTodoRef ? 'unknown' : classifyLegacyKind(token)
        if (tokenKind !== 'unknown') {
            kind = kind ?? tokenKind
            remaining = remaining.slice(match[0].length).trimStart()
            continue
        }
        if (tokenTodoRef) {
            todoRef = tokenTodoRef
            remaining = remaining.slice(match[0].length).trimStart()
            continue
        }
        break
    }

    return { kind, todoRef, text: remaining.trim() }
}

function stripTaskReference(text: string): string {
    return text
        .replace(/\s*(?:->|→)\s*task\s+`?[^`\s]+`?.*$/iu, '')
        .replace(/\s*\(task\s+`?[^`\s)]+`?\).*$/iu, '')
        .trim()
}

function cleanLegacyTitle(text: string): string {
    return stripTaskReference(parseLeadingLegacyTodoMetadata(text).text)
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^#+\s+/, '')
        .replace(/\*\*/g, '')
        .trim()
}

function extractLegacyTaskId(text: string): string | null {
    const backtickMatch = /\btask\s+`([^`]+)`/iu.exec(text)
    if (backtickMatch?.[1]) return backtickMatch[1].trim()
    const plainMatch = /\btask\s+([A-Za-z0-9_-]+)/iu.exec(text)
    return plainMatch?.[1]?.trim() ?? null
}

function headingLevel(line: string): number | null {
    const match = /^(#{1,6})\s+\S/.exec(line)
    return match ? match[1]!.length : null
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function legacyHeadingMatchesGoal(line: string, scope: GoalTodoScope): boolean {
    const goalKey = scope.goalKey?.trim()
    if (goalKey && new RegExp(`\\b${escapeRegExp(goalKey)}\\b`, 'i').test(line)) return true
    return line.toLowerCase().includes(scope.goalId.toLowerCase())
}

function findLegacyGoalScopedRange(markdown: string, scope: GoalTodoScope): { start: number; end: number; markdown: string } | null {
    const lines = markdown.split('\n')
    const goalHeadingIndexes: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
        if (/^##\s+Goal\b/i.test(lines[index] ?? '')) goalHeadingIndexes.push(index)
    }
    if (goalHeadingIndexes.length === 0) {
        return { start: 0, end: lines.length, markdown: markdown.trim() }
    }
    const startHeading = goalHeadingIndexes.find((index) => legacyHeadingMatchesGoal(lines[index] ?? '', scope))
    if (startHeading === undefined) return null
    const endHeading = goalHeadingIndexes.find((index) => index > startHeading) ?? lines.length
    return {
        start: startHeading,
        end: endHeading,
        markdown: lines.slice(startHeading, endHeading).join('\n').trim()
    }
}

function collectLegacyBlock(lines: string[], start: number, stop: (line: string) => boolean): { body: string; nextIndex: number } {
    const bodyLines: string[] = []
    let index = start
    while (index < lines.length) {
        const line = lines[index] ?? ''
        if (stop(line)) break
        bodyLines.push(line)
        index += 1
    }
    return {
        body: bodyLines.join('\n').trim(),
        nextIndex: index
    }
}

export function parseGoalTodoMarkdown(markdown: string, scope: GoalTodoScope): Pick<GoalTodoResponse, 'sections'> {
    const range = findLegacyGoalScopedRange(normalizeNewlines(markdown), scope)
    const rawMarkdown = range?.markdown ?? ''
    const lines = rawMarkdown.split('\n')
    const sections: GoalTodoSection[] = []
    let currentKind: GoalTodoSectionKind = 'unknown'

    let index = 0
    while (index < lines.length) {
        const line = lines[index] ?? ''
        const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
        if (headingMatch) {
            const level = headingMatch[1]!.length
            const headingText = headingMatch[2]!
            if (level <= 3) {
                currentKind = classifyLegacyKind(headingText)
                index += 1
                continue
            }
            const kindFromHeading = classifyLegacyKind(headingText)
            const kind = kindFromHeading === 'unknown' ? currentKind : kindFromHeading
            const collected = collectLegacyBlock(lines, index + 1, (candidate) => {
                const candidateLevel = headingLevel(candidate)
                return candidateLevel !== null && candidateLevel <= level
            })
            const title = cleanLegacyTitle(headingText)
            if (title) {
                const metadata = parseLeadingLegacyTodoMetadata(headingText)
                const joined = `${headingText}\n${collected.body}`
                sections.push(sectionFromLegacyTodo({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractLegacyTaskId(joined),
                    todoRef: metadata.todoRef
                }))
            }
            index = collected.nextIndex
            continue
        }

        const bulletMatch = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
        if (bulletMatch) {
            const indent = bulletMatch[1]!.length
            const text = bulletMatch[2]!
            const metadata = parseLeadingLegacyTodoMetadata(text)
            const kind = metadata.kind ?? currentKind
            const collected = collectLegacyBlock(lines, index + 1, (candidate) => {
                const candidateHeadingLevel = headingLevel(candidate)
                if (candidateHeadingLevel !== null) return true
                const candidateBullet = /^(\s*)[-*]\s+\S/.exec(candidate)
                return Boolean(candidateBullet && candidateBullet[1]!.length <= indent)
            })
            const title = cleanLegacyTitle(text)
            if (title) {
                const joined = `${text}\n${collected.body}`
                sections.push(sectionFromLegacyTodo({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractLegacyTaskId(joined),
                    todoRef: metadata.todoRef
                }))
            }
            index = collected.nextIndex
            continue
        }

        index += 1
    }

    return { sections }
}

function parseLegacyGoalHeading(line: string): { goalKey: string | null; goalId: string | null; title: string | null } {
    const text = line.replace(/^##\s+Goal\s*/i, '').trim()
    const backtick = /`([^`]+)`/.exec(text)
    const token = (backtick?.[1] ?? text.split(/\s+[—-]\s+|\s+/)[0] ?? '').trim()
    const rest = text
        .replace(/`[^`]+`/, '')
        .replace(/^[^\s]+/, '')
        .replace(/^[\s—-]+/, '')
        .trim()
    return {
        goalKey: token || null,
        goalId: token || null,
        title: rest || null
    }
}

function findLegacyGoalScopes(markdown: string): Array<{ scope: GoalTodoScope; title: string | null }> {
    const lines = normalizeNewlines(markdown).split('\n')
    const scopes: Array<{ scope: GoalTodoScope; title: string | null }> = []
    for (const line of lines) {
        if (!/^##\s+Goal\b/i.test(line)) continue
        const parsed = parseLegacyGoalHeading(line)
        const goalKey = parsed.goalKey ?? parsed.goalId ?? 'legacy'
        scopes.push({
            scope: {
                goalId: parsed.goalId ?? goalKey,
                goalKey
            },
            title: parsed.title
        })
    }
    return scopes
}

function uniqueRef(rawRef: string, usedRefs: Set<string>): string {
    const base = rawRef.trim() || 'todo'
    let candidate = base
    let suffix = 2
    while (usedRefs.has(normalizeKey(candidate))) {
        candidate = `${base}-${suffix}`
        suffix += 1
    }
    usedRefs.add(normalizeKey(candidate))
    return candidate
}

export function convertGoalTodoMarkdownToYaml(markdown: string): string {
    const scopes = findLegacyGoalScopes(markdown)
    const targets = scopes.length > 0
        ? scopes
        : [{ scope: { goalId: 'legacy', goalKey: 'legacy' }, title: 'Legacy Todo' }]
    const goals = targets.map(({ scope, title }) => {
        const parsed = parseGoalTodoMarkdown(markdown, scope)
        const usedRefs = new Set<string>()
        const items: GoalTodoYamlItem[] = parsed.sections.map((section) => {
            const ref = uniqueRef(section.todoRef ?? section.title, usedRefs)
            const mapped = section.kind === 'unknown'
                ? { status: 'planning' as const, tag: 'candidate' }
                : section.kind === 'blocked'
                    ? { status: 'blocked' as const, tag: 'unknown' }
                    : section.kind === 'done'
                        ? { status: 'done' as const, tag: 'accepted' }
                        : mapLegacyKindToStatusTag(section.kind)
            return {
                id: ref,
                status: mapped.status,
                tag: mapped.tag,
                title: section.title,
                taskId: section.taskId,
                body: section.body || null
            }
        })
        return {
            goalKey: scope.goalKey,
            goalId: scope.goalId,
            title,
            items
        }
    }).filter((goal) => goal.items.length > 0)
    return stringifyYamlDocument({ version: 1, goals })
}

function readLegacyGoalTodoYaml(input: {
    defaultWorkspace: StoredWorkspace | null
    scope: GoalTodoScope
    goalTitle?: string | null
}): { path: string; rawYaml: string; updatedAt: number } | null {
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    if (!docsRoot) return null

    const legacyYamlPath = getLegacyTodoYamlPath(docsRoot)
    if (existsSync(legacyYamlPath)) {
        return {
            path: legacyYamlPath,
            rawYaml: selectGoalTodoYaml(readFileSync(legacyYamlPath, 'utf8'), {
                ...input.scope,
                goalTitle: input.goalTitle
            }),
            updatedAt: Math.round(statSync(legacyYamlPath).mtimeMs)
        }
    }

    const legacyMarkdownPath = getLegacyTodoMarkdownPath(docsRoot)
    if (!existsSync(legacyMarkdownPath)) return null
    const converted = convertGoalTodoMarkdownToYaml(readFileSync(legacyMarkdownPath, 'utf8'))
    return {
        path: legacyMarkdownPath,
        rawYaml: selectGoalTodoYaml(converted, {
            ...input.scope,
            goalTitle: input.goalTitle
        }),
        updatedAt: Math.round(statSync(legacyMarkdownPath).mtimeMs)
    }
}

function readWritableGoalTodoYaml(input: {
    defaultWorkspace: StoredWorkspace | null
    scope: GoalTodoScope
    goalTitle?: string | null
}): { path: string; rawYaml: string } | null {
    const yamlPath = getCanonicalGoalTodoYamlPath(input.defaultWorkspace, input.scope)
    if (!yamlPath) return null
    if (existsSync(yamlPath)) {
        return { path: yamlPath, rawYaml: readFileSync(yamlPath, 'utf8') }
    }

    const legacy = readLegacyGoalTodoYaml(input)
    return {
        path: yamlPath,
        rawYaml: legacy?.rawYaml ?? buildEmptyGoalTodoYaml({
            ...input.scope,
            goalTitle: input.goalTitle
        })
    }
}

function slugifyTodoId(value: string): string {
    const slug = value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
    return slug || 'task'
}

function createShortIdSuffix(value: string): string {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36).slice(0, 4).padStart(4, '0')
}

export function createGoalTodoTaskId(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    title: string
}): string {
    const scope = {
        goalId: input.goal.id,
        goalKey: input.goal.goalKey
    }
    const writable = readWritableGoalTodoYaml({
        defaultWorkspace: input.defaultWorkspace,
        scope,
        goalTitle: input.goal.title
    })
    let document: GoalTodoYamlDocument
    try {
        document = writable ? parseYamlDocument(writable.rawYaml) : { version: 1 as const, goals: [] }
    } catch {
        document = { version: 1, goals: [] }
    }
    const goal = document.goals.find((candidate) => goalMatchesScope(candidate, scope))
    const used = new Set((goal?.items ?? []).map((item) => normalizeKey(item.id)))
    const base = slugifyTodoId(input.title)
    let candidate = `${base}-${createShortIdSuffix(`${input.goal.id}:${input.title}:${Date.now()}`)}`
    while (used.has(normalizeKey(candidate))) {
        candidate = `${base}-${createShortIdSuffix(`${candidate}:${used.size}:${Date.now()}`)}`
    }
    return candidate
}

export function upsertGoalTodoTaskState(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    taskId: string
    status: GoalTodoStatus
    tag?: string | null
    title?: string | null
    body?: string | null
    blocked?: GoalTodoBlocked | null
}): boolean {
    const taskId = input.taskId.trim()
    if (!taskId) return false

    const scope = {
        goalId: input.goal.id,
        goalKey: input.goal.goalKey
    }
    const writable = readWritableGoalTodoYaml({
        defaultWorkspace: input.defaultWorkspace,
        scope,
        goalTitle: input.goal.title
    })
    if (!writable) return false

    let document: GoalTodoYamlDocument
    try {
        document = parseYamlDocument(writable.rawYaml)
    } catch {
        return false
    }
    const goal = findOrCreateYamlGoal(document, {
        ...scope,
        goalTitle: input.goal.title
    })
    let item = findYamlItem(goal, taskId, taskId)
    if (!item) {
        item = {
            id: taskId,
            status: input.status,
            tag: input.tag ?? defaultTagForStatus(input.status),
            title: input.title?.trim() || taskId
        }
        goal.items.push(item)
    }
    item.id = taskId
    item.status = input.status
    item.tag = input.tag !== undefined ? input.tag : item.tag ?? defaultTagForStatus(input.status)
    if (input.title !== undefined && input.title !== null && input.title.trim()) {
        item.title = input.title.trim()
    }
    if (input.body !== undefined) {
        item.body = input.body?.trim() || null
    }
    item.blocked = input.status === 'blocked'
        ? input.blocked ?? item.blocked ?? null
        : null

    const docsRoot = getDocsRoot(input.defaultWorkspace)
    if (docsRoot) mkdirSync(getGoalDocsDir(docsRoot, input.goal.goalKey), { recursive: true })
    const next = stringifyYamlDocument(document)
    if (next === normalizeNewlines(writable.rawYaml) && existsSync(writable.path)) return false
    writeFileSync(writable.path, next, 'utf8')
    return true
}

export function updateGoalTodoTaskState(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    todoRef: string | null | undefined
    taskId: string
    kind: GoalTodoUpdateKind
    title?: string | null
}): boolean {
    const todoRef = input.todoRef?.trim()
    if (!todoRef) return false

    const scope = {
        goalId: input.goal.id,
        goalKey: input.goal.goalKey
    }
    const writable = readWritableGoalTodoYaml({
        defaultWorkspace: input.defaultWorkspace,
        scope,
        goalTitle: input.goal.title
    })
    if (!writable) return false

    const docsRoot = getDocsRoot(input.defaultWorkspace)
    if (docsRoot) mkdirSync(getGoalDocsDir(docsRoot, input.goal.goalKey), { recursive: true })
    let next: string
    try {
        next = updateGoalTodoYaml(writable.rawYaml, {
            ...scope,
            goalTitle: input.goal.title,
            todoRef,
            taskId: input.taskId,
            kind: input.kind,
            title: input.title
        })
    } catch {
        return false
    }
    if (next === normalizeNewlines(writable.rawYaml) && existsSync(writable.path)) return false
    writeFileSync(writable.path, next, 'utf8')
    return true
}

export function readGoalTodo(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): GoalTodoResponse {
    const scope = {
        goalId: input.goal.id,
        goalKey: input.goal.goalKey
    }
    const canonicalPath = getCanonicalGoalTodoYamlPath(input.defaultWorkspace, scope)
    if (canonicalPath && existsSync(canonicalPath)) {
        const rawYaml = readFileSync(canonicalPath, 'utf8')
        const parsed = parseGoalTodoYamlForPath(canonicalPath, rawYaml, scope)
        return {
            exists: true,
            path: canonicalPath,
            rawYaml: parsed.rawYaml,
            parseError: parsed.parseError,
            sections: parsed.sections,
            updatedAt: Math.round(statSync(canonicalPath).mtimeMs)
        }
    }

    const legacy = readLegacyGoalTodoYaml({
        defaultWorkspace: input.defaultWorkspace,
        scope,
        goalTitle: input.goal.title
    })
    if (!legacy) {
        return {
            exists: false,
            path: canonicalPath,
            rawYaml: null,
            parseError: null,
            sections: [],
            updatedAt: null
        }
    }

    const parsed = parseGoalTodoYamlForPath(legacy.path, legacy.rawYaml, scope)
    return {
        exists: true,
        path: legacy.path,
        rawYaml: parsed.rawYaml,
        parseError: parsed.parseError,
        sections: parsed.sections,
        updatedAt: legacy.updatedAt
    }
}
