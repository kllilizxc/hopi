import { z } from 'zod'
import type { Store, StoredGoal, StoredProject, StoredSession, StoredTask, StoredWorkspace } from '../../store'
import { buildTaskMergeRuntime } from '../../utils/taskActionRuntime'
import {
    PlannerMailKindSchema,
    readGlobalPreferenceMarkdown,
    writeGlobalPreferenceMarkdown
} from '../operator/operatorDocs'
import { OPERATOR_CONSOLE_CAPABILITY_PROFILE } from '../operatorConsole'
import type { SyncEngine } from '../syncEngine'
import { requestAutoMergeAcceptedTask } from '../taskAutoMerge'
import { formatCountByStatus } from './context'
import {
    applyResolvedDecisionTopicState,
    emitAssistantSessionUpdated,
    emitProjectUpdated,
    emitTaskUpdated
} from './events'
import { resolveProjectAssistantIntervention } from './interventions'
import { getAssistantMetadata } from './metadata'
import { sendProjectAssistantPlannerMail } from './plannerMail'
import { findProjectWorkspace, getProject } from './projectStore'
import type { AssistantMetadata } from './types'

const operatorToolNameSchema = z.enum([
    'hopi_project_snapshot',
    'hopi_resolve_decision',
    'hopi_send_planner_mail',
    'hopi_retry_blocked_merge',
    'hopi_unblock_task',
    'hopi_pause_goal_automation',
    'hopi_resume_goal_automation',
    'hopi_read_preference',
    'hopi_write_preference'
])

export type ProjectAssistantOperatorToolName = z.infer<typeof operatorToolNameSchema>

const projectScopeInputSchema = z.object({
    projectId: z.string().trim().min(1).optional()
})

const operatorToolInputSchemas = {
    hopi_project_snapshot: projectScopeInputSchema.extend({
        goalId: z.string().trim().min(1).nullable().optional()
    }),
    hopi_resolve_decision: projectScopeInputSchema.extend({
        topicId: z.string().trim().min(1),
        resolution: z.string().trim().min(1).max(20_000)
    }),
    hopi_send_planner_mail: projectScopeInputSchema.extend({
        goalId: z.string().trim().min(1),
        kind: PlannerMailKindSchema,
        body: z.string().trim().min(1).max(20_000),
        quote: z.string().trim().max(2_000).optional()
    }),
    hopi_retry_blocked_merge: projectScopeInputSchema.extend({
        taskId: z.string().trim().min(1),
        note: z.string().trim().max(2_000).optional()
    }),
    hopi_unblock_task: projectScopeInputSchema.extend({
        taskId: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(2_000),
        userConfirmationQuote: z.string().trim().min(1).max(2_000)
    }),
    hopi_pause_goal_automation: projectScopeInputSchema.extend({
        goalId: z.string().trim().min(1)
    }),
    hopi_resume_goal_automation: projectScopeInputSchema.extend({
        goalId: z.string().trim().min(1)
    }),
    hopi_read_preference: projectScopeInputSchema.extend({
        path: z.string().trim().optional()
    }),
    hopi_write_preference: projectScopeInputSchema.extend({
        path: z.string().trim().optional(),
        markdown: z.string().trim().min(1).max(50_000)
    })
} satisfies Record<ProjectAssistantOperatorToolName, z.ZodType>

export type ProjectAssistantOperatorToolResult =
    | { ok: true; result: unknown }
    | { ok: false; error: string }

type OperatorToolContext = {
    session: StoredSession
    metadata: AssistantMetadata
    project: StoredProject
    workspace: StoredWorkspace
}

function getOperatorToolContext(options: {
    store: Store
    namespace: string
    sessionId: string
    projectId?: string | null
}): { ok: true; context: OperatorToolContext } | { ok: false; error: string } {
    const session = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!session) {
        return { ok: false, error: 'Assistant session not found' }
    }
    const metadata = getAssistantMetadata(session)
    if (!metadata || metadata.capabilityProfile !== OPERATOR_CONSOLE_CAPABILITY_PROFILE) {
        return { ok: false, error: 'Session is not an operator console assistant' }
    }
    if (options.projectId && options.projectId !== metadata.projectId) {
        return { ok: false, error: 'Operator tool project scope mismatch' }
    }
    const project = options.store.projects.getProjectByNamespace(metadata.projectId, options.namespace)
    if (!project) {
        return { ok: false, error: 'Project not found' }
    }
    const workspace = findProjectWorkspace(options.store, project)
    if (!workspace) {
        return { ok: false, error: 'Project default workspace is required' }
    }
    return { ok: true, context: { session, metadata, project, workspace } }
}

