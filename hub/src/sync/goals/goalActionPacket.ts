import { existsSync } from 'node:fs'
import { stripLeadingTaskTitleRef } from '@hopi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { z } from 'zod'
import type { DecryptedMessage } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { notifyProjectController } from '../projectController'
import type { SyncEngine } from '../syncEngine'
import { getProjectDefaultTaskRuntimeSettings } from '../projectTaskDefaults'
import { createGoalDecisionTopic } from './goalControl'
import { syncGoalOwnedDocs } from './goalDocs'
import { getDocsRoot, getGoalEventsPath, getGoalTodoPath } from './goalDocPaths'
import { appendGoalWorkflowEvent, buildDocsBackedGoalWorkflowGoalSnapshot } from './goalEventLog'
import {
    buildGoalTodoBlockedStateFromStoredTask,
    getGoalTodoStatusForStoredTask,
    getGoalTodoTagForStoredTask,
    getStoredTaskRuntimeBlockedReason,
    getStoredTaskRuntimeBlockedSource,
    recoverStoredTaskStatusFromLegacyBlocked
} from './goalTaskState'
import { createGoalTodoTaskId, readGoalTodo, upsertGoalTodoTaskState, type GoalTodoEventOptions, type GoalTodoTaskKind } from './goalTodo'
import {
    findGoalTodoTaskProjectionById,
    getTaskByNamespaceOrGoalTodoProjection,
    materializeGoalTodoTaskOverlayForWrite
} from './goalTodoProjection'

const taskStatusSchema = z.enum(['planning', 'running', 'review', 'done', 'blocked', 'planned', 'in_progress', 'in_review', 'finished'])
const taskPrioritySchema = z.enum(['high', 'medium', 'low'])
const taskSourceSchema = z.enum(['manual', 'planner', 'radar', 'evaluator'])
const goalStatusSchema = z.enum(['planning', 'active', 'blocked', 'paused', 'done', 'archived'])

const goalActionPacketSchema = z.object({
    actions: z.array(z.discriminatedUnion('type', [
        z.object({
            type: z.literal('create_goal_task'),
            title: z.string().trim().min(1).max(255),
            description: z.string().max(20_000).nullable().optional(),
            status: taskStatusSchema.optional(),
            priority: taskPrioritySchema.optional(),
            contract: z.string().max(20_000).nullable().optional(),
            todoRef: z.string().trim().min(1).max(255).nullable().optional(),
            id: z.string().trim().min(1).max(255).nullable().optional(),
            tag: z.string().trim().min(1).max(64).nullable().optional(),
            workflowProfile: z.string().trim().min(1).max(64).optional(),
            source: taskSourceSchema.optional()
        }),
        z.object({
            type: z.literal('update_current_task'),
            title: z.string().trim().min(1).max(255).optional(),
            description: z.string().max(20_000).nullable().optional(),
            status: taskStatusSchema.optional(),
            priority: taskPrioritySchema.nullable().optional(),
            contract: z.string().max(20_000).nullable().optional(),
            handoff: z.string().max(20_000).nullable().optional(),
            evidence: z.string().max(20_000).nullable().optional()
        }),
        z.object({
            type: z.literal('update_goal'),
            status: goalStatusSchema.optional(),
            currentFocus: z.string().max(20_000).nullable().optional(),
            successCriteria: z.string().max(20_000).nullable().optional(),
            autopilotEnabled: z.boolean().optional(),
            deployRequiresApproval: z.boolean().optional()
        }),
        z.object({
            type: z.literal('create_decision_topic'),
            taskId: z.string().min(1).nullable().optional(),
            title: z.string().trim().min(1).max(255),
            body: z.string().max(20_000),
            blocking: z.boolean().optional()
        })
    ])).min(1).max(20)
})

type GoalActionPacket = z.infer<typeof goalActionPacketSchema>
type GoalActionTaskStatus = z.infer<typeof taskStatusSchema> | undefined

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

function normalizeTaskTitleKey(value: string): string {
    return value
        .normalize('NFKC')
        .trim()
        .replace(/^\d+[\).\s]+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') return value
    try {
        const serialized = JSON.stringify(value)
        if (typeof serialized === 'string') return serialized
    } catch {
    }
    return String(value)
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return isPlainRecord(value) ? value : null
}

function getAlias(record: Record<string, unknown>, camelKey: string, snakeKey: string): unknown {
    return Object.prototype.hasOwnProperty.call(record, camelKey)
        ? record[camelKey]
        : record[snakeKey]
}

function normalizeStringItems(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((item) => typeof item === 'string' ? item.trim() : '')
            .filter((item) => item.length > 0)
    }

    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
    }

    return []
}

function formatMarkdownList(value: unknown): string | null {
    const items = normalizeStringItems(value)
    return items.length > 0
        ? items.map((item) => `- ${item}`).join('\n')
        : null
}

