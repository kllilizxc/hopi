import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { buildUniqueGoalKey, normalizeGoalKey } from '@hopi/protocol'
import YAML from 'yaml'
import type { Store, StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import { parseGoalTodoMarkdown } from './goalTodo'

export type ParsedGoalDoc = {
    goalKey: string
    title: string
    status: StoredGoal['status']
    autopilotEnabled: boolean
    deployRequiresApproval: boolean
    description: string | null
    successCriteria: string | null
    currentFocus: string | null
    path: string
}

export type GoalDocsImportPreviewItem = {
    goalKey: string
    title: string
    path: string
    existsInDb: boolean
    readyCount: number
    candidateCount: number
    warning: string | null
    parsed: ParsedGoalDoc
}

const IMPORTABLE_STATUSES = new Set<StoredGoal['status']>(['planning', 'active', 'blocked', 'paused'])
const UUID_GOAL_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GENERATED_FALLBACK_GOAL_KEY_PATTERN = /^goal(?:-\d+)?$/

type GoalDocExistingMatch = {
    goal: StoredGoal
    matchType: 'goal_key' | 'legacy_goal_id'
    duplicateGoalByKey: StoredGoal | null
}

type ParsedGoalDocWithPath = {
    path: string
    parsed: ParsedGoalDoc
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
    if (!markdown.startsWith('---\n')) {
        return { frontmatter: {}, body: markdown }
    }
    const end = markdown.indexOf('\n---', 4)
    if (end === -1) {
        return { frontmatter: {}, body: markdown }
    }
    const raw = markdown.slice(4, end)
    const parsed = YAML.parse(raw)
    return {
        frontmatter: parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {},
        body: markdown.slice(end + '\n---'.length).trim()
    }
}

function readSection(body: string, heading: string): string | null {
    const lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase())
    if (start === -1) return null
    const collected: string[] = []
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (/^##\s+/.test(line)) break
        collected.push(line)
    }
    const value = collected.join('\n').trim()
    return value || null
}

function readTitle(body: string, goalKey: string): string {
    const h1 = /^#\s+(.+?)\s*$/m.exec(body)
    return h1?.[1]?.trim() || goalKey
}

function normalizeTitleKey(title: string): string {
    return title.trim().toLocaleLowerCase()
}

function isLegacyUuidGoalKey(goalKey: string): boolean {
    return UUID_GOAL_KEY_PATTERN.test(goalKey)
}

function isGeneratedFallbackGoalKey(goalKey: string): boolean {
    return GENERATED_FALLBACK_GOAL_KEY_PATTERN.test(goalKey)
}

function filterSupersededGeneratedGoalDocs(docs: ParsedGoalDocWithPath[]): ParsedGoalDocWithPath[] {
    const titlesWithLegacyUuidDoc = new Set(
        docs
            .filter((doc) => isLegacyUuidGoalKey(doc.parsed.goalKey))
            .map((doc) => normalizeTitleKey(doc.parsed.title))
    )

    if (titlesWithLegacyUuidDoc.size === 0) {
        return docs
    }

    return docs.filter((doc) => (
        !isGeneratedFallbackGoalKey(doc.parsed.goalKey)
        || !titlesWithLegacyUuidDoc.has(normalizeTitleKey(doc.parsed.title))
    ))
}

function findExistingGoalForDoc(input: {
    store: Store
    project: StoredProject
    namespace: string
    goalKey: string
}): GoalDocExistingMatch | null {
    const byLegacyGoalId = input.store.goals.getGoalByNamespace(input.goalKey, input.namespace)
    const legacyGoal = byLegacyGoalId?.projectId === input.project.id ? byLegacyGoalId : null
    const byGoalKey = input.store.goals.getGoalByGoalKeyAndNamespace(input.project.id, input.namespace, input.goalKey)

    if (legacyGoal && legacyGoal.goalKey !== normalizeGoalKey(input.goalKey)) {
        return {
            goal: legacyGoal,
            matchType: 'legacy_goal_id',
            duplicateGoalByKey: byGoalKey && byGoalKey.id !== legacyGoal.id ? byGoalKey : null
        }
    }

    if (byGoalKey) {
        return {
            goal: byGoalKey,
            matchType: 'goal_key',
            duplicateGoalByKey: null
        }
    }

    return null
}