function getScopedGoal(options: {
    store: Store
    namespace: string
    metadata: AssistantMetadata
    projectId: string
    goalId: string
}): { ok: true; goal: StoredGoal } | { ok: false; error: string } {
    if (options.metadata.goalId && options.goalId !== options.metadata.goalId) {
        return { ok: false, error: 'Operator tool goal scope mismatch' }
    }
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== options.projectId || goal.archivedAt) {
        return { ok: false, error: 'Goal not found' }
    }
    return { ok: true, goal }
}

function getScopedTask(options: {
    store: Store
    namespace: string
    metadata: AssistantMetadata
    projectId: string
    taskId: string
}): { ok: true; task: StoredTask } | { ok: false; error: string } {
    if (options.metadata.taskId && options.taskId !== options.metadata.taskId) {
        return { ok: false, error: 'Operator tool task scope mismatch' }
    }
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || task.projectId !== options.projectId || task.archivedAt) {
        return { ok: false, error: 'Task not found' }
    }
    if (options.metadata.goalId && task.goalId !== options.metadata.goalId) {
        return { ok: false, error: 'Operator tool goal scope mismatch' }
    }
    return { ok: true, task }
}

function normalizePreferenceToolPath(value: unknown): string {
    const raw = typeof value === 'string' && value.trim().length > 0
        ? value.trim().replace(/\\/g, '/')
        : '.hopi/preference.md'
    if (raw.startsWith('/') || raw.includes('..')) {
        throw new Error('Preference writes are limited to .hopi/preference.md')
    }
    const normalized = raw.startsWith('./') ? raw.slice(2) : raw
    if (normalized !== '.hopi/preference.md') {
        throw new Error('Preference writes are limited to .hopi/preference.md')
    }
    return normalized
}

function taskHasWaitingDecision(options: {
    store: Store
    namespace: string
    task: StoredTask
}): boolean {
    if (!options.task.goalId) {
        return false
    }
    return options.store.goalDecisionTopics
        .listByGoalAndNamespace(options.task.goalId, options.namespace)
        .some((topic) => (
            topic.taskId === options.task.id
            && topic.blocking
            && topic.status === 'waiting'
        ))
}

function buildUnblockHandoff(options: {
    previousHandoff: string | null
    reason: string
    userConfirmationQuote: string
}): string {
    return [
        options.previousHandoff?.trim() || null,
        [
            'Assistant unblock:',
            options.reason,
            `User confirmation: "${options.userConfirmationQuote}"`
        ].join('\n')
    ].filter(Boolean).join('\n\n')
}

function resolveAssistantDecisionTool(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    metadata: AssistantMetadata
    input: {
        topicId: string
        resolution: string
    }
}): boolean {
    const existingTopic = options.store.goalDecisionTopics.getByNamespace(options.input.topicId, options.namespace)
    if (!existingTopic || existingTopic.projectId !== options.projectId || existingTopic.status !== 'waiting') {
        return false
    }
    if (options.metadata.goalId && existingTopic.goalId !== options.metadata.goalId) {
        return false
    }
    if (options.metadata.taskId && existingTopic.taskId && existingTopic.taskId !== options.metadata.taskId) {
        return false
    }

    const topic = options.store.goalDecisionTopics.resolveByNamespace(existingTopic.id, options.namespace, options.input.resolution)
    if (!topic) {
        return false
    }

    applyResolvedDecisionTopicState({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        topic
    })

    for (const session of options.store.sessions.getSessionsByNamespace(options.namespace)) {
        const metadata = getAssistantMetadata(session)
        if (!metadata) continue
        if (metadata.projectId !== options.projectId) continue
        if (metadata.interventionKey !== `decision-topic:${topic.id}`) continue
        if (metadata.interventionStatus !== 'pending') continue
        const resolvedSession = resolveProjectAssistantIntervention({
            store: options.store,
            namespace: options.namespace,
            sessionId: session.id,
            projectId: options.projectId,
            status: 'resolved',
            actionId: 'assistant_resolve_decision',
            note: options.input.resolution
        })
        if (resolvedSession) {
            emitAssistantSessionUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: options.projectId,
                session: resolvedSession
            })
        }
    }

    return true
}

