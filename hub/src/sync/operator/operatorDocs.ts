import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { z } from 'zod'
import { getGlobalPreferencePath, getGoalOperatorDir, getGoalPlannerMailPath, getGoalPreferencesPath } from './operatorDocPaths'

export const GoalPreferenceCategorySchema = z.enum([
    'implementation_tradeoff',
    'ui_product_choice',
    'merge_repair',
    'dependency_choice',
    'test_scope',
    'planning_priority',
    'communication_style'
])
export type GoalPreferenceCategory = z.infer<typeof GoalPreferenceCategorySchema>

export const GoalPreferenceAutonomySchema = z.enum(['auto_decide', 'auto_decide_and_report'])
export type GoalPreferenceAutonomy = z.infer<typeof GoalPreferenceAutonomySchema>

export const PlannerMailKindSchema = z.enum(['idea', 'request', 'preference'])
export type PlannerMailKind = z.infer<typeof PlannerMailKindSchema>

export const PlannerMailStatusSchema = z.enum(['unread', 'included', 'resolved', 'superseded'])
export type PlannerMailStatus = z.infer<typeof PlannerMailStatusSchema>

const OperatorSourceSchema = z.object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    quote: z.string().optional()
})
export type OperatorSource = z.infer<typeof OperatorSourceSchema>

export const GoalPreferenceSchema = z.object({
    id: z.string().min(1),
    category: GoalPreferenceCategorySchema,
    autonomy: GoalPreferenceAutonomySchema,
    instruction: z.string().min(1),
    source: OperatorSourceSchema,
    createdAt: z.number().int().nonnegative(),
    archivedAt: z.number().int().nonnegative().nullable()
})
export type GoalPreference = z.infer<typeof GoalPreferenceSchema>

export const PlannerMailItemSchema = z.object({
    id: z.string().min(1),
    kind: PlannerMailKindSchema,
    body: z.string().min(1),
    source: OperatorSourceSchema,
    status: PlannerMailStatusSchema,
    createdAt: z.number().int().nonnegative(),
    includedAt: z.number().int().nonnegative().nullable(),
    resolvedAt: z.number().int().nonnegative().nullable()
})
export type PlannerMailItem = z.infer<typeof PlannerMailItemSchema>

export const GoalPreferencesDocSchema = z.object({
    version: z.literal(1),
    policies: z.array(GoalPreferenceSchema)
})
export type GoalPreferencesDoc = z.infer<typeof GoalPreferencesDocSchema>

export const GoalPlannerMailDocSchema = z.object({
    version: z.literal(1),
    mail: z.array(PlannerMailItemSchema)
})
export type GoalPlannerMailDoc = z.infer<typeof GoalPlannerMailDocSchema>

export type GoalOperatorDocs = {
    preferences: GoalPreferencesDoc
    mail: GoalPlannerMailDoc
}

const EMPTY_PREFERENCES: GoalPreferencesDoc = { version: 1, policies: [] }
const EMPTY_MAIL: GoalPlannerMailDoc = { version: 1, mail: [] }

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

function readYamlObject(path: string): unknown {
    if (!existsSync(path)) {
        return null
    }
    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) {
        return null
    }
    return YAML.parse(raw)
}

function readPreferencesDoc(path: string): GoalPreferencesDoc {
    const parsed = GoalPreferencesDocSchema.safeParse(readYamlObject(path))
    return parsed.success ? parsed.data : { ...EMPTY_PREFERENCES, policies: [] }
}

function readPlannerMailDoc(path: string): GoalPlannerMailDoc {
    const parsed = GoalPlannerMailDocSchema.safeParse(readYamlObject(path))
    return parsed.success ? parsed.data : { ...EMPTY_MAIL, mail: [] }
}

function writeYamlFile(path: string, value: unknown): void {
    writeFileSync(path, YAML.stringify(value, { lineWidth: 0 }), 'utf8')
}

function ensureOperatorDir(workspacePath: string, goalKey: string): void {
    mkdirSync(getGoalOperatorDir(workspacePath, goalKey), { recursive: true })
}

function id(prefix: string, now: number): string {
    return `${prefix}-${now}-${randomUUID().slice(0, 8)}`
}

