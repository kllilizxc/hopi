import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import YAML from 'yaml'
import { z } from 'zod'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredWorkspace } from '../../store'
import { getDocsRoot, getGoalDecisionsPath } from './goalDocPaths'

type GoalDecisionScope = {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}

type GoalDecisionDocument = {
    version: 1
    legacyDecisionTopicsBackfilledAt: number | null
    topics: StoredGoalDecisionTopic[]
}

export type GoalDecisionTopicLocation = GoalDecisionScope & {
    topic: StoredGoalDecisionTopic
}

const decisionStatusSchema = z.enum(['waiting', 'resolved'])
const decisionScopeSchema = z.enum(['goal', 'task'])
const decisionTopicSchema = z.object({
    id: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    goalId: z.string().trim().min(1).nullable().optional(),
    scope: decisionScopeSchema.optional(),
    taskId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1).optional(),
    body: z.string().nullable().optional(),
    status: decisionStatusSchema.optional(),
    blocking: z.boolean().optional(),
    resolution: z.string().nullable().optional(),
    createdAt: z.number().nullable().optional(),
    updatedAt: z.number().nullable().optional()
}).passthrough()
const decisionDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    legacyDecisionTopicsBackfilledAt: z.number().nullable().optional(),
    topics: z.array(decisionTopicSchema).optional()
}).passthrough()

function cleanNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function cleanNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeScope(scope: unknown, taskId: string | null): StoredGoalDecisionTopic['scope'] {
    if (scope === 'goal' || scope === 'task') {
        return scope
    }
    return taskId ? 'task' : 'goal'
}

function normalizeStoredTopic(topic: StoredGoalDecisionTopic): StoredGoalDecisionTopic {
    return {
        ...topic,
        taskId: topic.scope === 'task' ? topic.taskId : null
    }
}

function getGoalDecisionPath(input: GoalDecisionScope): string | null {
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    return docsRoot ? getGoalDecisionsPath(docsRoot, input.goal.goalKey) : null
}

function normalizeTopic(
    topic: z.infer<typeof decisionTopicSchema>,
    input: GoalDecisionScope,
    fallbackTimestamp: number
): StoredGoalDecisionTopic | null {
    const id = cleanNullableString(topic.id)
    const title = cleanNullableString(topic.title)
    if (!id || !title) {
        return null
    }
    const taskId = cleanNullableString(topic.taskId)
    const scope = normalizeScope(topic.scope, taskId)
    return {
        id,
        projectId: cleanNullableString(topic.projectId) ?? input.project.id,
        goalId: cleanNullableString(topic.goalId) ?? input.goal.id,
        scope,
        taskId: scope === 'task' ? taskId : null,
        title,
        body: typeof topic.body === 'string' ? topic.body : '',
        status: topic.status === 'resolved' ? 'resolved' : 'waiting',
        blocking: topic.blocking ?? true,
        resolution: cleanNullableString(topic.resolution),
        createdAt: cleanNumber(topic.createdAt, fallbackTimestamp),
        updatedAt: cleanNumber(topic.updatedAt, fallbackTimestamp)
    }
}

function parseDecisionDocument(rawYaml: string, input: GoalDecisionScope): GoalDecisionDocument {
    try {
        const parsed = YAML.parse(rawYaml)
        const result = decisionDocumentSchema.safeParse(parsed && typeof parsed === 'object' ? parsed : {})
        if (!result.success) {
            return { version: 1, legacyDecisionTopicsBackfilledAt: null, topics: [] }
        }
        const fallbackTimestamp = Date.now()
        return {
            version: 1,
            legacyDecisionTopicsBackfilledAt: cleanNullableNumber(result.data.legacyDecisionTopicsBackfilledAt),
            topics: (result.data.topics ?? [])
                .map((topic) => normalizeTopic(topic, input, fallbackTimestamp))
                .filter((topic): topic is StoredGoalDecisionTopic => Boolean(topic))
        }
    } catch {
        return { version: 1, legacyDecisionTopicsBackfilledAt: null, topics: [] }
    }
}

function serializeTopic(topic: StoredGoalDecisionTopic): Record<string, unknown> {
    return {
        id: topic.id,
        projectId: topic.projectId,
        goalId: topic.goalId,
        scope: topic.scope,
        taskId: topic.scope === 'task' ? topic.taskId : null,
        title: topic.title,
        body: topic.body,
        status: topic.status,
        blocking: topic.blocking,
        resolution: topic.resolution,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt
    }
}

function stringifyDecisionDocument(document: GoalDecisionDocument): string {
    return YAML.stringify({
        version: 1,
        ...(document.legacyDecisionTopicsBackfilledAt !== null
            ? { legacyDecisionTopicsBackfilledAt: document.legacyDecisionTopicsBackfilledAt }
            : {}),
        topics: document.topics.map(serializeTopic)
    }, { lineWidth: 0 }).trimEnd() + '\n'
}

function ensureDecisionDocument(input: GoalDecisionScope): { path: string; document: GoalDecisionDocument } | null {
    const path = getGoalDecisionPath(input)
    if (!path) {
        return null
    }
    if (!existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, 'version: 1\ntopics: []\n', 'utf8')
    }
    return {
        path,
        document: parseDecisionDocument(readFileSync(path, 'utf8'), input)
    }
}

