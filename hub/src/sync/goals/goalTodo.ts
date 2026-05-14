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

export type GoalTodoSectionKind = 'ready' | 'candidate' | 'promoted' | 'in_review' | 'blocked' | 'deferred' | 'done' | 'unknown'

export type GoalTodoDependencyTask = {
    ref: string | null
    taskId: string | null
    title: string | null
}

export type GoalTodoSection = {
    kind: GoalTodoSectionKind
    title: string
    body: string
    taskId: string | null
    todoRef: string | null
    dependencyTaskList: GoalTodoDependencyTask[]
}

export type GoalTodoResponse = {
    exists: boolean
    path: string | null
    rawYaml: string | null
    sections: GoalTodoSection[]
    updatedAt: number | null
}

type GoalTodoScope = {
    goalId: string
    goalKey?: string | null
}

export type GoalTodoUpdateKind = 'promoted' | 'in_review' | 'blocked' | 'done'

type GoalTodoYamlItem = {
    ref: string
    status: GoalTodoSectionKind
    title: string
    taskId?: string | null
    body?: string | null
    dependencyTaskList?: GoalTodoDependencyTask[]
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

const yamlItemStatusSchema = z.enum(['ready', 'candidate', 'promoted', 'in_review', 'blocked', 'deferred', 'done'])
const yamlItemSchema = z.object({
    ref: z.string().trim().min(1),
    status: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).nullable().optional(),
    body: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    description: z.string().nullable().optional()
}).passthrough()
const yamlGoalSchema = z.object({
    goalKey: z.string().trim().min(1).nullable().optional(),
    goalId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).nullable().optional(),
    items: z.array(yamlItemSchema).optional()
}).passthrough()
const yamlDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    goals: z.array(yamlGoalSchema).optional()
}).passthrough()

function normalizeNewlines(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeKey(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

function normalizeStatus(value: unknown): GoalTodoSectionKind {
    if (typeof value !== 'string') return 'unknown'
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'active') return 'promoted'
    if (normalized === 'review' || normalized === 'inreview') return 'in_review'
    if (normalized === 'completed' || normalized === 'complete') return 'done'
    const parsed = yamlItemStatusSchema.safeParse(normalized)
    return parsed.success ? parsed.data : 'unknown'
}

function cleanNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeDependencyTaskList(value: unknown): GoalTodoDependencyTask[] {
    if (!Array.isArray(value)) return []
    const dependencies: GoalTodoDependencyTask[] = []
    const seen = new Set<string>()
    for (const item of value) {
        const dependency = typeof item === 'string'
            ? { ref: cleanNullableString(item), taskId: null, title: null }
            : item && typeof item === 'object' && !Array.isArray(item)
                ? {
                    ref: cleanNullableString((item as Record<string, unknown>).ref),
                    taskId: cleanNullableString((item as Record<string, unknown>).taskId),
                    title: cleanNullableString((item as Record<string, unknown>).title)
                }
                : null
        if (!dependency || (!dependency.ref && !dependency.taskId)) continue
        const key = `${dependency.ref ?? ''}\0${dependency.taskId ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        dependencies.push(dependency)
    }
    return dependencies
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
            return { version: 1, goals: [] }
        }
        return {
            version: 1,
            goals: (result.data.goals ?? []).map((goal) => ({
                ...goal,
                goalKey: cleanNullableString(goal.goalKey),
                goalId: cleanNullableString(goal.goalId),
                title: cleanNullableString(goal.title),
                items: (goal.items ?? []).map((item) => ({
                    ...item,
                    ref: item.ref.trim(),
                    status: normalizeStatus(item.status ?? 'candidate'),
                    title: cleanNullableString(item.title) ?? item.ref.trim(),
                    taskId: cleanNullableString(item.taskId),
                    body: cleanNullableString(item.body ?? item.notes ?? item.description),
                    dependencyTaskList: normalizeDependencyTaskList(item.dependencyTaskList)
                }))
            }))
        }
    } catch {
        return { version: 1, goals: [] }
    }
}

function cleanYamlItem(item: GoalTodoYamlItem): Record<string, unknown> {
    const next: Record<string, unknown> = {
        ref: item.ref,
        status: item.status,
        title: item.title
    }
    if (item.taskId) next.taskId = item.taskId
    if (item.body) next.body = item.body
    if (item.dependencyTaskList && item.dependencyTaskList.length > 0) next.dependencyTaskList = item.dependencyTaskList
    for (const [key, value] of Object.entries(item)) {
        if (['ref', 'status', 'title', 'taskId', 'body', 'notes', 'description', 'dependencyTaskList'].includes(key)) continue
        if (value !== undefined && value !== null) next[key] = value
    }
    return next
}

function stringifyYamlDocument(document: GoalTodoYamlDocument): string {
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
    const ref = item.ref.trim()
    const title = item.title.trim()
    if (!ref || !title) return null
    return {
        kind: item.status,
        title,
        body: item.body?.trim() ?? '',
        taskId: item.taskId?.trim() || null,
        todoRef: ref,
        dependencyTaskList: item.dependencyTaskList ?? []
    }
}

export function parseGoalTodoYaml(rawYaml: string, scope: GoalTodoScope): Pick<GoalTodoResponse, 'rawYaml' | 'sections'> {
    const normalizedYaml = normalizeNewlines(rawYaml)
    const document = parseYamlDocument(normalizedYaml)
    const goal = document.goals.find((candidate) => goalMatchesScope(candidate, scope))
    return {
        rawYaml: goal ? stringifyYamlDocument({ version: 1, goals: [goal] }) : normalizedYaml,
        sections: (goal?.items ?? [])
            .map(sectionFromYamlItem)
            .filter((section): section is GoalTodoSection => Boolean(section))
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
        normalizeKey(item.ref) === normalizedRef
        || Boolean(item.taskId && item.taskId === taskId)
    )) ?? null
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
    const todoRef = input.todoRef.trim()
    const taskTitle = input.title?.trim() || todoRef
    let item = findYamlItem(goal, todoRef, input.taskId)
    if (!item) {
        item = {
            ref: todoRef,
            status: input.kind,
            title: taskTitle
        }
        goal.items.push(item)
    }
    item.ref = item.ref?.trim() || todoRef
    item.status = input.kind
    item.taskId = input.taskId
    if (!item.title?.trim() || item.title.trim() === item.ref || input.title?.trim()) {
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
    if (/\bdeferred\b|not ready|later|parked/.test(normalized)) return 'deferred'
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
                sections.push({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractLegacyTaskId(joined),
                    todoRef: metadata.todoRef,
                    dependencyTaskList: []
                })
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
                sections.push({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractLegacyTaskId(joined),
                    todoRef: metadata.todoRef,
                    dependencyTaskList: []
                })
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
            const status = section.kind === 'unknown' ? 'candidate' : section.kind
            return {
                ref,
                status,
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
    const next = updateGoalTodoYaml(writable.rawYaml, {
        ...scope,
        goalTitle: input.goal.title,
        todoRef,
        taskId: input.taskId,
        kind: input.kind,
        title: input.title
    })
    if (next === normalizeNewlines(writable.rawYaml)) return false
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
        const parsed = parseGoalTodoYaml(rawYaml, scope)
        return {
            exists: true,
            path: canonicalPath,
            rawYaml: parsed.rawYaml,
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
            sections: [],
            updatedAt: null
        }
    }

    const parsed = parseGoalTodoYaml(legacy.rawYaml, scope)
    return {
        exists: true,
        path: legacy.path,
        rawYaml: parsed.rawYaml,
        sections: parsed.sections,
        updatedAt: legacy.updatedAt
    }
}