function buildDuplicateArchiveGoalKey(input: {
    store: Store
    project: StoredProject
    namespace: string
    duplicate: StoredGoal
}): string {
    const used = new Set(
        input.store.goals
            .listGoalsByProjectAndNamespace(input.project.id, input.namespace, { includeArchived: true })
            .filter((goal) => goal.id !== input.duplicate.id)
            .map((goal) => goal.goalKey)
    )
    return buildUniqueGoalKey(
        `${input.duplicate.goalKey}-imported-duplicate`,
        (candidate) => used.has(candidate)
    )
}

function reconcileLegacyGoalDocMatch(input: {
    store: Store
    project: StoredProject
    namespace: string
    goalKey: string
    match: GoalDocExistingMatch
}): StoredGoal | null {
    if (input.match.matchType !== 'legacy_goal_id') {
        return null
    }

    const targetGoalKey = normalizeGoalKey(input.goalKey)
    const duplicate = input.match.duplicateGoalByKey
    if (duplicate && duplicate.id !== input.match.goal.id) {
        input.store.goals.updateGoalByNamespace(duplicate.id, input.namespace, {
            goalKey: buildDuplicateArchiveGoalKey({
                store: input.store,
                project: input.project,
                namespace: input.namespace,
                duplicate
            }),
            archivedAt: duplicate.archivedAt ?? Date.now()
        })
    }

    if (input.match.goal.goalKey === targetGoalKey) {
        return null
    }

    return input.store.goals.updateGoalByNamespace(input.match.goal.id, input.namespace, {
        goalKey: targetGoalKey
    })
}

export function parseGoalDoc(path: string): ParsedGoalDoc {
    const markdown = readFileSync(path, 'utf8')
    const { frontmatter, body } = splitFrontmatter(markdown)
    const filenameKey = basename(path, '.md')
    const goalKey = normalizeGoalKey(typeof frontmatter.goalKey === 'string' ? frontmatter.goalKey : filenameKey)
    const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : readTitle(body, goalKey)
    const rawStatus = typeof frontmatter.status === 'string' ? frontmatter.status : 'planning'
    const status = IMPORTABLE_STATUSES.has(rawStatus as StoredGoal['status'])
        ? rawStatus as StoredGoal['status']
        : 'planning'

    return {
        goalKey,
        title,
        status,
        autopilotEnabled: frontmatter.autopilotEnabled !== false,
        deployRequiresApproval: frontmatter.deployRequiresApproval !== false,
        description: readSection(body, 'Objective'),
        successCriteria: readSection(body, 'Success Criteria'),
        currentFocus: readSection(body, 'Current Focus'),
        path
    }
}