function formatSuccessCriteria(value: unknown): string | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    if (Array.isArray(value)) {
        return formatMarkdownList(value) ?? undefined
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed || undefined
    }
    return undefined
}

function normalizeTaskStatus(value: unknown): unknown {
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    switch (normalized) {
        case 'ready':
        case 'planned':
            return 'planning'
        case 'in_progress':
            return 'running'
        case 'in_review':
            return 'review'
        case 'finished':
            return 'done'
        default:
            return normalized
    }
}

function getTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask {
    if (!options.task.goalId) {
        return options.task
    }
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    }) ?? options.task
    if (projected === options.task) {
        return options.task
    }

    const hasExplicitOverlayBlock = Boolean(
        options.task.blockedReason
        || options.task.blockedSource
        || options.task.blockedSessionId
        || options.task.blockedAt
    )
    const projectionAlreadyCarriesBlock = Boolean(
        projected.blockedReason
        || projected.blockedSource
        || projected.blockedSessionId
        || projected.blockedAt
    )
    if (!hasExplicitOverlayBlock || projectionAlreadyCarriesBlock) {
        return projected
    }

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt
    }
}

function getProjectedTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask | null {
    if (!options.task.goalId) {
        return options.task
    }
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    })
    if (!projected) {
        return null
    }
    if (projected === options.task) {
        return options.task
    }

    const hasExplicitOverlayBlock = Boolean(
        options.task.blockedReason
        || options.task.blockedSource
        || options.task.blockedSessionId
        || options.task.blockedAt
    )
    const projectionAlreadyCarriesBlock = Boolean(
        projected.blockedReason
        || projected.blockedSource
        || projected.blockedSessionId
        || projected.blockedAt
    )
    if (!hasExplicitOverlayBlock || projectionAlreadyCarriesBlock) {
        return projected
    }

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt
    }
}

function isStaleDbOnlyGoalTaskForSource(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source'>
    source: StoredTask['source']
}): boolean {
    if (!options.task.goalId) {
        return false
    }
    if (options.task.source !== options.source) {
        return false
    }
    if (typeof options.task.goalTodoRef === 'string' && options.task.goalTodoRef.trim().length > 0) {
        return false
    }
    return !findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    })
}

function isStaleDbOnlyManualGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'manual'
    })
}

function isStaleDbOnlyBootstrapGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'project_init'
    })
}

function normalizeCreatedGoalTaskStatus(value: unknown): unknown {
    const normalized = normalizeTaskStatus(value)
    switch (normalized) {
        case 'running':
        case 'in_progress':
        case 'review':
        case 'in_review':
        case 'blocked':
        case 'done':
        case 'finished':
            return 'planning'
        default:
            return normalized
    }
}

function buildContractFromPlannerFields(action: Record<string, unknown>): string | undefined {
    if (typeof action.contract === 'string' && action.contract.trim()) {
        return action.contract
    }

    const objective = typeof action.description === 'string' && action.description.trim()
        ? action.description.trim()
        : typeof action.title === 'string' && action.title.trim()
            ? action.title.trim()
            : ''
    const acceptance = formatMarkdownList(action.acceptance)
    const suggestedChecks = formatMarkdownList(getAlias(action, 'suggestedChecks', 'suggested_checks'))
    const nonGoals = formatMarkdownList(getAlias(action, 'nonGoals', 'non_goals'))
    if (!objective && !acceptance && !suggestedChecks && !nonGoals) {
        return undefined
    }

    return [
        objective ? '## Objective' : '',
        objective,
        acceptance ? '## Acceptance' : '',
        acceptance ?? '',
        suggestedChecks ? '## Suggested Checks' : '',
        suggestedChecks ?? '',
        nonGoals ? '## Non-goals / Constraints' : '',
        nonGoals ?? ''
    ].filter((line, index, lines) => {
        if (line !== '') return true
        return lines[index - 1] !== '' && lines[index + 1] !== ''
    }).join('\n\n').trim()
}

function getTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed || null
}

function buildDecisionTopicBody(action: Record<string, unknown>): unknown {
    const body = getTrimmedString(action.body)
    if (body) return body

    const question = getTrimmedString(action.question)
    const context = getTrimmedString(action.context)
    const description = getTrimmedString(action.description)
    if (question && context) {
        return `${question}\n\n${context}`
    }
    return question ?? context ?? description ?? action.body
}