async function resolveRetrySessionId(options: {
    engine: SyncEngine
    namespace: string
    retrySessionId: string
}): Promise<string | null> {
    const existing = options.engine.getSessionByNamespace(options.retrySessionId, options.namespace)
    if (!existing?.metadata?.worktree) {
        return null
    }
    if (existing.active !== false) {
        return options.retrySessionId
    }

    const resumed = await options.engine.resumeSession(options.retrySessionId, options.namespace)
    if (resumed.type !== 'success') {
        return null
    }

    const resumedSession = options.engine.getSessionByNamespace(resumed.sessionId, options.namespace)
    return resumedSession && resumedSession.active !== false && resumedSession.metadata?.worktree
        ? resumed.sessionId
        : null
}

async function retryAssistantBlockedMergeAction(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    metadata: AssistantMetadata
    input: {
        taskId: string
        note?: string
    }
}): Promise<boolean> {
    const project = getProject(options.store, options.projectId, options.namespace)
    if (project.defaultSessionType !== 'worktree') {
        return false
    }

    const task = options.store.tasks.getTaskByNamespace(options.input.taskId, options.namespace)
    if (!task || task.projectId !== options.projectId || task.archivedAt) {
        return false
    }
    if (options.metadata.goalId && task.goalId !== options.metadata.goalId) {
        return false
    }
    if (options.metadata.taskId && task.id !== options.metadata.taskId) {
        return false
    }
    if (task.status !== 'blocked' || task.mergeRuntime?.status !== 'blocked') {
        return false
    }

    const activeSessionId = task.activeSessionId?.trim()
    const retrySessionId = task.mergeRuntime.sessionId?.trim() || activeSessionId
    if (!activeSessionId || !retrySessionId) {
        return false
    }

    const resolvedRetrySessionId = await resolveRetrySessionId({
        engine: options.engine,
        namespace: options.namespace,
        retrySessionId
    })
    if (!resolvedRetrySessionId) {
        return false
    }

    const retryCount = (task.mergeRuntime.retryCount ?? 0) + 1
    const updated = options.store.tasks.updateTaskByNamespace(task.id, options.namespace, {
        status: 'in_review',
        finishedAt: null,
        mergeRuntime: buildTaskMergeRuntime({
            current: task.mergeRuntime,
            activeSessionId: task.activeSessionId,
            status: 'retrying',
            sessionId: resolvedRetrySessionId,
            retryCount,
            latestNote: options.input.note ?? 'Assistant requested retry for the blocked auto-merge.',
            blockedReason: null,
            completedAt: null
        })
    })
    if (!updated) {
        return false
    }

    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: updated.id,
        projectId: updated.projectId,
        namespace: options.namespace,
        data: {
            taskId: updated.id,
            status: updated.status,
            finishedAt: updated.finishedAt,
            mergeRuntime: updated.mergeRuntime
        }
    })

    const requested = requestAutoMergeAcceptedTask({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        taskId: updated.id,
        preferredSessionId: resolvedRetrySessionId
    })
    if (!requested) {
        return false
    }

    for (const session of options.store.sessions.getSessionsByNamespace(options.namespace)) {
        const metadata = getAssistantMetadata(session)
        if (!metadata) continue
        if (metadata.projectId !== options.projectId) continue
        if (metadata.interventionKey !== `merge-blocked:${updated.id}`) continue
        if (metadata.interventionStatus !== 'pending') continue
        const resolvedSession = resolveProjectAssistantIntervention({
            store: options.store,
            namespace: options.namespace,
            sessionId: session.id,
            projectId: options.projectId,
            status: 'resolved',
            actionId: 'assistant_retry_blocked_merge',
            note: 'Retrying blocked merge.'
        })
        if (resolvedSession) {
            emitAssistantSessionUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: options.projectId,
                session: resolvedSession
            })
        }
    }

    return true
}

