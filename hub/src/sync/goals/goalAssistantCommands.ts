import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { buildTaskInitRuntime, buildTaskMergeRuntime } from '../../utils/taskActionRuntime'
import type { SyncEngine } from '../syncEngine'
import { appendGoalEvent, readGoalEvents, type GoalEventActor } from './goalEvents'
import { getGoalDesignPath, getDocsRoot, getPreferencePath } from './goalDocPaths'
import { bootstrapGoalDocs } from './goalDocs'
import { readGoalDecisionTopics, readGoalDecisionTopicsWithLegacyBackfill, resolveGoalDecisionTopicInDocs } from './goalDecisions'
import { createGoalTodoTaskId, readGoalTodo, upsertGoalTodoTaskState, type GoalTodoSection } from './goalTodo'
import { prependTaskHandoffDecisionContext } from './decisionHandoff'
import { getProjectDefaultTaskRuntimeSettings } from '../projectTaskDefaults'
import { continueTaskInLinkedSession, startSessionFromTask } from '../taskSessionService'
import { requestAutoMergeAcceptedTask } from '../taskAutoMerge'

const canonicalLaneSchema = z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done'])
const requestableLaneSchema = z.enum(['planned', 'in_progress', 'merging'])

const initiatorSchema = z.record(z.string(), z.unknown()).optional()

export const goalAssistantCommandSchema = z.discriminatedUnion('command', [
    z.object({
        command: z.literal('inspect_goal_state')
    }),
    z.object({
        command: z.literal('inspect_task_history'),
        taskId: z.string().trim().min(1)
    }),
    z.object({
        command: z.literal('request_task_lane'),
        taskId: z.string().trim().min(1),
        lane: requestableLaneSchema,
        reason: z.string().trim().min(1).max(20_000),
        message: z.string().trim().min(1).max(20_000).optional(),
        initiator: initiatorSchema
    }),
    z.object({
        command: z.literal('start_or_resume_task'),
        taskId: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(20_000),
        overrides: z.record(z.string(), z.unknown()).optional(),
        initiator: initiatorSchema
    }),
    z.object({
        command: z.literal('retry_task_merge'),
        taskId: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(20_000),
        initiator: initiatorSchema
    }),
    z.object({
        command: z.literal('request_planning'),
        intent: z.string().trim().min(1).max(20_000),
        relatedTaskIds: z.array(z.string().trim().min(1)).max(50).optional(),
        urgency: z.enum(['low', 'normal', 'high']).optional(),
        initiator: initiatorSchema
    }),
    z.object({
        command: z.literal('answer_decision_topic'),
        topicId: z.string().trim().min(1),
        answer: z.string().trim().min(1).max(20_000),
        reason: z.string().trim().min(1).max(20_000).optional(),
        initiator: initiatorSchema
    }),
    z.object({
        command: z.literal('read_preference')
    }),
    z.object({
        command: z.literal('write_preference'),
        markdown: z.string().max(200_000),
        initiator: initiatorSchema
    })
])

type GoalAssistantCommand = z.infer<typeof goalAssistantCommandSchema>
type CanonicalLane = z.infer<typeof canonicalLaneSchema>

type CommandResponse = {
    status: 200 | 400 | 404 | 409 | 500 | 503
    body: Record<string, unknown>
}

type GoalContext = {
    store: Store
    engine: SyncEngine | null
    namespace: string
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function getGoalContext(input: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    goalId: string
}): GoalContext | CommandResponse {
    const goal = input.store.goals.getGoalByNamespace(input.goalId, input.namespace)
    if (!goal) {
        return { status: 404, body: { error: 'Goal not found' } }
    }
    const project = input.store.projects.getProjectByNamespace(goal.projectId, input.namespace)
    if (!project) {
        return { status: 404, body: { error: 'Project not found' } }
    }
    const defaultWorkspace = getDefaultWorkspace(input.store, project)
    bootstrapGoalDocs({ project, goal, defaultWorkspace })
    return {
        store: input.store,
        engine: input.engine,
        namespace: input.namespace,
        project,
        goal,
        defaultWorkspace
    }
}