function normalizeActionPacketInput(raw: unknown): unknown {
    const packet = toRecord(raw)
    if (!packet || !Array.isArray(packet.actions)) {
        return raw
    }

    return {
        ...packet,
        actions: packet.actions.map((item) => {
            if (!isPlainRecord(item)) return item
            const type = item.type
            if (type === 'create_goal_task') {
                const todoRef = getAlias(item, 'todoRef', 'todo_ref') ?? item.id
                return {
                    ...item,
                    title: typeof item.title === 'string'
                        ? stripLeadingTaskTitleRef(item.title, typeof todoRef === 'string' ? todoRef : null)
                        : item.title,
                    status: normalizeCreatedGoalTaskStatus(item.status),
                    todoRef,
                    workflowProfile: getAlias(item, 'workflowProfile', 'workflow_profile'),
                    contract: buildContractFromPlannerFields(item),
                    source: item.source
                }
            }
            if (type === 'update_current_task') {
                return {
                    ...item,
                    title: typeof item.title === 'string'
                        ? stripLeadingTaskTitleRef(item.title)
                        : item.title,
                    status: normalizeTaskStatus(item.status)
                }
            }
            if (type === 'update_goal') {
                return {
                    ...item,
                    currentFocus: getAlias(item, 'currentFocus', 'current_focus'),
                    successCriteria: formatSuccessCriteria(getAlias(item, 'successCriteria', 'success_criteria')),
                    autopilotEnabled: getAlias(item, 'autopilotEnabled', 'autopilot_enabled'),
                    deployRequiresApproval: getAlias(item, 'deployRequiresApproval', 'deploy_requires_approval')
                }
            }
            if (type === 'create_decision_topic') {
                return {
                    ...item,
                    taskId: getAlias(item, 'taskId', 'task_id'),
                    body: buildDecisionTopicBody(item)
                }
            }
            return item
        })
    }
}

function collectCodexPlanText(data: Record<string, unknown>): string | null {
    const explanation = typeof data.explanation === 'string' ? normalizeText(data.explanation) : ''
    const entries = Array.isArray(data.entries) ? data.entries : []
    const lines: string[] = []
    for (const entry of entries) {
        const item = toRecord(entry)
        if (!item) continue
        const content = typeof item.content === 'string'
            ? normalizeText(item.content)
            : typeof item.step === 'string'
                ? normalizeText(item.step)
                : typeof item.text === 'string'
                    ? normalizeText(item.text)
                    : ''
        if (!content) continue
        const rawStatus = typeof item.status === 'string' ? item.status.toLowerCase().replace(/[\s_-]/g, '') : ''
        const done = rawStatus === 'completed'
        lines.push(`- [${done ? 'x' : ' '}] ${content}`)
    }

    if (lines.length === 0) {
        return explanation || null
    }
    return explanation
        ? `${explanation}\n${lines.join('\n')}`
        : lines.join('\n')
}

function extractText(content: unknown): string | null {
    if (typeof content === 'string') {
        const normalized = normalizeText(content)
        return normalized || null
    }

    if (Array.isArray(content)) {
        const blocks = content
            .map((item) => extractText(item))
            .filter((text): text is string => Boolean(text))
        return blocks.length > 0 ? blocks.join('\n') : null
    }

    const objectContent = toRecord(content)
    if (!objectContent) {
        return null
    }

    if (objectContent.type === 'event') {
        return null
    }

    if (objectContent.type === 'text' && typeof objectContent.text === 'string') {
        const normalized = normalizeText(objectContent.text)
        return normalized || null
    }

    if (objectContent.type === 'tool_use') {
        const input = toRecord(objectContent.input)
        const plan = typeof input?.plan === 'string'
            ? normalizeText(input.plan)
            : ''
        if (plan) {
            return plan
        }
    }

    if (objectContent.type === 'output') {
        const data = toRecord(objectContent.data)
        if (!data || data.isMeta || data.isCompactSummary) {
            return null
        }

        if (data.type === 'summary' && typeof data.summary === 'string') {
            const normalized = normalizeText(data.summary)
            return normalized || null
        }

        if (data.type === 'assistant' || data.type === 'user') {
            const message = toRecord(data.message)
            if (message) {
                return extractText(message.content)
            }
        }
    }

    if (objectContent.type === 'codex') {
        const data = toRecord(objectContent.data)
        if (!data) {
            return null
        }

        if ((data.type === 'message' || data.type === 'reasoning') && typeof data.message === 'string') {
            const normalized = normalizeText(data.message)
            return normalized || null
        }

        if (data.type === 'plan') {
            return collectCodexPlanText(data)
        }

        if (data.type === 'tool-call-result') {
            return extractText(data.output)
        }
    }

    if (typeof objectContent.text === 'string') {
        const normalized = normalizeText(objectContent.text)
        if (normalized) return normalized
    }

    if ('content' in objectContent) {
        const fromContent = extractText(objectContent.content)
        if (fromContent) return fromContent
    }

    if ('message' in objectContent) {
        const fromMessage = extractText(objectContent.message)
        if (fromMessage) return fromMessage
    }

    const fallback = normalizeText(stringifyUnknown(content))
    return fallback || null
}

function extractAssistantText(message: DecryptedMessage): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null
    return extractText(record.content)
}

