import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { z } from 'zod'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import {
    getDocsRoot,
    getGoalDocsDir,
    getGoalEventsPath,
    getGoalTodoPath
} from './goalDocPaths'
import { appendGoalWorkflowEvent } from './goalEventLog'

export type GoalTodoStatus = 'planning' | 'running' | 'review' | 'blocked' | 'done' | 'unknown'
export type GoalTodoCanonicalStatus = 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
export type GoalTodoTaskKind = 'planning' | 'engineering'
export type GoalTodoCompatTag = 'candidate' | 'deferred'

export type GoalTodoBlocked = {
    kind: string | null
    summary: string | null
    updatedAt: number | null
}

export type GoalTodoBlockedRef = {
    kind: string | null
    ref: string | null
    summary: string | null
}

export type GoalTodoDependencyRef = {
    ref: string
}

type GoalTodoCanonicalLaneStatus = GoalTodoCanonicalStatus

export type GoalTodoBoardItem = {
    ref: string
    kind: GoalTodoTaskKind
    status: GoalTodoCanonicalStatus
    tag?: GoalTodoCompatTag | null
    title: string
    description: string
    acceptanceCriteria: string[]
    dependencyTaskList: GoalTodoDependencyRef[]
    blockedBy: GoalTodoBlockedRef[]
    taskId: string | null
}

export type GoalTodoBoard = {
    goal: {
        goalKey: string | null
        goalId: string | null
        title: string | null
    }
    items: GoalTodoBoardItem[]
}

export type GoalTodoReadResult = {
    board: GoalTodoBoard
    updatedAt: number | null
}

export type GoalTodoEventOptions = {
    writer?: string
    action?: string
    reason?: string
    metadata?: Record<string, unknown> | null
}

type GoalTodoScope = {
    goalId: string
    goalKey?: string | null
}

type GoalTodoCanonicalYamlDependency = {
    ref: string
}

type GoalTodoCanonicalYamlBlockedRef = {
    kind: string | null
    ref: string | null
    summary: string | null
    [key: string]: unknown
}

type GoalTodoCanonicalYamlItem = {
    ref: string
    kind: GoalTodoTaskKind
    status: GoalTodoCanonicalStatus
    tag?: GoalTodoCompatTag | null
    title: string
    description?: string | null
    acceptanceCriteria?: string[]
    dependencyTaskList?: GoalTodoCanonicalYamlDependency[]
    blockedBy?: GoalTodoCanonicalYamlBlockedRef[]
    taskId?: string | null
    [key: string]: unknown
}

type GoalTodoCanonicalYamlGoal = {
    goalKey?: string | null
    goalId?: string | null
    title?: string | null
}

type GoalTodoCanonicalYamlDocument = {
    format: 'canonical'
    version: 1
    goal: GoalTodoCanonicalYamlGoal
    items: GoalTodoCanonicalYamlItem[]
}