function isCommandResponse(value: GoalContext | CommandResponse): value is CommandResponse {
    return 'status' in value
}

function getTaskRole(task: Pick<StoredTask, 'role' | 'source' | 'status' | 'goalId'>): string | null {
    const explicit = task.role?.trim().toLowerCase()
    if (explicit) return explicit
    if (!task.goalId) return null
    const status = task.status.trim().toLowerCase()
    if (status === 'review' || status === 'in_review') return 'evaluator'
    const source = task.source?.trim().toLowerCase()
    if (source === 'planner' || source === 'radar' || source === 'evaluator') return source
    return 'generator'
}

function getTaskLane(task: StoredTask): CanonicalLane {
    const status = task.status.trim().toLowerCase()
    if (task.worktreeMergedAt || task.mergeRuntime?.status === 'succeeded' || status === 'done' || status === 'finished') {
        return 'done'
    }
    if (task.mergeRuntime) {
        return 'merging'
    }
    if (status === 'review' || status === 'in_review') return 'in_review'
    if (status === 'running' || status === 'in_progress') return 'in_progress'
    if (status === 'blocked') {
        if (task.previewRuntime?.status === 'blocked' || task.initRuntime?.status === 'blocked' || task.activeSessionId) return 'in_progress'
        return 'planned'
    }
    return 'planned'
}

function getInternalStatusForLane(lane: 'planned' | 'in_progress' | 'merging'): string {
    switch (lane) {
        case 'planned':
            return 'planning'
        case 'in_progress':
            return 'running'
        case 'merging':
            return 'review'
    }
}

function defaultMessageForLane(lane: 'planned' | 'in_progress' | 'merging'): string {
    switch (lane) {
        case 'planned':
            return 'The user re-added this task to the execution plan. Re-evaluate the current state and continue when conditions are satisfied.'
        case 'in_progress':
            return 'The user asked to continue this task. Resume using the existing context.'
        case 'merging':
            return 'The user asked to retry merging this task. Re-check the current base state before continuing.'
    }
}

function getTaskOr404(ctx: GoalContext, taskId: string): StoredTask | CommandResponse {
    const task = ctx.store.tasks.getTaskByNamespace(taskId, ctx.namespace)
    if (!task || task.projectId !== ctx.project.id || task.goalId !== ctx.goal.id || task.archivedAt) {
        return { status: 404, body: { error: 'Task not found' } }
    }
    return task
}

function taskDto(task: StoredTask, lane: CanonicalLane = getTaskLane(task)): Record<string, unknown> {
    return {
        ...task,
        lane,
        role: getTaskRole(task)
    }
}

function readPreferenceMarkdown(defaultWorkspace: StoredWorkspace | null): string {
    const path = getPreferencePath(defaultWorkspace)
    if (!path || !existsSync(path)) return ''
    return readFileSync(path, 'utf8')
}

function readGoalDesignMarkdown(ctx: GoalContext): string {
    const docsRoot = getDocsRoot(ctx.defaultWorkspace)
    if (!docsRoot) return ''
    const path = getGoalDesignPath(docsRoot, ctx.goal.goalKey)
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8')
}

function buildPlanningTaskContract(input: {
    goal: StoredGoal
    intent: string
    relatedTaskIds: string[]
    urgency: 'low' | 'normal' | 'high'
}): string {
    return [
        '## Type',
        'planning',
        '',
        '## Context',
        input.intent,
        '',
        '## Goal',
        `${input.goal.title} (${input.goal.goalKey})`,
        '',
        '## Related Tasks',
        input.relatedTaskIds.length > 0
            ? input.relatedTaskIds.map((taskId) => `- ${taskId}`).join('\n')
            : '- None.',
        '',
        '## Urgency',
        input.urgency,
        '',
        '## Acceptance',
        '- Read goal.md, design.md, todo.yml, decisions.yml, events.jsonl, and the current Goal kanban snapshot before planning.',
        '- Update design.md before creating or reshaping substantial engineering tasks.',
        '- Update the Goal docs and todo reservoir when planning state changes.',
        '- Create or reshape small executable kanban tasks through HOPI_ACTIONS.',
        '- Create a DecisionTopic instead of guessing when product intent is unclear.',
        '',
        '## Non-goals / Constraints',
        '- Do not implement source changes in this planning task.',
        '- Keep this task focused on Goal graph shaping.'
    ].join('\n')
}

