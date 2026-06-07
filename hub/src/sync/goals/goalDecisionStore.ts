import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import YAML from 'yaml'
import { z } from 'zod'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredWorkspace } from '../../store'
import { getDocsRoot, getGoalDecisionsPath, getGoalEventsPath } from './goalDocPaths'

export type GoalDecisionScope = 'goal' | 'task'

type GoalDecisionDocTopic = {
    id: string
    scope: GoalDecisionScope
    taskId: string | null
    title: string
    body: string
    prompt: string | null
    status: 'waiting' | 'resolved'
    blocking: boolean
    resolution: string | null
    createdAt: number
    updatedAt: number
}

type GoalDecisionsDocument = {
    version: 1
    decisions: GoalDecisionDocTopic[]
    legacyImportedMarkdown?: string
}

const decisionDocumentEnvelopeSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    decisions: z.array(z.unknown()).optional(),
    legacyImportedMarkdown: z.string().optional()
}).passthrough()

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function getTrimmedString(record: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string') {
            const trimmed = value.trim()
            if (trimmed) return trimmed
        }
    }
    return null
}

function parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return null
        const numeric = Number(trimmed)
        if (Number.isFinite(numeric)) {
            return numeric
        }
        const parsed = Date.parse(trimmed)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function normalizeDocTopic(raw: unknown, index: number): GoalDecisionDocTopic {
    const record = asRecord(raw)
    if (!record) {
        throw new Error(`Invalid decisions.yml topic at index ${index}: expected object`)
    }

    const id = getTrimmedString(record, 'id', 'decisionKey')
    if (!id) {
        throw new Error(`Invalid decisions.yml topic at index ${index}: missing id`)
    }

    const title = getTrimmedString(record, 'title', 'summary')
    if (!title) {
        throw new Error(`Invalid decisions.yml topic ${id}: missing title`)
    }

    const body = getTrimmedString(record, 'body', 'prompt', 'summary') ?? title
    const prompt = getTrimmedString(record, 'prompt')
    const taskId = getTrimmedString(record, 'taskId', 'taskRef')
    const rawScope = getTrimmedString(record, 'scope')
    const scope: GoalDecisionScope = rawScope === 'goal' || rawScope === 'task'
        ? rawScope
        : taskId ? 'task' : 'goal'
    const rawStatus = getTrimmedString(record, 'status')
    const status = rawStatus === 'resolved'
        ? 'resolved'
        : rawStatus === 'open'
            ? 'waiting'
            : 'waiting'
    const resolution = getTrimmedString(record, 'resolution', 'answer')
    const createdAt = parseTimestamp(record.createdAt) ?? Date.now()
    const updatedAt = parseTimestamp(record.updatedAt)
        ?? parseTimestamp(record.resolvedAt)
        ?? createdAt

    return {
        id,
        scope,
        taskId: scope === 'task' ? taskId : null,
        title,
        body,
        prompt,
        status,
        blocking: typeof record.blocking === 'boolean' ? record.blocking : true,
        resolution: status === 'resolved' ? (resolution ?? null) : null,
        createdAt,
        updatedAt
    }
}

function emptyGoalDecisionDocument(): GoalDecisionsDocument {
    return {
        version: 1,
        decisions: []
    }
}

function readGoalDecisionDocumentAtPath(path: string): GoalDecisionsDocument {
    if (!existsSync(path)) {
        return emptyGoalDecisionDocument()
    }

    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) {
        return emptyGoalDecisionDocument()
    }

    const parsed = decisionDocumentEnvelopeSchema.safeParse(YAML.parse(raw))
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
            .join(', ')
        throw new Error(`Invalid decisions.yml format: ${issues}`)
    }

    return {
        version: 1,
        decisions: (parsed.data.decisions ?? []).map((item, index) => normalizeDocTopic(item, index)),
        legacyImportedMarkdown: parsed.data.legacyImportedMarkdown
    }
}

