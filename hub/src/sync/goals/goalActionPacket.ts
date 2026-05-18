import { randomUUID } from 'node:crypto'
import { stripLeadingTaskTitleRef } from '@hopi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { z } from 'zod'
import type { DecryptedMessage } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { notifyProjectController } from '../projectController'
import type { SyncEngine } from '../syncEngine'
import { getProjectDefaultTaskRuntimeSettings } from '../projectTaskDefaults'
import { createGoalTodoTaskId, readGoalTodo, upsertGoalTodoTaskState, type GoalTodoStatus, type GoalTodoUpdateKind } from './goalTodo'

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
                    status: normalizeTaskStatus(item.status),
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

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
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
    const section = todo.sections.find((item) => (
        item.todoRef && normalizeTaskTitleKey(item.todoRef) === todoRefKey
    ))
    return section?.title.trim() || null
}

function syncGoalTodoRef(options: {
    store: Store
    namespace: string
    project: StoredProject
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'title' | 'description' | 'blockedReason' | 'blockedSource' | 'workspaceId'>
    kind: GoalTodoUpdateKind
    tag?: string | null
}): void {
    if (!options.task.goalId || !options.task.goalTodoRef) {
        return
    }
    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return
    }
    const statusTag = getGoalTodoStatusTagForKind(options.kind)
    const defaultWorkspace = getDefaultWorkspace(options.store, options.project)
        ?? (options.task.workspaceId ? options.store.workspaces.getWorkspace(options.task.workspaceId) : null)
    upsertGoalTodoTaskState({
        project: options.project,
        goal,
        defaultWorkspace,
        taskId: options.task.goalTodoRef,
        status: statusTag.status,
        tag: options.tag !== undefined ? options.tag : statusTag.tag,
        title: options.task.title,
        body: options.task.description,
        blocked: statusTag.status === 'blocked'
            ? {
                kind: options.task.blockedSource ?? 'blocked',
                summary: options.task.blockedReason,
                updatedAt: Date.now()
            }
            : null
    })
}

function getGoalTodoStatusTagForKind(kind: GoalTodoUpdateKind): { status: GoalTodoStatus; tag: string | null } {
    switch (kind) {
        case 'planning':
            return { status: 'planning', tag: 'ready' }
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
    }
}

function getGoalTodoKindForTaskStatus(status: GoalActionTaskStatus): GoalTodoUpdateKind {
    if (status === 'done' || status === 'finished') return 'done'
    if (status === 'review' || status === 'in_review') return 'review'
    if (status === 'blocked') return 'blocked'
    if (status === 'planning' || status === 'planned') return 'planning'
    return 'running'
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
    status: GoalActionTaskStatus,
    task: Pick<StoredTask, 'goalId' | 'status' | 'source'>
): GoalActionTaskStatus {
    if (status !== 'finished' && status !== 'done') {
        return status
    }

    return getGoalTaskActionRole(task) === 'generator' ? 'review' : status
}