function deriveDecisionBlockers(taskKeys: Array<string | null | undefined>, topics: StoredGoalDecisionTopic[]): Array<Record<string, unknown>> {
    const keys = new Set(taskKeys
        .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
        .map((key) => key.trim()))
    if (keys.size === 0) {
        return []
    }

    const blockers: Array<Record<string, unknown>> = []
    for (const topic of topics) {
        if (topic.taskId && keys.has(topic.taskId) && topic.blocking && topic.status === 'waiting') {
            blockers.push({
                kind: 'decision',
                topicId: topic.id,
                title: topic.title,
                summary: topic.body
            })
        }
    }
    return blockers
}

function deriveTaskBlockers(task: StoredTask, topics: StoredGoalDecisionTopic[]): Array<Record<string, unknown>> {
    const blockers: Array<Record<string, unknown>> = [
        ...deriveDecisionBlockers([task.id, task.goalTodoRef], topics)
    ]
    if (task.mergeRuntime?.status === 'blocked' || task.mergeRuntime?.status === 'canceled') {
        blockers.push({
            kind: 'merge',
            summary: task.mergeRuntime.blockedReason ?? task.mergeRuntime.latestNote ?? null,
            sessionId: task.mergeRuntime.sessionId ?? null
        })
    }
    if (task.initRuntime?.status === 'waiting' && task.initRuntime.failure?.code === 'runner_offline') {
        blockers.push({
            kind: 'runner_offline',
            summary: task.initRuntime.latestNote ?? task.initRuntime.failure.message,
            sessionId: task.initRuntime.sessionId ?? null
        })
    } else if (task.initRuntime?.status === 'blocked') {
        blockers.push({
            kind: 'runtime_start_failure',
            summary: task.initRuntime.blockedReason ?? task.initRuntime.latestNote ?? task.initRuntime.failure?.message ?? null,
            sessionId: task.initRuntime.sessionId ?? null
        })
    }
    if (task.previewRuntime?.status === 'blocked' || task.previewRuntime?.status === 'canceled') {
        blockers.push({
            kind: 'missing_output',
            summary: task.previewRuntime.blockedReason ?? task.previewRuntime.latestNote ?? null,
            sessionId: task.previewRuntime.sessionId ?? null
        })
    }
    if (task.status === 'blocked' && blockers.length === 0) {
        blockers.push({
            kind: 'manual_hold',
            summary: task.blockedReason
        })
    }
    return blockers
}

function laneForTodoSection(section: GoalTodoSection): CanonicalLane {
    if (section.status === 'done') return 'done'
    if (section.status === 'review') return section.tag === 'merging' ? 'merging' : 'in_review'
    if (section.status === 'running') return 'in_progress'
    return 'planned'
}

function deriveTodoSectionBlockers(section: GoalTodoSection, topics: StoredGoalDecisionTopic[]): Array<Record<string, unknown>> {
    const blockers = deriveDecisionBlockers([section.id, section.taskId, section.todoRef], topics)
    if (section.blocked) {
        blockers.push({
            kind: section.blocked.kind ?? 'blocked',
            summary: section.blocked.summary,
            updatedAt: section.blocked.updatedAt
        })
    }
    return blockers
}