function extractJsonPayload(text: string): string | null {
    const withMarkerThenJsonFence = /HOPI_ACTIONS\s*:?\s*```(?:json)?\s*([\s\S]*?)```/iu.exec(text)
    if (withMarkerThenJsonFence?.[1]) {
        return withMarkerThenJsonFence[1].trim()
    }

    const withMarkerFence = /```HOPI_ACTIONS\s*([\s\S]*?)```/iu.exec(text)
    if (withMarkerFence?.[1]) {
        return withMarkerFence[1].trim()
    }

    const markerIndex = text.lastIndexOf('HOPI_ACTIONS')
    if (markerIndex < 0) {
        return null
    }

    const afterMarker = text.slice(markerIndex + 'HOPI_ACTIONS'.length)
    return extractFirstJsonObjectPayload(afterMarker)
}

function extractFirstJsonObjectPayload(text: string): string | null {
    const jsonStart = text.indexOf('{')
    if (jsonStart < 0) {
        return null
    }

    let depth = 0
    let inString = false
    let escaped = false
    for (let index = jsonStart; index < text.length; index += 1) {
        const char = text[index]

        if (inString) {
            if (escaped) {
                escaped = false
            } else if (char === '\\') {
                escaped = true
            } else if (char === '"') {
                inString = false
            }
            continue
        }

        if (char === '"') {
            inString = true
            continue
        }
        if (char === '{') {
            depth += 1
            continue
        }
        if (char === '}') {
            depth -= 1
            if (depth === 0) {
                return text.slice(jsonStart, index + 1).trim()
            }
        }
    }

    return null
}

function looksLikeGoalActionPacketPayload(payload: string): boolean {
    try {
        const parsed = JSON.parse(payload)
        return isPlainRecord(parsed) && Array.isArray(parsed.actions)
    } catch {
        return false
    }
}

function extractBareJsonPayload(text: string): string | null {
    const trimmed = text.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}') && looksLikeGoalActionPacketPayload(trimmed)) {
        return trimmed
    }

    const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/iu.exec(trimmed)
    const fencedPayload = fenced?.[1]?.trim()
    const markedFencedPayload = fencedPayload ? extractJsonPayload(fencedPayload) : null
    if (markedFencedPayload && looksLikeGoalActionPacketPayload(markedFencedPayload)) {
        return markedFencedPayload
    }
    if (fencedPayload?.startsWith('{')
        && fencedPayload.endsWith('}')
        && looksLikeGoalActionPacketPayload(fencedPayload)) {
        return fencedPayload
    }

    const fencedJsonBlocks = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu))
    for (let index = fencedJsonBlocks.length - 1; index >= 0; index -= 1) {
        const payload = fencedJsonBlocks[index]?.[1]?.trim()
        const markedPayload = payload ? extractJsonPayload(payload) : null
        if (markedPayload && looksLikeGoalActionPacketPayload(markedPayload)) {
            return markedPayload
        }
        if (payload?.startsWith('{')
            && payload.endsWith('}')
            && looksLikeGoalActionPacketPayload(payload)) {
            return payload
        }
    }

    return null
}

function findLatestGoalActionPacket(messages: DecryptedMessage[]): GoalActionPacket | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const text = extractAssistantText(messages[index]!)
        if (!text) continue
        const payload = extractJsonPayload(text) ?? extractBareJsonPayload(text)
        if (!payload) continue

        try {
            const raw = normalizeActionPacketInput(JSON.parse(payload))
            return goalActionPacketSchema.parse(raw)
        } catch {
            return null
        }
    }
    return null
}

function emitTaskUpdated(options: {
    engine: SyncEngine
    namespace: string
    task: StoredTask
}): void {
    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: options.task.id,
        projectId: options.task.projectId,
        namespace: options.namespace,
        data: { taskId: options.task.id }
    })
}

function emitProjectUpdated(options: {
    engine: SyncEngine
    namespace: string
    projectId: string
}): void {
    options.engine.handleRealtimeEvent({
        type: 'project-updated',
        projectId: options.projectId,
        namespace: options.namespace,
        data: { projectId: options.projectId }
    })
}

function getDefaultCreatedTaskSource(_current: StoredTask): string {
    return 'manual'
}