function writeGoalDecisionDocumentAtPath(path: string, document: GoalDecisionsDocument): void {
    mkdirSync(dirname(path), { recursive: true })
    const tmpPath = `${path}.tmp.${randomUUID()}`
    const payload = {
        version: 1,
        ...(document.legacyImportedMarkdown
            ? { legacyImportedMarkdown: document.legacyImportedMarkdown }
            : {}),
        decisions: document.decisions.map((topic) => ({
            id: topic.id,
            scope: topic.scope,
            taskId: topic.taskId,
            title: topic.title,
            body: topic.body,
            ...(topic.prompt ? { prompt: topic.prompt } : {}),
            status: topic.status,
            blocking: topic.blocking,
            resolution: topic.resolution,
            createdAt: topic.createdAt,
            updatedAt: topic.updatedAt
        }))
    }
    writeFileSync(tmpPath, YAML.stringify(payload, {
        indent: 4,
        lineWidth: 0
    }), 'utf8')
    renameSync(tmpPath, path)
}

function appendGoalDecisionEvent(path: string, input: {
    writer: string
    action: 'decision_created' | 'decision_resolved'
    entityId: string
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    reason: string
    metadata?: Record<string, unknown>
}): void {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        writer: input.writer,
        action: input.action,
        entity: {
            type: 'decision',
            id: input.entityId
        },
        before: input.before,
        after: input.after,
        reason: input.reason,
        metadata: input.metadata ?? null
    })}\n`, 'utf8')
}

function toStoredGoalDecisionTopic(topic: GoalDecisionDocTopic, projectId: string, goalId: string): StoredGoalDecisionTopic {
    return {
        id: topic.id,
        projectId,
        goalId,
        scope: topic.scope,
        taskId: topic.taskId,
        title: topic.title,
        body: topic.body,
        prompt: topic.prompt,
        status: topic.status,
        blocking: topic.blocking,
        resolution: topic.resolution,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt
    }
}

function sortTopics(topics: StoredGoalDecisionTopic[]): StoredGoalDecisionTopic[] {
    return [...topics].sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
            return right.updatedAt - left.updatedAt
        }
        return right.createdAt - left.createdAt
    })
}

function resolveDocsRoot(defaultWorkspace: StoredWorkspace | null): string | null {
    return getDocsRoot(defaultWorkspace)
}

export function readGoalDecisionDocument(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): GoalDecisionsDocument {
    const docsRoot = resolveDocsRoot(input.defaultWorkspace)
    if (!docsRoot) {
        return emptyGoalDecisionDocument()
    }

    const decisionPath = getGoalDecisionsPath(docsRoot, input.goal.goalKey)
    return readGoalDecisionDocumentAtPath(decisionPath)
}

export function listGoalDecisionTopicsFromDocs(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): StoredGoalDecisionTopic[] {
    return sortTopics(readGoalDecisionDocument(input).decisions.map((topic) => (
        toStoredGoalDecisionTopic(topic, input.project.id, input.goal.id)
    )))
}

export function createGoalDecisionTopicInDocs(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    id: string
    taskId?: string | null
    title: string
    body: string
    blocking?: boolean
    prompt?: string | null
    writer: string
    reason: string
}): StoredGoalDecisionTopic {
    const docsRoot = resolveDocsRoot(input.defaultWorkspace)
    if (!docsRoot) {
        throw new Error('Workspace docs root unavailable')
    }
    const decisionPath = getGoalDecisionsPath(docsRoot, input.goal.goalKey)
    const eventsPath = getGoalEventsPath(docsRoot, input.goal.goalKey)
    const document = readGoalDecisionDocument({
        project: input.project,
        goal: input.goal,
        defaultWorkspace: input.defaultWorkspace
    })
    if (document.decisions.some((topic) => topic.id === input.id)) {
        throw new Error(`Decision topic already exists: ${input.id}`)
    }

    const now = Date.now()
    const topic: GoalDecisionDocTopic = {
        id: input.id,
        scope: input.taskId ? 'task' : 'goal',
        taskId: input.taskId ?? null,
        title: input.title.trim(),
        body: input.body,
        prompt: input.prompt?.trim() || null,
        status: 'waiting',
        blocking: input.blocking ?? true,
        resolution: null,
        createdAt: now,
        updatedAt: now
    }
    const next: GoalDecisionsDocument = {
        ...document,
        decisions: [...document.decisions, topic]
    }
    writeGoalDecisionDocumentAtPath(decisionPath, next)
    appendGoalDecisionEvent(eventsPath, {
        writer: input.writer,
        action: 'decision_created',
        entityId: topic.id,
        before: null,
        after: {
            scope: topic.scope,
            taskId: topic.taskId,
            title: topic.title,
            status: topic.status,
            blocking: topic.blocking
        },
        reason: input.reason,
        metadata: {
            projectId: input.project.id,
            goalId: input.goal.id
        }
    })
    return toStoredGoalDecisionTopic(topic, input.project.id, input.goal.id)
}

export function resolveGoalDecisionTopicInDocs(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    topicId: string
    resolution: string
    writer: string
    reason: string
}): StoredGoalDecisionTopic | null {
    const docsRoot = resolveDocsRoot(input.defaultWorkspace)
    if (!docsRoot) {
        throw new Error('Workspace docs root unavailable')
    }
    const decisionPath = getGoalDecisionsPath(docsRoot, input.goal.goalKey)
    const eventsPath = getGoalEventsPath(docsRoot, input.goal.goalKey)
    const document = readGoalDecisionDocument({
        project: input.project,
        goal: input.goal,
        defaultWorkspace: input.defaultWorkspace
    })
    const index = document.decisions.findIndex((topic) => topic.id === input.topicId)
    if (index < 0) {
        return null
    }

    const previous = document.decisions[index]!
    const resolved: GoalDecisionDocTopic = {
        ...previous,
        status: 'resolved',
        resolution: input.resolution.trim(),
        updatedAt: Date.now()
    }
    const next: GoalDecisionsDocument = {
        ...document,
        decisions: document.decisions.map((topic, topicIndex) => topicIndex === index ? resolved : topic)
    }
    writeGoalDecisionDocumentAtPath(decisionPath, next)
    appendGoalDecisionEvent(eventsPath, {
        writer: input.writer,
        action: 'decision_resolved',
        entityId: resolved.id,
        before: {
            status: previous.status,
            resolution: previous.resolution
        },
        after: {
            status: resolved.status,
            resolution: resolved.resolution
        },
        reason: input.reason,
        metadata: {
            projectId: input.project.id,
            goalId: input.goal.id
        }
    })
    return toStoredGoalDecisionTopic(resolved, input.project.id, input.goal.id)
}

export function findGoalDecisionTopicContext(input: {
    store: Store
    namespace: string
    topicId: string
    includeArchived?: boolean
}): {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    topic: StoredGoalDecisionTopic
} | null {
    const projects = input.store.projects.listProjectsByNamespace(input.namespace, {
        includeArchived: Boolean(input.includeArchived)
    })
    for (const project of projects) {
        const goals = input.store.goals.listGoalsByProjectAndNamespace(project.id, input.namespace, {
            includeArchived: Boolean(input.includeArchived)
        })
        const defaultWorkspace = project.defaultWorkspaceId
            ? input.store.workspaces.getWorkspace(project.defaultWorkspaceId)
            : input.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
        for (const goal of goals) {
            const topic = listGoalDecisionTopicsFromDocs({
                project,
                goal,
                defaultWorkspace
            }).find((candidate) => candidate.id === input.topicId)
            if (topic) {
                return {
                    project,
                    goal,
                    defaultWorkspace,
                    topic
                }
            }
        }
    }
    return null
}