function buildGoalStateTasks(ctx: GoalContext, topics: StoredGoalDecisionTopic[]): Array<Record<string, unknown>> {
    const todo = readGoalTodo({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace
    })
    const overlays = ctx.store.tasks.listTasksByProjectAndNamespace(ctx.project.id, ctx.namespace, {
        goalId: ctx.goal.id
    })
    const overlayByKey = new Map<string, StoredTask>()
    for (const task of overlays) {
        overlayByKey.set(task.id, task)
        if (task.goalTodoRef) {
            overlayByKey.set(task.goalTodoRef, task)
        }
    }

    const seenTaskIds = new Set<string>()
    const projected = todo.sections.map((section) => {
        const overlay = overlayByKey.get(section.id)
            ?? (section.taskId ? overlayByKey.get(section.taskId) : undefined)
            ?? (section.todoRef ? overlayByKey.get(section.todoRef) : undefined)
        const lane = laneForTodoSection(section)
        if (overlay) {
            seenTaskIds.add(overlay.id)
            return {
                ...taskDto(overlay, lane),
                goalTodoRef: overlay.goalTodoRef ?? section.id,
                title: section.title,
                description: section.body || overlay.description,
                kanbanStatus: section.status,
                kanbanTag: section.tag,
                dependencyTaskList: section.dependencyTaskList,
                blockers: [
                    ...deriveTodoSectionBlockers(section, topics),
                    ...deriveTaskBlockers(overlay, topics)
                ]
            }
        }
        return {
            id: section.id,
            projectId: ctx.project.id,
            goalId: ctx.goal.id,
            goalTodoRef: section.todoRef ?? section.id,
            title: section.title,
            description: section.body || null,
            status: section.status,
            lane,
            role: null,
            source: 'todo',
            kanbanStatus: section.status,
            kanbanTag: section.tag,
            dependencyTaskList: section.dependencyTaskList,
            blockers: deriveTodoSectionBlockers(section, topics)
        }
    })

    for (const task of overlays) {
        if (seenTaskIds.has(task.id)) {
            continue
        }
        projected.push({
            ...taskDto(task),
            blockers: deriveTaskBlockers(task, topics)
        })
    }

    return projected
}

function appendCommandRejected(ctx: GoalContext, input: {
    commandId: string
    command: string
    reason: string
    initiator?: GoalEventActor | null
}): void {
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'command_rejected',
        entity: { type: 'command', id: input.commandId },
        after: { command: input.command, rejected: true },
        reason: input.reason,
        initiator: input.initiator ?? null,
        source: { kind: 'command', id: input.commandId }
    })
}

function inspectGoalState(ctx: GoalContext): CommandResponse {
    const topics = readGoalDecisionTopicsWithLegacyBackfill({
        store: ctx.store,
        namespace: ctx.namespace,
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace
    })
    const openDecisionTopics = topics.filter((topic) => topic.status === 'waiting')
    const sessions = ctx.store.sessions.getSessionsByNamespace(ctx.namespace)
        .filter((session) => {
            const metadata = session.metadata
            return Boolean(
                metadata
                && typeof metadata === 'object'
                && !Array.isArray(metadata)
                && (metadata as { projectId?: unknown }).projectId === ctx.project.id
            )
        })

    return {
        status: 200,
        body: {
            ok: true,
            state: {
                goal: ctx.goal,
                tasks: buildGoalStateTasks(ctx, topics),
                openDecisionTopics,
                recentEvents: readGoalEvents({
                    project: ctx.project,
                    goal: ctx.goal,
                    defaultWorkspace: ctx.defaultWorkspace,
                    limit: 50
                }),
                laneBudgetSaturation: ctx.project.automationLaneLimits ?? null,
                activeRuntimes: sessions,
                preferenceMarkdown: readPreferenceMarkdown(ctx.defaultWorkspace),
                designMarkdown: readGoalDesignMarkdown(ctx)
            }
        }
    }
}