function getGoalTodoTaskKindForSource(source: string | null | undefined): GoalTodoTaskKind {
    const normalized = source?.trim().toLowerCase()
    return normalized === 'planner' || normalized === 'radar'
        ? 'planning'
        : 'engineering'
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function appendGoalMetadataActionPacketEvent(options: {
    project: StoredProject
    goalId: string
    goalKey: string
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    defaultWorkspace: StoredWorkspace | null
    sessionId: string
}): void {
    const docsRoot = getDocsRoot(options.defaultWorkspace)
    if (!docsRoot) {
        return
    }

    appendGoalWorkflowEvent(getGoalEventsPath(docsRoot, options.goalKey), {
        writer: 'hopi-actions',
        action: 'goal_updated_from_action_packet',
        entity: {
            type: 'goal',
            id: options.goalId
        },
        before: options.before,
        after: options.after,
        reason: 'Planner action packet updated the durable goal metadata.',
        metadata: {
            projectId: options.project.id,
            source: 'update_goal',
            sessionId: options.sessionId
        }
    })
}

function materializeGoalActionTaskOverlay(options: {
    store: Store
    namespace: string
    project: StoredProject
    currentTask: StoredTask
    taskId: string
    taskTitle: string
    description: string | null | undefined
    status: string
    priority: 'high' | 'medium' | 'low' | null
    workflowProfile: string
    source: string
    contract: string | null | undefined
}): StoredTask {
    const defaults = getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true })
    const existing = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
        ?? options.store.tasks
            .listTasksByProjectAndNamespace(options.project.id, options.namespace, { goalId: options.currentTask.goalId ?? undefined })
            .find((task) => task.goalTodoRef === options.taskId)
        ?? null

    if (existing) {
        return options.store.tasks.updateTaskByNamespace(existing.id, options.namespace, {
            goalId: options.currentTask.goalId,
            goalTodoRef: options.taskId,
            title: options.taskTitle,
            description: options.description ?? null,
            status: options.status,
            priority: options.priority,
            sortKey: existing.sortKey ?? Date.now(),
            workspaceId: options.currentTask.workspaceId,
            agentFlavor: defaults.agentFlavor,
            permissionMode: defaults.permissionMode,
            model: defaults.model,
            modelMode: defaults.modelMode,
            workflowProfile: options.workflowProfile,
            source: options.source,
            contract: options.contract ?? null
        }) ?? existing
    }

    const materialized = materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId
    })
    if (materialized) {
        return options.store.tasks.updateTaskByNamespace(materialized.id, options.namespace, {
            title: options.taskTitle,
            description: options.description ?? null,
            status: options.status,
            priority: options.priority,
            sortKey: materialized.sortKey ?? Date.now(),
            workspaceId: options.currentTask.workspaceId,
            agentFlavor: defaults.agentFlavor,
            permissionMode: defaults.permissionMode,
            model: defaults.model,
            modelMode: defaults.modelMode,
            workflowProfile: options.workflowProfile,
            source: options.source,
            contract: options.contract ?? null
        }) ?? materialized
    }

    return options.store.tasks.createTask({
        id: options.taskId,
        projectId: options.currentTask.projectId,
        goalId: options.currentTask.goalId,
        goalTodoRef: options.taskId,
        title: options.taskTitle,
        description: options.description ?? null,
        status: options.status,
        priority: options.priority,
        sortKey: Date.now(),
        workspaceId: options.currentTask.workspaceId,
        ...defaults,
        workflowProfile: options.workflowProfile,
        source: options.source,
        sourceTaskId: options.currentTask.id,
        contract: options.contract ?? null
    })
}

function resolveGoalTodoRefForTask(options: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    task: Pick<StoredTask, 'id' | 'goalTodoRef'>
}): string {
    const existingRef = options.task.goalTodoRef?.trim()
    if (existingRef) {
        return existingRef
    }
    const todo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: options.defaultWorkspace
    })
    return todo.board.items.find((item) => item.taskId === options.task.id)?.ref?.trim() || options.task.id
}

function findGoalTodoTitle(options: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    todoRef: string | null
}): string | null {
    const todoRef = options.todoRef?.trim()
    if (!todoRef) {
        return null
    }

    const todo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: options.defaultWorkspace
    })
    const todoRefKey = normalizeTaskTitleKey(todoRef)
    const boardItem = todo.board.items.find((item) => (
        normalizeTaskTitleKey(item.ref) === todoRefKey
        || (item.taskId && normalizeTaskTitleKey(item.taskId) === todoRefKey)
    ))
    if (boardItem?.title.trim()) {
        return boardItem.title.trim()
    }
    return null
}

function syncGoalTodoRef(options: {
    store: Store
    namespace: string
    project: StoredProject
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'title' | 'description' | 'status' | 'blockedReason' | 'blockedSource' | 'blockedAt' | 'workspaceId' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'>
    tag?: string | null
    event?: GoalTodoEventOptions
}): void {
    if (!options.task.goalId || !options.task.goalTodoRef) {
        return
    }
    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return
    }
    const defaultWorkspace = getDefaultWorkspace(options.store, options.project)
        ?? (options.task.workspaceId ? options.store.workspaces.getWorkspace(options.task.workspaceId) : null)
    const goalStatus = getGoalTodoStatusForStoredTask(options.task)
    upsertGoalTodoTaskState({
        project: options.project,
        goal,
        defaultWorkspace,
        taskId: options.task.goalTodoRef,
        status: goalStatus,
        tag: options.tag !== undefined ? options.tag : getGoalTodoTagForStoredTask(options.task),
        title: options.task.title,
        body: options.task.description,
        blocked: buildGoalTodoBlockedStateFromStoredTask(options.task),
        event: options.event
    })
}