export function readGoalOperatorDocs(options: {
    workspacePath: string
    goalKey: string
}): GoalOperatorDocs {
    return {
        preferences: readPreferencesDoc(getGoalPreferencesPath(options.workspacePath, options.goalKey)),
        mail: readPlannerMailDoc(getGoalPlannerMailPath(options.workspacePath, options.goalKey))
    }
}

export function readGlobalPreferenceMarkdown(workspacePath: string): string | null {
    const path = getGlobalPreferencePath(workspacePath)
    if (!existsSync(path)) {
        return null
    }
    const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim()
    return raw.length > 0 ? raw.slice(0, 8_000) : null
}

export function appendPlannerMail(options: {
    workspacePath: string
    goalKey: string
    kind: PlannerMailKind
    body: string
    source: OperatorSource
    now?: number
}): PlannerMailItem {
    const now = options.now ?? Date.now()
    const body = normalizeText(options.body)
    const item: PlannerMailItem = {
        id: id('mail', now),
        kind: options.kind,
        body,
        source: options.source,
        status: 'unread',
        createdAt: now,
        includedAt: null,
        resolvedAt: null
    }

    ensureOperatorDir(options.workspacePath, options.goalKey)
    const path = getGoalPlannerMailPath(options.workspacePath, options.goalKey)
    const doc = readPlannerMailDoc(path)
    writeYamlFile(path, {
        version: 1,
        mail: [...doc.mail, item]
    } satisfies GoalPlannerMailDoc)
    return item
}

export function updatePlannerMailStatus(options: {
    workspacePath: string
    goalKey: string
    mailId: string
    status: PlannerMailStatus
    now?: number
}): boolean {
    const now = options.now ?? Date.now()
    ensureOperatorDir(options.workspacePath, options.goalKey)
    const path = getGoalPlannerMailPath(options.workspacePath, options.goalKey)
    const doc = readPlannerMailDoc(path)
    let changed = false
    const mail = doc.mail.map((item) => {
        if (item.id !== options.mailId) {
            return item
        }
        changed = true
        return {
            ...item,
            status: options.status,
            includedAt: options.status === 'included'
                ? now
                : item.includedAt,
            resolvedAt: options.status === 'resolved' || options.status === 'superseded'
                ? now
                : item.resolvedAt
        } satisfies PlannerMailItem
    })
    if (!changed) {
        return false
    }
    writeYamlFile(path, { version: 1, mail } satisfies GoalPlannerMailDoc)
    return true
}

export function setGoalPreference(options: {
    workspacePath: string
    goalKey: string
    category: GoalPreferenceCategory
    autonomy: GoalPreferenceAutonomy
    instruction: string
    source: OperatorSource
    now?: number
}): GoalPreference {
    const now = options.now ?? Date.now()
    const preference: GoalPreference = {
        id: id('pref', now),
        category: options.category,
        autonomy: options.autonomy,
        instruction: normalizeText(options.instruction),
        source: options.source,
        createdAt: now,
        archivedAt: null
    }

    ensureOperatorDir(options.workspacePath, options.goalKey)
    const path = getGoalPreferencesPath(options.workspacePath, options.goalKey)
    const doc = readPreferencesDoc(path)
    writeYamlFile(path, {
        version: 1,
        policies: [...doc.policies, preference]
    } satisfies GoalPreferencesDoc)
    return preference
}

export function archiveGoalPreference(options: {
    workspacePath: string
    goalKey: string
    preferenceId: string
    now?: number
}): boolean {
    const now = options.now ?? Date.now()
    ensureOperatorDir(options.workspacePath, options.goalKey)
    const path = getGoalPreferencesPath(options.workspacePath, options.goalKey)
    const doc = readPreferencesDoc(path)
    let changed = false
    const policies = doc.policies.map((policy) => {
        if (policy.id !== options.preferenceId) {
            return policy
        }
        changed = true
        return {
            ...policy,
            archivedAt: now
        } satisfies GoalPreference
    })
    if (!changed) {
        return false
    }
    writeYamlFile(path, { version: 1, policies } satisfies GoalPreferencesDoc)
    return true
}