function inspectTaskHistory(ctx: GoalContext, command: Extract<GoalAssistantCommand, { command: 'inspect_task_history' }>): CommandResponse {
    const task = getTaskOr404(ctx, command.taskId)
    if ('status' in task && 'body' in task) return task
    const sessions = ctx.store.sessions.getSessionsByNamespace(ctx.namespace)
        .filter((session) => {
            const metadata = session.metadata
            return Boolean(
                metadata
                && typeof metadata === 'object'
                && !Array.isArray(metadata)
                && (metadata as { taskId?: unknown }).taskId === task.id
            )
        })
    return {
        status: 200,
        body: {
            ok: true,
            task: taskDto(task),
            events: readGoalEvents({
                project: ctx.project,
                goal: ctx.goal,
                defaultWorkspace: ctx.defaultWorkspace,
                entity: { type: 'task', id: task.id },
                limit: 100
            }),
            sessions: sessions.map((session) => ({
                session,
                messages: ctx.store.messages.getMessages(session.id, 20)
            })),
            runtimeSummaries: {
                activeSessionId: task.activeSessionId,
                initRuntime: task.initRuntime,
                previewRuntime: task.previewRuntime,
                mergeRuntime: task.mergeRuntime
            }
        }
    }
}

function requestPlanning(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'request_planning' }>): CommandResponse {
    const title = command.intent.split(/[.\n]/u)[0]?.trim().slice(0, 120) || 'Plan next Goal work'
    const urgency = command.urgency ?? 'normal'
    const taskId = createGoalTodoTaskId({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        title
    })
    const task = ctx.store.tasks.createTask({
        id: taskId,
        projectId: ctx.project.id,
        goalId: ctx.goal.id,
        goalTodoRef: taskId,
        title,
        description: command.intent,
        status: 'planning',
        role: 'planner',
        source: 'cto_assistant',
        sourceTaskId: null,
        priority: urgency === 'high' ? 'high' : urgency === 'low' ? 'low' : 'medium',
        sortKey: Date.now(),
        workspaceId: ctx.defaultWorkspace?.id ?? null,
        ...getProjectDefaultTaskRuntimeSettings(ctx.project, { autonomous: true }),
        workflowProfile: 'default',
        contract: buildPlanningTaskContract({
            goal: ctx.goal,
            intent: command.intent,
            relatedTaskIds: command.relatedTaskIds ?? [],
            urgency
        })
    })
    upsertGoalTodoTaskState({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        taskId,
        status: 'planning',
        tag: 'ready',
        title: task.title,
        body: task.description
    })
    ctx.engine?.handleRealtimeEvent({
        type: 'task-added',
        taskId,
        projectId: ctx.project.id,
        namespace: ctx.namespace,
        data: { taskId }
    })
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'planner_task_created',
        entity: { type: 'task', id: task.id },
        after: {
            lane: 'planned',
            role: 'planner',
            source: 'cto_assistant'
        },
        reason: command.intent,
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return {
        status: 200,
        body: {
            ok: true,
            commandId,
            task: taskDto(task)
        }
    }
}

function requestTaskLane(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'request_task_lane' }>): CommandResponse {
    const task = getTaskOr404(ctx, command.taskId)
    if ('status' in task && 'body' in task) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Task not found',
            initiator: command.initiator ?? null
        })
        return task
    }
    const beforeLane = getTaskLane(task)
    const now = Date.now()
    const updated = ctx.store.tasks.updateTaskByNamespace(task.id, ctx.namespace, {
        status: getInternalStatusForLane(command.lane),
        handoff: command.message ?? defaultMessageForLane(command.lane),
        mergeRuntime: command.lane === 'merging'
            ? buildTaskMergeRuntime({
                current: task.mergeRuntime,
                activeSessionId: task.activeSessionId,
                status: 'queued',
                latestNote: command.message ?? defaultMessageForLane(command.lane),
                requestedAt: now
            })
            : task.mergeRuntime
    })
    if (!updated) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Task update failed',
            initiator: command.initiator ?? null
        })
        return { status: 500, body: { error: 'Task update failed' } }
    }
    ctx.engine?.handleRealtimeEvent({
        type: 'task-updated',
        taskId: updated.id,
        projectId: updated.projectId,
        namespace: ctx.namespace,
        data: { taskId: updated.id }
    })
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'task_lane_changed',
        entity: { type: 'task', id: updated.id },
        before: { lane: beforeLane },
        after: { lane: getTaskLane(updated) },
        reason: command.reason,
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return {
        status: 200,
        body: { ok: true, commandId, task: taskDto(updated) }
    }
}