export async function executeProjectAssistantOperatorTool(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    toolName: string
    input: unknown
}): Promise<ProjectAssistantOperatorToolResult> {
    const toolNameResult = operatorToolNameSchema.safeParse(options.toolName)
    if (!toolNameResult.success) {
        return { ok: false, error: 'Unknown operator tool' }
    }
    const toolName = toolNameResult.data

    try {
        if (toolName === 'hopi_project_snapshot') {
            const inputResult = operatorToolInputSchemas.hopi_project_snapshot.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata, project, workspace } = contextResult.context
            const requestedGoalId = typeof input.goalId === 'string' ? input.goalId : null
            const goalId = requestedGoalId ?? metadata.goalId ?? null
            if (goalId) {
                const scopedGoal = getScopedGoal({
                    store: options.store,
                    namespace: options.namespace,
                    metadata,
                    projectId: project.id,
                    goalId
                })
                if (!scopedGoal.ok) {
                    return scopedGoal
                }
            }
            const tasks = options.store.tasks.listTasksByProjectAndNamespace(project.id, options.namespace, {
                includeArchived: false,
                goalId
            })
            const goals = options.store.goals.listGoalsByProjectAndNamespace(project.id, options.namespace)
            const topics = goalId
                ? options.store.goalDecisionTopics.listByGoalAndNamespace(goalId, options.namespace)
                : goals.flatMap((goal) => options.store.goalDecisionTopics.listByGoalAndNamespace(goal.id, options.namespace))
            return {
                ok: true,
                result: {
                    project: {
                        id: project.id,
                        name: project.name,
                        autoRunEnabled: project.autoRunEnabled
                    },
                    scope: {
                        goalId,
                        taskId: metadata.taskId ?? null
                    },
                    workspace: {
                        id: workspace.id,
                        path: workspace.path
                    },
                    goals: goals.map((goal) => ({
                        id: goal.id,
                        goalKey: goal.goalKey,
                        title: goal.title,
                        status: goal.status,
                        autopilotEnabled: goal.autopilotEnabled,
                        automationPausedAt: goal.automationPausedAt
                    })),
                    taskCounts: formatCountByStatus(tasks),
                    tasks: tasks.slice(0, 80).map((task) => ({
                        id: task.id,
                        goalId: task.goalId,
                        title: task.title,
                        status: task.status,
                        priority: task.priority,
                        dependsOnTaskIds: task.dependsOnTaskIds,
                        blockedReason: task.blockedReason,
                        blockedSource: task.blockedSource,
                        mergeRuntime: task.mergeRuntime
                    })),
                    waitingDecisions: topics
                        .filter((topic) => topic.status === 'waiting')
                        .map((topic) => ({
                            id: topic.id,
                            goalId: topic.goalId,
                            taskId: topic.taskId,
                            title: topic.title,
                            body: topic.body,
                            blocking: topic.blocking
                        })),
                    preference: readGlobalPreferenceMarkdown(workspace.path)
                }
            }
        }

        if (toolName === 'hopi_resolve_decision') {
            const inputResult = operatorToolInputSchemas.hopi_resolve_decision.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata } = contextResult.context
            const applied = resolveAssistantDecisionTool({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                projectId: metadata.projectId,
                metadata,
                input
            })
            return applied
                ? { ok: true, result: { applied: true } }
                : { ok: false, error: 'Decision topic is not resolvable in this assistant scope' }
        }

        if (toolName === 'hopi_send_planner_mail') {
            const inputResult = operatorToolInputSchemas.hopi_send_planner_mail.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata, project } = contextResult.context
            const scopedGoal = getScopedGoal({
                store: options.store,
                namespace: options.namespace,
                metadata,
                projectId: project.id,
                goalId: input.goalId
            })
            if (!scopedGoal.ok) {
                return scopedGoal
            }
            const mail = sendProjectAssistantPlannerMail({
                store: options.store,
                namespace: options.namespace,
                projectId: project.id,
                goalId: scopedGoal.goal.id,
                kind: input.kind,
                body: input.body,
                source: {
                    sessionId: options.sessionId,
                    messageId: `operator-tool:${toolName}:${Date.now()}`,
                    quote: input.quote
                }
            })
            emitProjectUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id
            })
            return { ok: true, result: { mail } }
        }

        if (toolName === 'hopi_retry_blocked_merge') {
            const inputResult = operatorToolInputSchemas.hopi_retry_blocked_merge.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata, project } = contextResult.context
            const scopedTask = getScopedTask({
                store: options.store,
                namespace: options.namespace,
                metadata,
                projectId: project.id,
                taskId: input.taskId
            })
            if (!scopedTask.ok) {
                return scopedTask
            }
            const applied = await retryAssistantBlockedMergeAction({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id,
                metadata,
                input
            })
            return applied
                ? { ok: true, result: { taskId: scopedTask.task.id, retrying: true } }
                : { ok: false, error: 'Blocked merge is not currently retryable' }
        }

        if (toolName === 'hopi_unblock_task') {
            const inputResult = operatorToolInputSchemas.hopi_unblock_task.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata, project } = contextResult.context
            const scopedTask = getScopedTask({
                store: options.store,
                namespace: options.namespace,
                metadata,
                projectId: project.id,
                taskId: input.taskId
            })
            if (!scopedTask.ok) {
                return scopedTask
            }
            const task = scopedTask.task
            if (task.status !== 'blocked') {
                return { ok: false, error: 'Task is not blocked' }
            }
            if (task.blockedSource === 'merge' || task.mergeRuntime?.status === 'blocked') {
                return { ok: false, error: 'Merge-blocked tasks must use hopi_retry_blocked_merge' }
            }
            if (task.blockedSource === 'decision' || taskHasWaitingDecision({
                store: options.store,
                namespace: options.namespace,
                task
            })) {
                return { ok: false, error: 'Decision-blocked tasks must resolve the waiting decision topic' }
            }

            const updated = options.store.tasks.updateTaskByNamespace(task.id, options.namespace, {
                status: 'planned',
                handoff: buildUnblockHandoff({
                    previousHandoff: task.handoff,
                    reason: input.reason,
                    userConfirmationQuote: input.userConfirmationQuote
                })
            })
            if (!updated) {
                return { ok: false, error: 'Task not found' }
            }
            emitTaskUpdated({
                engine: options.engine,
                namespace: options.namespace,
                task: updated
            })
            emitProjectUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id
            })
            if (metadata.assistantKind === 'intervention' && metadata.interventionStatus === 'pending') {
                const resolvedSession = resolveProjectAssistantIntervention({
                    store: options.store,
                    namespace: options.namespace,
                    sessionId: options.sessionId,
                    projectId: project.id,
                    status: 'resolved',
                    actionId: 'assistant_unblock_task',
                    note: input.reason
                })
                if (resolvedSession) {
                    emitAssistantSessionUpdated({
                        engine: options.engine,
                        namespace: options.namespace,
                        projectId: project.id,
                        session: resolvedSession
                    })
                }
            }
            options.engine.requestAutoRunTick?.(options.namespace, project.id)
            return {
                ok: true,
                result: {
                    taskId: updated.id,
                    status: updated.status
                }
            }
        }

        if (toolName === 'hopi_pause_goal_automation' || toolName === 'hopi_resume_goal_automation') {
            const inputResult = operatorToolInputSchemas[toolName].safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { metadata, project } = contextResult.context
            const scopedGoal = getScopedGoal({
                store: options.store,
                namespace: options.namespace,
                metadata,
                projectId: project.id,
                goalId: input.goalId
            })
            if (!scopedGoal.ok) {
                return scopedGoal
            }
            const goal = options.store.goals.updateGoalByNamespace(input.goalId, options.namespace, {
                automationPausedAt: toolName === 'hopi_pause_goal_automation' ? Date.now() : null
            })
            if (!goal) {
                return { ok: false, error: 'Goal not found' }
            }
            emitProjectUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id
            })
            if (toolName === 'hopi_resume_goal_automation') {
                options.engine.requestAutoRunTick?.(options.namespace, project.id)
            }
            return { ok: true, result: { goal } }
        }

        if (toolName === 'hopi_read_preference') {
            const inputResult = operatorToolInputSchemas.hopi_read_preference.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { workspace } = contextResult.context
            try {
                normalizePreferenceToolPath(input.path)
            } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : 'Invalid preference path' }
            }
            return {
                ok: true,
                result: {
                    path: '.hopi/preference.md',
                    markdown: readGlobalPreferenceMarkdown(workspace.path) ?? ''
                }
            }
        }

        if (toolName === 'hopi_write_preference') {
            const inputResult = operatorToolInputSchemas.hopi_write_preference.safeParse(options.input ?? {})
            if (!inputResult.success) {
                return { ok: false, error: 'Invalid operator tool input' }
            }
            const input = inputResult.data
            const contextResult = getOperatorToolContext({
                store: options.store,
                namespace: options.namespace,
                sessionId: options.sessionId,
                projectId: input.projectId ?? null
            })
            if (!contextResult.ok) {
                return contextResult
            }
            const { project, workspace } = contextResult.context
            try {
                normalizePreferenceToolPath(input.path)
            } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : 'Invalid preference path' }
            }
            writeGlobalPreferenceMarkdown(workspace.path, input.markdown)
            emitProjectUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id
            })
            return {
                ok: true,
                result: {
                    path: '.hopi/preference.md',
                    markdown: readGlobalPreferenceMarkdown(workspace.path) ?? ''
                }
            }
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Operator tool failed' }
    }

    return { ok: false, error: 'Unknown operator tool' }
}