function writeDecisionDocument(path: string, document: GoalDecisionDocument): void {
    writeFileSync(path, stringifyDecisionDocument(document), 'utf8')
}

export function readGoalDecisionTopics(input: GoalDecisionScope): StoredGoalDecisionTopic[] {
    const state = ensureDecisionDocument(input)
    if (!state) {
        return []
    }
    return sortGoalDecisionTopics(state.document.topics)
}

function sortGoalDecisionTopics(topics: StoredGoalDecisionTopic[]): StoredGoalDecisionTopic[] {
    return [...topics].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function backfillLegacyGoalDecisionTopicsToDocs(input: GoalDecisionScope & {
    legacyTopics: StoredGoalDecisionTopic[]
}): StoredGoalDecisionTopic[] {
    const state = ensureDecisionDocument(input)
    if (!state) {
        return []
    }
    if (state.document.legacyDecisionTopicsBackfilledAt !== null) {
        return sortGoalDecisionTopics(state.document.topics)
    }
    const existingIds = new Set(state.document.topics.map((topic) => topic.id))
    let changed = false
    for (const topic of input.legacyTopics) {
        const normalized = normalizeStoredTopic(topic)
        if (existingIds.has(normalized.id)) {
            continue
        }
        state.document.topics.push(normalized)
        existingIds.add(normalized.id)
        changed = true
    }
    if (input.legacyTopics.length > 0) {
        state.document.legacyDecisionTopicsBackfilledAt = Date.now()
        changed = true
    }
    if (changed) {
        writeDecisionDocument(state.path, state.document)
    }
    return sortGoalDecisionTopics(state.document.topics)
}

export function readGoalDecisionTopicsWithLegacyBackfill(input: GoalDecisionScope & {
    store: Store
    namespace: string
}): StoredGoalDecisionTopic[] {
    const state = ensureDecisionDocument(input)
    if (!state) {
        return []
    }
    if (state.document.legacyDecisionTopicsBackfilledAt !== null) {
        return sortGoalDecisionTopics(state.document.topics)
    }
    return backfillLegacyGoalDecisionTopicsToDocs({
        project: input.project,
        goal: input.goal,
        defaultWorkspace: input.defaultWorkspace,
        legacyTopics: input.store.goalDecisionTopics.listByGoalAndNamespace(input.goal.id, input.namespace)
    })
}

export function createGoalDecisionTopicInDocs(input: GoalDecisionScope & {
    id: string
    scope: StoredGoalDecisionTopic['scope']
    taskId?: string | null
    title: string
    body: string
    blocking?: boolean
}): StoredGoalDecisionTopic | null {
    const state = ensureDecisionDocument(input)
    if (!state) {
        return null
    }
    const now = Date.now()
    if (input.scope === 'task' && !input.taskId) {
        return null
    }
    const topic: StoredGoalDecisionTopic = {
        id: input.id,
        projectId: input.project.id,
        goalId: input.goal.id,
        scope: input.scope,
        taskId: input.scope === 'task' ? input.taskId ?? null : null,
        title: input.title.trim(),
        body: input.body,
        status: 'waiting',
        blocking: input.blocking ?? true,
        resolution: null,
        createdAt: now,
        updatedAt: now
    }
    const existingIndex = state.document.topics.findIndex((candidate) => candidate.id === topic.id)
    if (existingIndex >= 0) {
        state.document.topics[existingIndex] = topic
    } else {
        state.document.topics.push(topic)
    }
    writeDecisionDocument(state.path, state.document)
    return topic
}

export function resolveGoalDecisionTopicInDocs(input: GoalDecisionScope & {
    topicId: string
    resolution: string
}): StoredGoalDecisionTopic | null {
    const state = ensureDecisionDocument(input)
    if (!state) {
        return null
    }
    const topic = state.document.topics.find((candidate) => candidate.id === input.topicId)
    if (!topic) {
        return null
    }
    topic.status = 'resolved'
    topic.resolution = input.resolution.trim()
    topic.updatedAt = Date.now()
    writeDecisionDocument(state.path, state.document)
    return topic
}

export function findGoalDecisionTopicLocation(input: {
    store: Store
    namespace: string
    topicId: string
}): GoalDecisionTopicLocation | null {
    const projects = input.store.projects.listProjectsByNamespace(input.namespace, { includeArchived: true })
    for (const project of projects) {
        const defaultWorkspace = project.defaultWorkspaceId
            ? input.store.workspaces.getWorkspace(project.defaultWorkspaceId)
            : input.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
        const goals = input.store.goals.listGoalsByProjectAndNamespace(project.id, input.namespace, { includeArchived: true })
        for (const goal of goals) {
            const topics = readGoalDecisionTopicsWithLegacyBackfill({
                store: input.store,
                namespace: input.namespace,
                project,
                goal,
                defaultWorkspace
            })
            const topic = topics.find((candidate) => candidate.id === input.topicId)
            if (topic) {
                return { project, goal, defaultWorkspace, topic }
            }
        }
    }
    return null
}