async function startOrResumeTask(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'start_or_resume_task' }>): Promise<CommandResponse> {
    const task = getTaskOr404(ctx, command.taskId)
    if ('status' in task && 'body' in task) return task
    if (!ctx.engine) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Sync engine unavailable',
            initiator: command.initiator ?? null
        })
        return { status: 503, body: { error: 'Not connected' } }
    }
    const continued = await continueTaskInLinkedSession({
        store: ctx.store,
        engine: ctx.engine,
        namespace: ctx.namespace,
        taskId: task.id
    })
    const result = continued ?? await startSessionFromTask({
        store: ctx.store,
        engine: ctx.engine,
        namespace: ctx.namespace,
        taskId: task.id
    })
    if (!result.ok) {
        const waitingTask = result.error.code === 'runner_offline'
            ? ctx.store.tasks.updateTaskByNamespace(task.id, ctx.namespace, {
                initRuntime: buildTaskInitRuntime({
                    current: task.initRuntime,
                    activeSessionId: task.activeSessionId,
                    status: 'waiting',
                    failure: result.error,
                    failureFingerprint: `start:${result.error.code}`,
                    latestNote: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。'
                })
            })
            : null
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: result.error.message,
            initiator: command.initiator ?? null
        })
        return {
            status: 409,
            body: {
                ok: false,
                error: result.error.message,
                task: waitingTask ? taskDto(waitingTask) : taskDto(task)
            }
        }
    }
    const updated = ctx.store.tasks.getTaskByNamespace(task.id, ctx.namespace) ?? task
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'task_start_requested',
        entity: { type: 'task', id: task.id },
        before: { lane: getTaskLane(task) },
        after: { lane: getTaskLane(updated), sessionId: result.sessionId },
        reason: command.reason,
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return { status: 200, body: { ok: true, commandId, sessionId: result.sessionId, task: taskDto(updated) } }
}

function retryTaskMerge(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'retry_task_merge' }>): CommandResponse {
    const task = getTaskOr404(ctx, command.taskId)
    if ('status' in task && 'body' in task) return task
    if (!ctx.engine) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Sync engine unavailable',
            initiator: command.initiator ?? null
        })
        return { status: 503, body: { error: 'Not connected' } }
    }
    requestAutoMergeAcceptedTask({
        store: ctx.store,
        engine: ctx.engine,
        namespace: ctx.namespace,
        taskId: task.id
    })
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'merge_retry_requested',
        entity: { type: 'task', id: task.id },
        before: { lane: getTaskLane(task), mergeRuntime: task.mergeRuntime },
        after: { lane: 'merging' },
        reason: command.reason,
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return { status: 200, body: { ok: true, commandId, task: taskDto(task) } }
}