export function buildGoalDocsImportPreview(input: {
    store: Store
    project: StoredProject
    namespace: string
    defaultWorkspace: StoredWorkspace | null
}): { docsRoot: string | null; goals: GoalDocsImportPreviewItem[]; errors: Array<{ path: string; message: string }> } {
    const docsRoot = input.defaultWorkspace?.path ? join(input.defaultWorkspace.path, '.hopi', 'docs') : null
    const goalsRoot = docsRoot ? join(docsRoot, 'goals') : null
    if (!docsRoot || !goalsRoot || !existsSync(goalsRoot)) {
        return { docsRoot, goals: [], errors: [] }
    }

    const todoPath = join(docsRoot, 'todo.md')
    const todoMarkdown = existsSync(todoPath) ? readFileSync(todoPath, 'utf8') : ''
    const goals: GoalDocsImportPreviewItem[] = []
    const errors: Array<{ path: string; message: string }> = []
    const seen = new Set<string>()

    const parsedDocs: ParsedGoalDocWithPath[] = []
    for (const entry of readdirSync(goalsRoot).filter((name) => name.endsWith('.md')).sort()) {
        const path = join(goalsRoot, entry)
        try {
            const parsed = parseGoalDoc(path)
            if (seen.has(parsed.goalKey)) {
                errors.push({ path, message: `Duplicate goalKey: ${parsed.goalKey}` })
                continue
            }
            seen.add(parsed.goalKey)
            parsedDocs.push({ path, parsed })
        } catch (error) {
            errors.push({ path, message: error instanceof Error ? error.message : String(error) })
        }
    }

    for (const { path, parsed } of filterSupersededGeneratedGoalDocs(parsedDocs)) {
        try {
            const existing = findExistingGoalForDoc({
                store: input.store,
                project: input.project,
                namespace: input.namespace,
                goalKey: parsed.goalKey
            })
            const todo = todoMarkdown
                ? parseGoalTodoMarkdown(todoMarkdown, {
                    goalId: existing?.goal.id ?? parsed.goalKey,
                    goalKey: parsed.goalKey
                })
                : { sections: [], rawMarkdown: null }
            goals.push({
                goalKey: parsed.goalKey,
                title: parsed.title,
                path,
                existsInDb: Boolean(existing),
                readyCount: todo.sections.filter((section) => section.kind === 'ready').length,
                candidateCount: todo.sections.filter((section) => section.kind === 'candidate').length,
                warning: existing?.matchType === 'legacy_goal_id'
                    ? 'Matched an existing local Goal by legacy document id; local Goal fields will not be overwritten.'
                    : null,
                parsed
            })
        } catch (error) {
            errors.push({ path, message: error instanceof Error ? error.message : String(error) })
        }
    }

    return { docsRoot, goals, errors }
}

export function importGoalDocs(input: {
    store: Store
    project: StoredProject
    namespace: string
    defaultWorkspace: StoredWorkspace | null
}): {
    imported: Array<{ goalKey: string; goalId: string }>
    updated: Array<{ goalKey: string; goalId: string }>
    skipped: Array<{ goalKey: string; reason: string }>
} {
    const preview = buildGoalDocsImportPreview(input)
    const imported: Array<{ goalKey: string; goalId: string }> = []
    const updated: Array<{ goalKey: string; goalId: string }> = []
    const skipped: Array<{ goalKey: string; reason: string }> = []

    for (const item of preview.goals) {
        const existing = findExistingGoalForDoc({
            store: input.store,
            project: input.project,
            namespace: input.namespace,
            goalKey: item.goalKey
        })
        if (existing) {
            const reconciled = reconcileLegacyGoalDocMatch({
                store: input.store,
                project: input.project,
                namespace: input.namespace,
                goalKey: item.goalKey,
                match: existing
            })
            if (reconciled) {
                updated.push({ goalKey: reconciled.goalKey, goalId: reconciled.id })
            }
            skipped.push({
                goalKey: item.goalKey,
                reason: existing.matchType === 'legacy_goal_id' ? 'legacy_goal_id_exists' : 'already_exists'
            })
            continue
        }

        const goal = input.store.goals.createGoal({
            id: randomUUID(),
            projectId: input.project.id,
            namespace: input.namespace,
            goalKey: item.parsed.goalKey,
            title: item.parsed.title,
            description: item.parsed.description,
            status: item.parsed.status,
            successCriteria: item.parsed.successCriteria,
            autopilotEnabled: item.parsed.autopilotEnabled,
            deployRequiresApproval: item.parsed.deployRequiresApproval,
            currentFocus: item.parsed.currentFocus
        })
        imported.push({ goalKey: goal.goalKey, goalId: goal.id })
    }

    return { imported, updated, skipped }
}