function getGoalTaskActionRole(task: Pick<StoredTask, 'goalId' | 'status' | 'source'>): 'planner' | 'generator' | 'evaluator' | 'radar' | null {
    if (!task.goalId) return null

    const status = (task.status ?? '').trim().toLowerCase()
    if (status === 'review' || status === 'in_review') return 'evaluator'

    const source = (task.source ?? '').trim().toLowerCase()
    if (source === 'planner') return 'planner'
    if (source === 'radar') return 'radar'
    if (source === 'evaluator') return 'evaluator'
    return 'generator'
}

function normalizeUpdateCurrentTaskStatusForRole(
    status: string | null | undefined,
    task: Pick<StoredTask, 'goalId' | 'status' | 'source'>
): string | null | undefined {
    if (status !== 'finished' && status !== 'done') {
        return status
    }

    return getGoalTaskActionRole(task) === 'generator' ? 'review' : status
}

function getUpdateCurrentTaskSourceForRole(
    status: string | null | undefined,
    task: Pick<StoredTask, 'goalId' | 'status' | 'source'>
): string | null | undefined {
    const role = getGoalTaskActionRole(task)
    if (role !== 'evaluator') {
        return undefined
    }
    if (status === 'planning' || status === 'planned' || status === 'blocked' || status === 'review' || status === 'in_review') {
        return 'manual'
    }
    return undefined
}

export function applyGoalActionPacketFromSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    taskId: string
    sessionId: string
}): boolean {
    const current = materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId
    }) ?? options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!current || current.archivedAt || !current.goalId || current.projectId !== options.projectId) {
        return false
    }

    let goal = options.store.goals.getGoalByNamespace(current.goalId, options.namespace)
    if (!goal || goal.projectId !== current.projectId) {
        return false
    }
    const project = options.store.projects.getProjectByNamespace(current.projectId, options.namespace)
    if (!project) {
        return false
    }
    const defaultWorkspace = getDefaultWorkspace(options.store, project)
    if (
        defaultWorkspace
        && (
            isStaleDbOnlyManualGoalTask({
                store: options.store,
                namespace: options.namespace,
                task: current
            })
            || isStaleDbOnlyBootstrapGoalTask({
                store: options.store,
                namespace: options.namespace,
                task: current
            })
        )
    ) {
        return false
    }

    const messages = options.store.messages.getMessages(options.sessionId, 50)
    const packet = findLatestGoalActionPacket(messages.map((message) => ({
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        content: message.content,
        createdAt: message.createdAt
    })))
    if (!packet) {
        return false
    }

    const todo = readGoalTodo({
        project,
        goal,
        defaultWorkspace
    })
    let touchedProject = false
    const shouldUseDocsFirstDuplicateSuppression = Boolean(defaultWorkspace)
    const existingGoalTaskTitleKeys = new Set(
        [
            ...(
                shouldUseDocsFirstDuplicateSuppression
                    ? []
                    : options.store.tasks
                        .listTasksByProjectAndNamespace(current.projectId, options.namespace, { goalId: current.goalId })
                        .map((task) => normalizeTaskTitleKey(task.title))
            ),
            ...todo.board.items.map((item) => normalizeTaskTitleKey(item.title))
        ]
            .filter((title) => title.length > 0)
    )
    const existingGoalTaskTodoRefs = new Set(
        [
            ...(
                shouldUseDocsFirstDuplicateSuppression
                    ? []
                    : options.store.tasks
                        .listTasksByProjectAndNamespace(current.projectId, options.namespace, { goalId: current.goalId })
                        .map((task) => typeof task.goalTodoRef === 'string' ? normalizeTaskTitleKey(task.goalTodoRef) : '')
            ),
            ...todo.board.items.flatMap((item) => [
                normalizeTaskTitleKey(item.ref),
                item.taskId ? normalizeTaskTitleKey(item.taskId) : ''
            ])
        ]
            .filter((todoRef) => todoRef.length > 0)
    )

    for (const action of packet.actions) {
        if (action.type === 'create_goal_task') {
            const todoRef = action.todoRef?.trim() || null
            const taskTitle = findGoalTodoTitle({
                project,
                goal,
                defaultWorkspace,
                todoRef
            }) ?? stripLeadingTaskTitleRef(action.title, todoRef)
            const titleKey = normalizeTaskTitleKey(taskTitle)
            const todoRefKey = todoRef ? normalizeTaskTitleKey(todoRef) : ''
            if (todoRefKey && existingGoalTaskTodoRefs.has(todoRefKey)) {
                continue
            }
            if (titleKey && existingGoalTaskTitleKeys.has(titleKey)) {
                continue
            }

            const taskId = todoRef ?? createGoalTodoTaskId({
                project,
                goal,
                defaultWorkspace,
                title: taskTitle
            })
            const createdStatus = action.status ?? 'planning'
            const createdSource = action.source ?? getDefaultCreatedTaskSource(current)
            const createGoalTaskEvent: GoalTodoEventOptions = {
                writer: 'hopi-actions',
                action: 'todo_item_created_from_action_packet',
                reason: 'Planner action packet created a durable goal task.',
                metadata: {
                    source: 'create_goal_task',
                    sessionId: options.sessionId
                }
            }
            const createdGoalTodoTaskState = {
                status: createdStatus,
                blockedSource: null,
                mergeRuntime: null,
                previewRuntime: null,
                initRuntime: null
            } as const
            const wroteDocsFirst = Boolean(defaultWorkspace) && upsertGoalTodoTaskState({
                project,
                goal,
                defaultWorkspace,
                taskId,
                status: getGoalTodoStatusForStoredTask(createdGoalTodoTaskState),
                tag: action.tag !== undefined ? action.tag : getGoalTodoTagForStoredTask(createdGoalTodoTaskState),
                taskKind: getGoalTodoTaskKindForSource(createdSource),
                title: taskTitle,
                body: action.description ?? null,
                blocked: null,
                event: createGoalTaskEvent
            })
            const created = materializeGoalActionTaskOverlay({
                store: options.store,
                namespace: options.namespace,
                project,
                currentTask: current,
                taskId,
                taskTitle,
                description: action.description,
                status: createdStatus,
                priority: action.priority ?? null,
                workflowProfile: action.workflowProfile ?? 'default',
                source: createdSource,
                contract: action.contract
            })
            if (titleKey) {
                existingGoalTaskTitleKeys.add(titleKey)
            }
            existingGoalTaskTodoRefs.add(normalizeTaskTitleKey(taskId))
            if (!wroteDocsFirst) {
                syncGoalTodoRef({
                    store: options.store,
                    namespace: options.namespace,
                    project,
                    task: created,
                    tag: action.tag,
                    event: createGoalTaskEvent
                })
            }
            options.engine.handleRealtimeEvent({
                type: 'task-added',
                taskId: created.id,
                projectId: created.projectId,
                namespace: options.namespace,
                data: { taskId: created.id }
            })
            touchedProject = true
            continue
        }

        if (action.type === 'update_current_task') {
            const latest = options.store.tasks.getTaskByNamespace(current.id, options.namespace)
            if (!latest || latest.archivedAt) {
                continue
            }
            const docsRoot = getDocsRoot(defaultWorkspace)
            const hasCanonicalGoalTodoFile = Boolean(
                docsRoot
                && existsSync(getGoalTodoPath(docsRoot, goal.goalKey))
            )
            const latestProjectedTask = getProjectedTaskRuntimeView({
                store: options.store,
                namespace: options.namespace,
                task: latest
            })
            const latestTask = getTaskRuntimeView({
                store: options.store,
                namespace: options.namespace,
                task: latest
            })
            const missingPreexistingCanonicalGoalTodoItem = Boolean(
                defaultWorkspace
                && hasCanonicalGoalTodoFile
                && latest.goalTodoRef?.trim()
                && !latestProjectedTask
            )
            const requestedStatus = normalizeUpdateCurrentTaskStatusForRole(action.status, latestTask) ?? latestTask.status
            const storedStatus = recoverStoredTaskStatusFromLegacyBlocked({
                goalId: latestTask.goalId,
                status: requestedStatus,
                blockedSource: latestTask.blockedSource,
                mergeRuntime: latestTask.mergeRuntime,
                previewRuntime: latestTask.previewRuntime,
                initRuntime: latestTask.initRuntime
            })
            const source = getUpdateCurrentTaskSourceForRole(requestedStatus, latestTask)
            const statusChangingToFinished = (requestedStatus === 'finished' || requestedStatus === 'done')
                && latestTask.status !== 'finished'
                && latestTask.status !== 'done'
            const nextTitle = action.title === undefined
                ? undefined
                : stripLeadingTaskTitleRef(action.title, latestTask.goalTodoRef)
            const goalTodoTaskForWrite = latestProjectedTask ?? latestTask
            const nextGoalTodoRef = defaultWorkspace && latestProjectedTask
                ? resolveGoalTodoRefForTask({
                    project,
                    goal,
                    defaultWorkspace,
                    task: latestProjectedTask
                })
                : (latestTask.goalTodoRef?.trim() || latestTask.id)
            const nextGoalTodoTaskState = {
                ...latestTask,
                status: storedStatus
            } as StoredTask
            const nextGoalTodoBlockedState = buildGoalTodoBlockedStateFromStoredTask(latestTask)
            const nextBlockedReason = requestedStatus === 'blocked'
                ? (latestTask.blockedReason?.trim() || getStoredTaskRuntimeBlockedReason(latestTask) || null)
                : null
            const nextBlockedSource = requestedStatus === 'blocked'
                ? (latestTask.blockedSource?.trim() || getStoredTaskRuntimeBlockedSource(latestTask) || null)
                : null
            const shouldPersistBlockedMetadata = Boolean(nextBlockedReason || nextBlockedSource)
            const updateCurrentTaskEvent: GoalTodoEventOptions = {
                writer: 'hopi-actions',
                action: 'todo_item_updated_from_action_packet',
                reason: 'Action packet updated the durable goal task state.',
                metadata: {
                    source: 'update_current_task',
                    sessionId: options.sessionId
                }
            }
            const wroteDocsFirst = defaultWorkspace && !missingPreexistingCanonicalGoalTodoItem
                ? upsertGoalTodoTaskState({
                    project,
                    goal,
                    defaultWorkspace,
                    taskId: nextGoalTodoRef,
                    status: getGoalTodoStatusForStoredTask(nextGoalTodoTaskState),
                    tag: getGoalTodoTagForStoredTask(nextGoalTodoTaskState),
                    taskKind: getGoalTodoTaskKindForSource(source ?? latestTask.source),
                    title: nextTitle ?? goalTodoTaskForWrite.title,
                    body: action.description !== undefined ? action.description : goalTodoTaskForWrite.description,
                    blocked: nextGoalTodoBlockedState,
                    event: updateCurrentTaskEvent
                })
                : false
            const updated = options.store.tasks.updateTaskByNamespace(current.id, options.namespace, {
                title: nextTitle,
                goalTodoRef: nextGoalTodoRef,
                description: action.description,
                status: storedStatus,
                blockedReason: shouldPersistBlockedMetadata ? nextBlockedReason : null,
                blockedSource: shouldPersistBlockedMetadata ? nextBlockedSource : null,
                blockedSessionId: shouldPersistBlockedMetadata ? (latest.blockedSessionId ?? undefined) : null,
                blockedAt: shouldPersistBlockedMetadata ? (latest.blockedAt ?? Date.now()) : null,
                priority: action.priority,
                source,
                contract: action.contract,
                handoff: action.handoff,
                evidence: action.evidence,
                finishedAt: statusChangingToFinished ? Date.now() : undefined
            })
            if (updated) {
                if (!wroteDocsFirst && updated.goalTodoRef) {
                    const projectedUpdated = getProjectedTaskRuntimeView({
                        store: options.store,
                        namespace: options.namespace,
                        task: updated
                    })
                    if (projectedUpdated || !missingPreexistingCanonicalGoalTodoItem) {
                        syncGoalTodoRef({
                            store: options.store,
                            namespace: options.namespace,
                            project,
                            task: projectedUpdated ?? updated,
                            event: updateCurrentTaskEvent
                        })
                    }
                }
                emitTaskUpdated({
                    engine: options.engine,
                    namespace: options.namespace,
                    task: updated
                })
                touchedProject = true
            }
            continue
        }

        if (action.type === 'update_goal') {
            const previousGoal = options.store.goals.getGoalByNamespace(goal.id, options.namespace) ?? goal
            const updatedGoal = options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
                status: action.status,
                currentFocus: action.currentFocus,
                successCriteria: action.successCriteria,
                autopilotEnabled: action.autopilotEnabled,
                deployRequiresApproval: action.deployRequiresApproval
            })
            if (updatedGoal) {
                const beforeSnapshot = buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal: previousGoal,
                    defaultWorkspace
                })
                syncGoalOwnedDocs({
                    project,
                    goal: updatedGoal,
                    defaultWorkspace
                })
                appendGoalMetadataActionPacketEvent({
                    project,
                    goalId: updatedGoal.id,
                    goalKey: updatedGoal.goalKey,
                    before: beforeSnapshot,
                    after: buildDocsBackedGoalWorkflowGoalSnapshot({
                        goal: updatedGoal,
                        defaultWorkspace
                    }),
                    defaultWorkspace,
                    sessionId: options.sessionId
                })
                goal = updatedGoal
                touchedProject = true
            }
            continue
        }

        if (action.type === 'create_decision_topic') {
            const taskId = action.taskId ?? null
            if (taskId) {
                const linkedTask = findGoalTodoTaskProjectionById({
                    store: options.store,
                    namespace: options.namespace,
                    taskId,
                    includeArchived: false
                })
                if (!linkedTask || linkedTask.projectId !== current.projectId || linkedTask.goalId !== current.goalId) {
                    continue
                }
            }

            let topic: ReturnType<typeof createGoalDecisionTopic>['topic'] | null = null
            try {
                topic = createGoalDecisionTopic({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    project,
                    goal,
                    taskId,
                    title: action.title,
                    body: action.body,
                    blocking: action.blocking ?? true,
                    writer: 'hopi-actions',
                    reason: 'Planner action packet created a durable decision topic.',
                    blockedSessionId: options.sessionId
                }).topic
            } catch {
                continue
            }
            if (!topic) {
                continue
            }
            touchedProject = true
            notifyProjectController({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                projectId: topic.projectId,
                goalId: topic.goalId,
                taskId: topic.taskId,
                kind: 'decision',
                title: topic.title,
                body: topic.body
            })

        }
    }

    if (touchedProject) {
        emitProjectUpdated({
            engine: options.engine,
            namespace: options.namespace,
            projectId: current.projectId
        })
    }

    return true
}