function answerDecisionTopic(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'answer_decision_topic' }>): CommandResponse {
    const current = readGoalDecisionTopicsWithLegacyBackfill({
        store: ctx.store,
        namespace: ctx.namespace,
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace
    }).find((topic) => topic.id === command.topicId) ?? null
    if (!current) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Topic not found',
            initiator: command.initiator ?? null
        })
        return { status: 404, body: { error: 'Topic not found' } }
    }
    if (current.status !== 'waiting') {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Topic is already resolved',
            initiator: command.initiator ?? null
        })
        return { status: 409, body: { error: 'Topic is already resolved' } }
    }
    const topic = resolveGoalDecisionTopicInDocs({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        topicId: command.topicId,
        resolution: command.answer
    })
    if (!topic) return { status: 404, body: { error: 'Topic not found' } }

    const remainingBlockingTopics = topic.blocking
        ? readGoalDecisionTopics({
            project: ctx.project,
            goal: ctx.goal,
            defaultWorkspace: ctx.defaultWorkspace
        })
            .filter((candidate) => candidate.blocking && candidate.status === 'waiting')
        : []
    const remainingBlockingGoalTopics = remainingBlockingTopics
        .filter((candidate) => candidate.scope === 'goal')
    if (topic.blocking && topic.taskId) {
        const stillBlocked = remainingBlockingTopics.some((candidate) => (
            candidate.taskId === topic.taskId
            && candidate.blocking
            && candidate.status === 'waiting'
        ))
        if (!stillBlocked) {
            const task = ctx.store.tasks.getTaskByNamespace(topic.taskId, ctx.namespace)
            if (task) {
                const updatedTask = ctx.store.tasks.updateTaskByNamespace(task.id, ctx.namespace, {
                    status: task.status === 'blocked' ? 'planning' : task.status,
                    handoff: prependTaskHandoffDecisionContext(task, topic),
                    blockedReason: null,
                    blockedSource: null,
                    blockedSessionId: null
                })
                if (updatedTask) {
                    ctx.engine?.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: updatedTask.id,
                        projectId: updatedTask.projectId,
                        namespace: ctx.namespace,
                        data: { taskId: updatedTask.id }
                    })
                }
            }
        }
    }
    if (topic.blocking && topic.scope === 'goal' && remainingBlockingGoalTopics.length === 0) {
        const goal = ctx.store.goals.getGoalByNamespace(topic.goalId, ctx.namespace)
        if (goal?.status === 'blocked') {
            ctx.store.goals.updateGoalByNamespace(goal.id, ctx.namespace, {
                status: 'active'
            })
        }
    }
    ctx.engine?.handleRealtimeEvent({
        type: 'project-updated',
        projectId: topic.projectId,
        namespace: ctx.namespace,
        data: { projectId: topic.projectId }
    })
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'decision_topic_resolved',
        entity: { type: 'decision_topic', id: topic.id },
        before: {
            status: current.status,
            taskId: current.taskId
        },
        after: {
            status: topic.status,
            taskId: topic.taskId,
            resolution: topic.resolution
        },
        reason: command.reason ?? command.answer,
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return { status: 200, body: { ok: true, commandId, topic } }
}

function writePreference(ctx: GoalContext, commandId: string, command: Extract<GoalAssistantCommand, { command: 'write_preference' }>): CommandResponse {
    const path = getPreferencePath(ctx.defaultWorkspace)
    if (!path) {
        appendCommandRejected(ctx, {
            commandId,
            command: command.command,
            reason: 'Project has no workspace',
            initiator: command.initiator ?? null
        })
        return { status: 400, body: { error: 'Project has no workspace' } }
    }
    const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(path, command.markdown, 'utf8')
    appendGoalEvent({
        project: ctx.project,
        goal: ctx.goal,
        defaultWorkspace: ctx.defaultWorkspace,
        action: 'preference_written',
        entity: { type: 'preference', id: 'global' },
        before: { markdown: before },
        after: { markdown: command.markdown },
        reason: 'Assistant updated durable preference memory.',
        initiator: command.initiator ?? null,
        source: { kind: 'command', id: commandId }
    })
    return { status: 200, body: { ok: true, commandId, markdown: command.markdown } }
}

export async function executeGoalAssistantCommand(input: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    goalId: string
    rawCommand: unknown
}): Promise<CommandResponse> {
    const parsed = goalAssistantCommandSchema.safeParse(input.rawCommand)
    if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid body' } }
    }
    const ctx = getGoalContext(input)
    if (isCommandResponse(ctx)) return ctx

    const command = parsed.data
    const commandId = randomUUID()
    switch (command.command) {
        case 'inspect_goal_state':
            return inspectGoalState(ctx)
        case 'inspect_task_history':
            return inspectTaskHistory(ctx, command)
        case 'request_task_lane':
            return requestTaskLane(ctx, commandId, command)
        case 'start_or_resume_task':
            return await startOrResumeTask(ctx, commandId, command)
        case 'retry_task_merge':
            return retryTaskMerge(ctx, commandId, command)
        case 'request_planning':
            return requestPlanning(ctx, commandId, command)
        case 'answer_decision_topic':
            return answerDecisionTopic(ctx, commandId, command)
        case 'read_preference':
            return {
                status: 200,
                body: {
                    ok: true,
                    markdown: readPreferenceMarkdown(ctx.defaultWorkspace)
                }
            }
        case 'write_preference':
            return writePreference(ctx, commandId, command)
    }
}