function getUpdateCurrentTaskSourceForRole(
    status: GoalActionTaskStatus,
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
    const current = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!current || current.archivedAt || !current.goalId || current.projectId !== options.projectId) {
        return false
    }

    const goal = options.store.goals.getGoalByNamespace(current.goalId, options.namespace)
    if (!goal || goal.projectId !== current.projectId) {
        return false
    }
    const project = options.store.projects.getProjectByNamespace(current.projectId, options.namespace)
    if (!project) {
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

    let touchedProject = false
    const existingGoalTaskTitleKeys = new Set(
        options.store.tasks
            .listTasksByProjectAndNamespace(current.projectId, options.namespace, { goalId: current.goalId })
            .map((task) => normalizeTaskTitleKey(task.title))
            .filter((title) => title.length > 0)
    )
    const existingGoalTaskTodoRefs = new Set(
        options.store.tasks
            .listTasksByProjectAndNamespace(current.projectId, options.namespace, { goalId: current.goalId })
            .map((task) => typeof task.goalTodoRef === 'string' ? normalizeTaskTitleKey(task.goalTodoRef) : '')
            .filter((todoRef) => todoRef.length > 0)
    )
    const defaultWorkspace = getDefaultWorkspace(options.store, project)

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
            const created = options.store.tasks.createTask({
                id: taskId,
                projectId: current.projectId,
                goalId: current.goalId,
                goalTodoRef: taskId,
                title: taskTitle,
                description: action.description,
                status: action.status ?? 'planning',
                priority: action.priority ?? null,
                sortKey: Date.now(),
                workspaceId: current.workspaceId,
                ...getProjectDefaultTaskRuntimeSettings(project, { autonomous: true }),
                workflowProfile: action.workflowProfile ?? 'default',
                source: action.source ?? getDefaultCreatedTaskSource(current),
                sourceTaskId: current.id,
                contract: action.contract
            })
            if (titleKey) {
                existingGoalTaskTitleKeys.add(titleKey)
            }
            existingGoalTaskTodoRefs.add(normalizeTaskTitleKey(taskId))
            syncGoalTodoRef({
                store: options.store,
                namespace: options.namespace,
                project,
                task: created,
                kind: getGoalTodoKindForTaskStatus(created.status as GoalActionTaskStatus),
                tag: action.tag
            })
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
            const status = normalizeUpdateCurrentTaskStatusForRole(action.status, latest)
            const source = getUpdateCurrentTaskSourceForRole(status, latest)
            const statusChangingToFinished = (status === 'finished' || status === 'done') && latest.status !== 'finished' && latest.status !== 'done'
            const nextTitle = action.title === undefined
                ? undefined
                : stripLeadingTaskTitleRef(action.title, latest.goalTodoRef)
            const updated = options.store.tasks.updateTaskByNamespace(current.id, options.namespace, {
                title: nextTitle,
                description: action.description,
                status,
                priority: action.priority,
                source,
                contract: action.contract,
                handoff: action.handoff,
                evidence: action.evidence,
                finishedAt: statusChangingToFinished ? Date.now() : undefined
            })
            if (updated) {
                if (updated.goalTodoRef) {
                    syncGoalTodoRef({
                        store: options.store,
                        namespace: options.namespace,
                        project,
                        task: updated,
                        kind: getGoalTodoKindForTaskStatus(status)
                    })
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
            const updatedGoal = options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
                status: action.status,
                currentFocus: action.currentFocus,
                successCriteria: action.successCriteria,
                autopilotEnabled: action.autopilotEnabled,
                deployRequiresApproval: action.deployRequiresApproval
            })
            if (updatedGoal) {
                touchedProject = true
            }
            continue
        }

        if (action.type === 'create_decision_topic') {
            const taskId = action.taskId === null ? null : action.taskId ?? current.id
            if (taskId) {
                const linkedTask = options.store.tasks.getTaskByNamespace(taskId, options.namespace)
                if (!linkedTask || linkedTask.projectId !== current.projectId || linkedTask.goalId !== current.goalId) {
                    continue
                }
            }

            const topic = options.store.goalDecisionTopics.create({
                id: randomUUID(),
                projectId: current.projectId,
                goalId: current.goalId,
                namespace: options.namespace,
                taskId,
                title: action.title,
                body: action.body,
                blocking: action.blocking ?? true
            })
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

            if (topic.blocking && topic.taskId) {
                const linkedTask = options.store.tasks.getTaskByNamespace(topic.taskId, options.namespace)
                if (linkedTask && linkedTask.status !== 'finished' && linkedTask.status !== 'done' && linkedTask.status !== 'blocked') {
                    const blocked = options.store.tasks.updateTaskByNamespace(linkedTask.id, options.namespace, {
                        status: 'blocked',
                        blockedReason: topic.body,
                        blockedSource: 'decision_topic',
                        blockedSessionId: options.sessionId
                    })
                    if (blocked) {
                        syncGoalTodoRef({
                            store: options.store,
                            namespace: options.namespace,
                            project,
                            task: blocked,
                            kind: 'blocked'
                        })
                        emitTaskUpdated({
                            engine: options.engine,
                            namespace: options.namespace,
                            task: blocked
                        })
                    }
                }
            } else if (topic.blocking) {
                options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
                    status: 'blocked'
                })
            }
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