const yamlItemStatusSchema = z.enum(['planning', 'running', 'review', 'blocked', 'done'])
const canonicalYamlItemStatusSchema = z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done'])
const canonicalYamlItemKindSchema = z.enum(['planning', 'engineering'])
const yamlBlockedSchema = z.object({
    kind: z.string().trim().min(1).nullable().optional(),
    summary: z.string().trim().min(1).nullable().optional(),
    updatedAt: z.number().nullable().optional()
}).passthrough()
const canonicalYamlBlockedRefSchema = z.object({
    kind: z.string().trim().min(1).nullable().optional(),
    ref: z.string().trim().min(1).nullable().optional(),
    summary: z.string().trim().min(1).nullable().optional()
}).passthrough()
const canonicalYamlDependencySchema = z.union([
    z.string().trim().min(1),
    z.object({
        ref: z.string().trim().min(1)
    }).passthrough()
])
const canonicalYamlItemSchema = z.object({
    ref: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    dependencyTaskList: z.array(canonicalYamlDependencySchema).optional(),
    blockedBy: z.array(canonicalYamlBlockedRefSchema).optional(),
    blockers: z.array(canonicalYamlBlockedRefSchema).optional(),
    blocked: yamlBlockedSchema.nullable().optional(),
    taskId: z.string().trim().min(1).nullable().optional()
}).passthrough()
const canonicalYamlGoalSchema = z.object({
    goalKey: z.string().trim().min(1).nullable().optional(),
    goalId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional()
}).passthrough()
const canonicalYamlDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    goal: canonicalYamlGoalSchema.optional(),
    items: z.array(canonicalYamlItemSchema).optional()
}).passthrough()
function normalizeNewlines(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeKey(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

function normalizeCanonicalStatus(value: unknown): GoalTodoCanonicalStatus {
    if (typeof value !== 'string') {
        return 'planned'
    }
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    switch (normalized) {
        case 'candidate':
        case 'deferred':
            return 'planned'
        case 'planned':
        case 'planning':
        case 'ready':
            return 'planned'
        case 'running':
        case 'in_progress':
        case 'active':
            return 'in_progress'
        case 'review':
        case 'in_review':
        case 'inreview':
            return 'in_review'
        case 'merging':
            return 'merging'
        case 'blocked':
            return 'planned'
        case 'finished':
        case 'completed':
        case 'complete':
        case 'done':
            return 'done'
        default:
            return 'planned'
    }
}

function normalizePlanningCompatTag(value: unknown): GoalTodoCompatTag | null {
    const normalized = cleanNullableString(value)?.toLowerCase()
    if (normalized === 'candidate' || normalized === 'deferred') {
        return normalized
    }
    return null
}

function normalizeCanonicalTaskKind(value: unknown): GoalTodoTaskKind {
    return typeof value === 'string' && value.trim().toLowerCase() === 'planning'
        ? 'planning'
        : 'engineering'
}

function defaultTagForStatus(status: GoalTodoStatus): string | null {
    switch (status) {
        case 'planning':
            return 'ready'
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

function cleanNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeCanonicalBlockedKind(value: unknown): string | null {
    const normalized = cleanNullableString(value)?.toLowerCase().replace(/[\s-]+/g, '_')
    if (!normalized) {
        return null
    }
    if (normalized === 'decision' || normalized === 'decision_topic') {
        return 'decision'
    }
    if (normalized === 'task' || normalized === 'dependency' || normalized === 'depends_on_task') {
        return 'task'
    }
    if (normalized === 'merge_conflict' || normalized === 'mergeconflict' || normalized === 'conflict') {
        return 'merge_conflict'
    }
    return 'intervention'
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter((item) => item.length > 0)
}

function normalizeCanonicalDependencyTaskList(value: unknown): GoalTodoCanonicalYamlDependency[] {
    if (!Array.isArray(value)) {
        return []
    }
    const dependencies: GoalTodoCanonicalYamlDependency[] = []
    for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
            dependencies.push({ ref: item.trim() })
            continue
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const ref = cleanNullableString((item as Record<string, unknown>).ref)
            if (ref) {
                dependencies.push({ ref })
            }
        }
    }
    return dependencies
}

function normalizeBlockedRef(value: unknown): GoalTodoBlockedRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    const record = value as Record<string, unknown>
    const kind = normalizeCanonicalBlockedKind(record.kind)
    const ref = cleanNullableString(record.ref)
    const summary = cleanNullableString(record.summary)
    if (!kind && !ref && !summary) {
        return null
    }
    return { kind, ref, summary }
}

function normalizeCanonicalBlockedBy(input: {
    blockedBy: unknown
    blockers: unknown
    blocked: unknown
}): GoalTodoCanonicalYamlBlockedRef[] {
    const candidates = Array.isArray(input.blockedBy)
        ? input.blockedBy
        : Array.isArray(input.blockers)
            ? input.blockers
            : []
    const blockedRefs = candidates
        .map(normalizeBlockedRef)
        .filter((item): item is GoalTodoBlockedRef => Boolean(item))
        .map((item) => ({
            kind: item.kind,
            ref: item.ref,
            summary: item.summary
        }))
    if (blockedRefs.length > 0) {
        return blockedRefs
    }

    const legacyBlocked = normalizeBlocked(input.blocked)
    if (!legacyBlocked) {
        return []
    }
    return [{
        kind: legacyBlocked.kind,
        ref: null,
        summary: legacyBlocked.summary
    }]
}

function blockedRefSummary(blocked: GoalTodoBlockedRef): string | null {
    if (blocked.summary) {
        return blocked.summary
    }
    if (blocked.kind && blocked.ref) {
        return `${blocked.kind}: ${blocked.ref}`
    }
    return blocked.ref ?? blocked.kind ?? null
}

function canonicalStatusFromTag(tag: string | null | undefined): GoalTodoCanonicalStatus {
    const normalized = cleanNullableString(tag)?.toLowerCase()
    switch (normalized) {
        case 'candidate':
        case 'deferred':
            return 'planned'
        case 'promoted':
            return 'in_progress'
        case 'in_review':
            return 'in_review'
        case 'merging':
            return 'merging'
        case 'accepted':
            return 'done'
        case 'ready':
        case 'unknown':
        default:
            return 'planned'
    }
}

function resolveBlockedCanonicalStatus(input: {
    tag?: string | null | undefined
    blockedBy?: Array<{ kind: string | null | undefined }> | null
    taskKind?: GoalTodoTaskKind | null | undefined
}): GoalTodoCanonicalLaneStatus {
    const normalizedTag = cleanNullableString(input.tag)
    if (normalizedTag) {
        return canonicalStatusFromTag(normalizedTag)
    }

    const hasMergeConflictBlocker = (input.blockedBy ?? [])
        .some((blocked) => normalizeCanonicalBlockedKind(blocked.kind) === 'merge_conflict')
    if (hasMergeConflictBlocker) {
        return 'merging'
    }

    if (input.taskKind === 'planning') {
        return 'planned'
    }

    return 'planned'
}

function resolveCanonicalStatusForTaskWrite(input: {
    previousStatus: GoalTodoCanonicalStatus | null
    status: GoalTodoStatus
    tag: string | null | undefined
    title: string
}): GoalTodoCanonicalStatus {
    if (input.status !== 'blocked') {
        switch (input.status) {
            case 'running':
                return 'in_progress'
            case 'review':
                return input.tag === 'merging' ? 'merging' : 'in_review'
            case 'done':
                return 'done'
            case 'planning':
            case 'unknown':
            default:
                return 'planned'
        }
    }

    if (input.previousStatus) {
        return input.previousStatus
    }

    return canonicalStatusFromTag(input.tag ?? defaultTagForStatus(input.status))
}

function canonicalItemToBoardItem(item: GoalTodoCanonicalYamlItem): GoalTodoBoardItem {
    return {
        ref: item.ref,
        kind: item.kind,
        status: item.status,
        tag: normalizePlanningCompatTag(item.tag),
        title: item.title,
        description: item.description?.trim() ?? '',
        acceptanceCriteria: [...(item.acceptanceCriteria ?? [])],
        dependencyTaskList: (item.dependencyTaskList ?? []).map((dependency) => ({ ref: dependency.ref })),
        blockedBy: (item.blockedBy ?? []).map((blocked) => ({
            kind: blocked.kind,
            ref: blocked.ref,
            summary: blocked.summary
        })),
        taskId: item.taskId?.trim() || null
    }
}

function getCanonicalGoalTodoYamlPath(defaultWorkspace: StoredWorkspace | null, scope: GoalTodoScope): string | null {
    const docsRoot = getDocsRoot(defaultWorkspace)
    const goalKey = scope.goalKey?.trim() || scope.goalId
    return docsRoot ? getGoalTodoPath(docsRoot, goalKey) : null
}

function goalMatchesScope(goal: {
    goalId?: string | null
    goalKey?: string | null
}, scope: GoalTodoScope): boolean {
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

function parseCanonicalYamlDocument(parsed: unknown): GoalTodoCanonicalYamlDocument | null {
    const result = canonicalYamlDocumentSchema.safeParse(parsed && typeof parsed === 'object' ? parsed : {})
    if (!result.success) {
        return null
    }
    const goal = result.data.goal ?? {}
    const hasCanonicalShape = Boolean(goal && typeof goal === 'object' && Object.keys(goal).length > 0)
        || Array.isArray(result.data.items)
    if (!hasCanonicalShape) {
        return null
    }
    return {
        format: 'canonical',
        version: 1,
        goal: {
            goalKey: cleanNullableString(goal.goalKey),
            goalId: cleanNullableString(goal.goalId),
            title: cleanNullableString(goal.title)
        },
        items: (result.data.items ?? []).map((item) => {
            const ref = cleanNullableString(item.ref)
                ?? cleanNullableString(item.taskId)
                ?? cleanNullableString(item.title)
                ?? 'todo'
            const kind = normalizeCanonicalTaskKind(item.kind)
            const blockedBy = normalizeCanonicalBlockedBy({
                blockedBy: item.blockedBy,
                blockers: item.blockers,
                blocked: item.blocked
            })
            const compatTag = normalizePlanningCompatTag((item as Record<string, unknown>).tag)
            const rawStatus = typeof item.status === 'string'
                ? item.status.trim().toLowerCase().replace(/[\s-]+/g, '_')
                : null
            const normalizedStatus = normalizeCanonicalStatus(item.status)
            return {
                ...item,
                ref,
                kind,
                tag: compatTag ?? (rawStatus === 'candidate' || rawStatus === 'deferred' ? rawStatus : null),
                status: rawStatus === 'blocked'
                    ? resolveBlockedCanonicalStatus({
                        tag: compatTag,
                        blockedBy,
                        taskKind: kind
                    })
                    : normalizedStatus,
                title: cleanNullableString(item.title) ?? ref,
                description: cleanNullableString(item.description ?? item.body),
                acceptanceCriteria: normalizeStringList(item.acceptanceCriteria),
                dependencyTaskList: normalizeCanonicalDependencyTaskList(item.dependencyTaskList),
                blockedBy,
                taskId: cleanNullableString(item.taskId)
            }
        })
    }
}

function normalizeBlocked(value: unknown): GoalTodoBlocked | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    const record = value as Record<string, unknown>
    const kind = normalizeCanonicalBlockedKind(record.kind)
    const summary = cleanNullableString(record.summary)
    const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : null
    if (!kind && !summary && updatedAt === null) {
        return null
    }
    return { kind, summary, updatedAt }
}

function cleanCanonicalYamlItem(item: GoalTodoCanonicalYamlItem): Record<string, unknown> {
    const next: Record<string, unknown> = {
        ref: item.ref,
        kind: item.kind,
        status: item.status,
        title: item.title,
        acceptanceCriteria: item.acceptanceCriteria ?? [],
        dependencyTaskList: (item.dependencyTaskList ?? []).map((dependency) => ({ ref: dependency.ref }))
    }
    if (item.description) next.description = item.description
    const compatTag = normalizePlanningCompatTag(item.tag)
    if (compatTag) next.tag = compatTag
    if (item.taskId?.trim() && item.taskId.trim() !== item.ref) {
        next.taskId = item.taskId.trim()
    }
    if (item.blockedBy && item.blockedBy.length > 0) {
        next.blockedBy = item.blockedBy.map((blocked) => {
            const entry: Record<string, unknown> = {}
            if (blocked.kind) entry.kind = blocked.kind
            if (blocked.ref) entry.ref = blocked.ref
            if (blocked.summary) entry.summary = blocked.summary
            return entry
        })
    }
    return next
}

function stringifyCanonicalYamlDocument(document: GoalTodoCanonicalYamlDocument): string {
    const goal: Record<string, unknown> = {}
    if (document.goal.goalKey) goal.goalKey = document.goal.goalKey
    if (document.goal.goalId) goal.goalId = document.goal.goalId
    if (document.goal.title) goal.title = document.goal.title
    const serializable = {
        version: 1,
        goal,
        items: document.items.map(cleanCanonicalYamlItem)
    }
    return YAML.stringify(serializable, { lineWidth: 0 }).trimEnd() + '\n'
}

type ParsedGoalTodoYaml = {
    board: GoalTodoBoard
}

function buildGoalTodoBoardFromCanonicalDocument(
    document: GoalTodoCanonicalYamlDocument,
    scope: GoalTodoScope & { goalTitle?: string | null }
): GoalTodoBoard {
    const matches = goalMatchesScope(document.goal, scope)
        || (!document.goal.goalKey && normalizeKey(scope.goalKey) !== '')
    if (!matches) {
        return buildFallbackBoard(scope)
    }
    return {
        goal: {
            goalKey: document.goal.goalKey ?? scope.goalKey?.trim() ?? scope.goalId,
            goalId: document.goal.goalId ?? scope.goalId,
            title: document.goal.title ?? scope.goalTitle?.trim() ?? null
        },
        items: document.items.map(canonicalItemToBoardItem)
    }
}

export function parseGoalTodoYaml(rawYaml: string, scope: GoalTodoScope & {
    goalTitle?: string | null
}): ParsedGoalTodoYaml {
    const normalizedYaml = normalizeNewlines(rawYaml)
    try {
        const parsed = YAML.parse(normalizedYaml)
        const canonical = parseCanonicalYamlDocument(parsed)
        if (canonical) {
            return {
                board: buildGoalTodoBoardFromCanonicalDocument(canonical, scope)
            }
        }
    } catch {
    }
    return {
        board: buildFallbackBoard(scope)
    }
}

function findGoalTodoBoardItemForEvent(
    board: GoalTodoBoard,
    ref: string,
    taskId?: string | null
): GoalTodoBoardItem | null {
    return board.items.find((item) => (
        item.ref === ref
        || Boolean(taskId && item.taskId === taskId)
    )) ?? null
}

function summarizeGoalTodoBoardItemForEvent(item: GoalTodoBoardItem | null): Record<string, unknown> | null {
    if (!item) {
        return null
    }

    return {
        ref: item.ref,
        taskId: item.taskId,
        kind: item.kind,
        status: item.status,
        tag: item.tag,
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        dependencyTaskList: item.dependencyTaskList,
        blockedBy: item.blockedBy
    }
}

function appendGoalTodoWorkflowEvent(options: {
    docsRoot: string | null
    goalKey: string
    entityId: string
    before: GoalTodoBoardItem | null
    after: GoalTodoBoardItem | null
    defaultAction: string
    defaultReason: string
    metadata?: Record<string, unknown> | null
    event?: GoalTodoEventOptions
}): void {
    if (!options.docsRoot) {
        return
    }

    appendGoalWorkflowEvent(getGoalEventsPath(options.docsRoot, options.goalKey), {
        writer: options.event?.writer?.trim() || 'hopi-goal-todo',
        action: options.event?.action?.trim() || options.defaultAction,
        entity: {
            type: 'todo_item',
            id: options.entityId
        },
        before: summarizeGoalTodoBoardItemForEvent(options.before),
        after: summarizeGoalTodoBoardItemForEvent(options.after),
        reason: options.event?.reason?.trim() || options.defaultReason,
        metadata: {
            ...(options.metadata ?? {}),
            ...(options.event?.metadata ?? {})
        }
    })
}

function buildEmptyGoalTodoYaml(input: GoalTodoScope & {
    goalTitle?: string | null
}): string {
    return stringifyCanonicalYamlDocument({
        format: 'canonical',
        version: 1,
        goal: {
            goalKey: input.goalKey?.trim() || input.goalId,
            title: input.goalTitle?.trim() || null
        },
        items: []
    })
}

function buildFallbackBoard(input: GoalTodoScope & {
    goalTitle?: string | null
}): GoalTodoBoard {
    return {
        goal: {
            goalKey: input.goalKey?.trim() || input.goalId,
            goalId: input.goalId,
            title: input.goalTitle?.trim() || null
        },
        items: []
    }
}

export function ensureCanonicalGoalTodoYamlAtPath(input: {
    path: string
    scope: GoalTodoScope
    goalTitle?: string | null
}): { rawYaml: string; migrated: boolean } | null {
    if (!existsSync(input.path)) {
        return null
    }

    const rawYaml = readFileSync(input.path, 'utf8')
    try {
        const parsed = YAML.parse(rawYaml)
        const canonical = parseCanonicalYamlDocument(parsed)
        if (canonical) {
            const normalizedCanonical = canonicalizeGoalTodoYaml(rawYaml, {
                ...input.scope,
                goalTitle: input.goalTitle
            })
            if (normalizeNewlines(rawYaml) !== normalizedCanonical) {
                writeFileSync(input.path, normalizedCanonical, 'utf8')
            }
            return {
                rawYaml: normalizedCanonical,
                migrated: normalizeNewlines(rawYaml) !== normalizedCanonical
            }
        }
        return {
            rawYaml,
            migrated: false
        }
    } catch {
        return {
            rawYaml,
            migrated: false
        }
    }
}

export function ensureCanonicalGoalTodoYamlFile(input: {
    defaultWorkspace: StoredWorkspace | null
    scope: GoalTodoScope
    goalTitle?: string | null
}): { path: string; rawYaml: string; migrated: boolean } | null {
    const path = getCanonicalGoalTodoYamlPath(input.defaultWorkspace, input.scope)
    if (!path) {
        return null
    }
    const ensured = ensureCanonicalGoalTodoYamlAtPath({
        path,
        scope: input.scope,
        goalTitle: input.goalTitle
    })
    return ensured
        ? {
            path,
            rawYaml: ensured.rawYaml,
            migrated: ensured.migrated
        }
        : null
}

export function canonicalizeGoalTodoYaml(rawYaml: string, input: GoalTodoScope & {
    goalTitle?: string | null
}): string {
    const normalizedYaml = normalizeNewlines(rawYaml)
    const canonical = parseCanonicalGoalTodoYamlDocument(normalizedYaml)
    canonical.goal.goalKey = canonical.goal.goalKey ?? input.goalKey?.trim() ?? input.goalId
    canonical.goal.goalId = canonical.goal.goalId ?? input.goalId
    canonical.goal.title = canonical.goal.title ?? input.goalTitle?.trim() ?? null
    return stringifyCanonicalYamlDocument(canonical)
}

function parseCanonicalGoalTodoYamlDocument(rawYaml: string): GoalTodoCanonicalYamlDocument {
    try {
        const parsed = YAML.parse(normalizeNewlines(rawYaml))
        const canonical = parseCanonicalYamlDocument(parsed)
        if (canonical) {
            return canonical
        }
    } catch {
    }
    return {
        format: 'canonical',
        version: 1,
        goal: {
            goalKey: null,
            goalId: null,
            title: null
        },
        items: []
    }
}

function findCanonicalYamlItem(document: GoalTodoCanonicalYamlDocument, todoRef: string, taskId: string): GoalTodoCanonicalYamlItem | null {
    const normalizedRef = normalizeKey(todoRef)
    return document.items.find((item) => (
        normalizeKey(item.ref) === normalizedRef
        || Boolean(item.taskId && item.taskId === taskId)
    )) ?? null
}

function readWritableGoalTodoYaml(input: {
    defaultWorkspace: StoredWorkspace | null
    scope: GoalTodoScope
    goalTitle?: string | null
}): { path: string; rawYaml: string } | null {
    const yamlPath = getCanonicalGoalTodoYamlPath(input.defaultWorkspace, input.scope)
    if (!yamlPath) return null
    if (existsSync(yamlPath)) {
        return ensureCanonicalGoalTodoYamlFile(input) ?? { path: yamlPath, rawYaml: readFileSync(yamlPath, 'utf8') }
    }
    return {
        path: yamlPath,
        rawYaml: buildEmptyGoalTodoYaml({
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
    const document = writable ? parseCanonicalGoalTodoYamlDocument(writable.rawYaml) : null
    const used = new Set(
        document?.items.map((item) => normalizeKey(item.ref)) ?? []
    )
    const base = slugifyTodoId(input.title)
    let candidate = `${base}-${createShortIdSuffix(`${input.goal.id}:${input.title}:${Date.now()}`)}`
    while (used.has(normalizeKey(candidate))) {
        candidate = `${base}-${createShortIdSuffix(`${candidate}:${used.size}:${Date.now()}`)}`
    }
    return candidate
}

export function syncGoalTodoMetadata(input: {
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): boolean {
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

    const canonical = parseCanonicalGoalTodoYamlDocument(writable.rawYaml)
    let changed = false
    if (canonical.goal.goalKey !== input.goal.goalKey) {
        canonical.goal.goalKey = input.goal.goalKey
        changed = true
    }
    if (canonical.goal.goalId !== input.goal.id) {
        canonical.goal.goalId = input.goal.id
        changed = true
    }
    if (canonical.goal.title !== input.goal.title) {
        canonical.goal.title = input.goal.title
        changed = true
    }
    if (!changed && existsSync(writable.path)) return false
    writeFileSync(writable.path, stringifyCanonicalYamlDocument(canonical), 'utf8')
    return true
}

export function upsertGoalTodoTaskState(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    taskId: string
    status: GoalTodoStatus
    tag?: string | null
    taskKind?: GoalTodoTaskKind | null
    title?: string | null
    body?: string | null
    blocked?: GoalTodoBlocked | null
    event?: GoalTodoEventOptions
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
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    const beforeParsed = parseGoalTodoYaml(writable.rawYaml, {
        ...scope,
        goalTitle: input.goal.title
    })
    const beforeItem = findGoalTodoBoardItemForEvent(beforeParsed.board, taskId, taskId)

    const canonical = parseCanonicalGoalTodoYamlDocument(writable.rawYaml)
    canonical.goal.goalKey = canonical.goal.goalKey ?? input.goal.goalKey
    canonical.goal.goalId = canonical.goal.goalId ?? input.goal.id
    canonical.goal.title = canonical.goal.title ?? input.goal.title
    let item = findCanonicalYamlItem(canonical, taskId, taskId)
    const previousStatus = item?.status ?? null
    if (!item) {
        item = {
            ref: taskId,
            kind: input.taskKind ?? ((input.tag === 'candidate' || input.tag === 'deferred') ? 'planning' : 'engineering'),
            status: resolveCanonicalStatusForTaskWrite({
                previousStatus: null,
                status: input.status,
                tag: input.tag,
                title: input.title?.trim() || taskId
            }),
            tag: normalizePlanningCompatTag(input.tag),
            title: input.title?.trim() || taskId,
            description: input.body?.trim() || null,
            acceptanceCriteria: [],
            dependencyTaskList: [],
            blockedBy: [],
            taskId
        }
        canonical.items.push(item)
    }
    item.ref = taskId
    item.kind = input.taskKind ?? item.kind ?? ((input.tag === 'candidate' || input.tag === 'deferred') ? 'planning' : 'engineering')
    item.status = resolveCanonicalStatusForTaskWrite({
        previousStatus,
        status: input.status,
        tag: input.tag,
        title: input.title?.trim() || item.title || taskId
    })
    item.taskId = item.taskId?.trim() || taskId
    if (input.title !== undefined && input.title !== null && input.title.trim()) {
        item.title = input.title.trim()
    }
    if (input.body !== undefined) {
        item.description = input.body?.trim() || null
    }
    const compatTag = normalizePlanningCompatTag(input.tag)
    if (item.status !== 'planned' || item.kind !== 'planning') {
        item.tag = null
    } else if (compatTag) {
        item.tag = compatTag
    } else if (!(input.status === 'blocked' && input.tag === undefined)) {
        item.tag = null
    }
    item.blockedBy = input.blocked
        ? [{
            kind: normalizeCanonicalBlockedKind(input.blocked.kind) ?? 'intervention',
            ref: null,
            summary: input.blocked.summary
        }]
        : input.status === 'blocked'
            ? item.blockedBy ?? []
            : []

    const next = stringifyCanonicalYamlDocument(canonical)
    if (next === normalizeNewlines(writable.rawYaml) && existsSync(writable.path)) {
        if (!input.event || !docsRoot) {
            return false
        }
        appendGoalTodoWorkflowEvent({
            docsRoot,
            goalKey: input.goal.goalKey,
            entityId: beforeItem?.ref ?? taskId,
            before: beforeItem,
            after: beforeItem,
            defaultAction: beforeItem ? 'todo_item_synced' : 'todo_item_created',
            defaultReason: beforeItem
                ? 'Recorded todo item workflow activity without changing durable state.'
                : 'Recorded todo item workflow activity without changing durable state.',
            metadata: {
                goalId: input.goal.id,
                projectId: input.project.id,
                taskId,
                source: 'upsertGoalTodoTaskState'
            },
            event: input.event
        })
        return true
    }
    if (docsRoot) mkdirSync(getGoalDocsDir(docsRoot, input.goal.goalKey), { recursive: true })
    writeFileSync(writable.path, next, 'utf8')
    const afterParsed = parseGoalTodoYaml(next, {
        ...scope,
        goalTitle: input.goal.title
    })
    const afterItem = findGoalTodoBoardItemForEvent(afterParsed.board, taskId, taskId)
    appendGoalTodoWorkflowEvent({
        docsRoot,
        goalKey: input.goal.goalKey,
        entityId: afterItem?.ref ?? beforeItem?.ref ?? taskId,
        before: beforeItem,
        after: afterItem,
        defaultAction: beforeItem ? 'todo_item_synced' : 'todo_item_created',
        defaultReason: beforeItem
            ? 'Updated todo item from current task state.'
            : 'Created todo item from current task state.',
        metadata: {
            goalId: input.goal.id,
            projectId: input.project.id,
            taskId,
            source: 'upsertGoalTodoTaskState'
        },
        event: input.event
    })
    return true
}

export function removeGoalTodoTaskState(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    todoRef?: string | null
    taskId: string
    event?: GoalTodoEventOptions
}): boolean {
    const taskId = input.taskId.trim()
    const todoRef = input.todoRef?.trim() || taskId
    if (!taskId || !todoRef) return false

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
    const beforeParsed = parseGoalTodoYaml(writable.rawYaml, {
        ...scope,
        goalTitle: input.goal.title
    })
    const beforeItem = findGoalTodoBoardItemForEvent(beforeParsed.board, todoRef, taskId)
    if (!beforeItem) {
        return false
    }

    const canonical = parseCanonicalGoalTodoYamlDocument(writable.rawYaml)
    const nextItems = canonical.items.filter((item) => !(
        normalizeKey(item.ref) === normalizeKey(todoRef)
        || Boolean(item.taskId && item.taskId === taskId)
    ))
    if (nextItems.length === canonical.items.length) {
        return false
    }
    canonical.items = nextItems
    if (docsRoot) mkdirSync(getGoalDocsDir(docsRoot, input.goal.goalKey), { recursive: true })
    const next = stringifyCanonicalYamlDocument(canonical)
    if (next === normalizeNewlines(writable.rawYaml) && existsSync(writable.path)) return false
    writeFileSync(writable.path, next, 'utf8')
    const afterParsed = parseGoalTodoYaml(next, {
        ...scope,
        goalTitle: input.goal.title
    })
    const afterItem = findGoalTodoBoardItemForEvent(afterParsed.board, todoRef, taskId)
    appendGoalTodoWorkflowEvent({
        docsRoot,
        goalKey: input.goal.goalKey,
        entityId: beforeItem.ref,
        before: beforeItem,
        after: afterItem,
        defaultAction: 'todo_item_removed',
        defaultReason: 'Removed todo item from current task state.',
        metadata: {
            goalId: input.goal.id,
            projectId: input.project.id,
            taskId,
            source: 'removeGoalTodoTaskState'
        },
        event: input.event
    })
    return true
}

export function readGoalTodo(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): GoalTodoReadResult {
    const scope = {
        goalId: input.goal.id,
        goalKey: input.goal.goalKey
    }
    const canonicalPath = getCanonicalGoalTodoYamlPath(input.defaultWorkspace, scope)
    if (canonicalPath && existsSync(canonicalPath)) {
        const ensured = ensureCanonicalGoalTodoYamlFile({
            defaultWorkspace: input.defaultWorkspace,
            scope,
            goalTitle: input.goal.title
        })
        const rawYaml = ensured?.rawYaml ?? readFileSync(canonicalPath, 'utf8')
        const parsed = parseGoalTodoYaml(rawYaml, {
            ...scope,
            goalTitle: input.goal.title
        })
        return {
            board: parsed.board,
            updatedAt: Math.round(statSync(canonicalPath).mtimeMs)
        }
    }
    return {
        board: buildFallbackBoard({
            ...scope,
            goalTitle: input.goal.title
        }),
        updatedAt: null
    }
}
