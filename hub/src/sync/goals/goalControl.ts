import { randomUUID } from 'node:crypto'
import type { GoalAssistantTaskLane } from '@hopi/protocol/goal-assistant'
import { prependTaskHandoffDecisionContext } from './decisionHandoff'
import { appendGoalWorkflowEvent } from './goalEventLog'
import {
    createGoalDecisionTopicInDocs,
    findGoalDecisionTopicContext,
    listGoalDecisionTopicsFromDocs,
    resolveGoalDecisionTopicInDocs
} from './goalDecisionStore'
import {
    findGoalTodoTaskProjectionById,
    getTaskByNamespaceOrGoalTodoProjection,
    materializeGoalTodoTaskOverlayForWrite
} from './goalTodoProjection'
import { syncGoalOwnedDocs } from './goalDocs'
import { getDocsRoot, getGoalEventsPath } from './goalDocPaths'
import {
    readGoalTodo,
    upsertGoalTodoTaskState,
    type GoalTodoEventOptions,
    type GoalTodoStatus,
    type GoalTodoTaskKind
} from './goalTodo'
import {
    getGoalTodoStatusForStoredTask,
    getGoalTodoTagForStoredTask,
    hasStoredTaskBlock,
    isStoredTaskDecisionBlocked,
    recoverStoredTaskStatusFromLegacyBlocked
} from './goalTaskState'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildTaskMergeRuntime } from '../../utils/taskActionRuntime'

type GoalControlEngine = Pick<SyncEngine, 'handleRealtimeEvent' | 'requestAutoRunTick'>

function emitProjectUpdated(options: {
    engine: GoalControlEngine | null
    projectId: string
    namespace: string
}): void {
    options.engine?.handleRealtimeEvent({
        type: 'project-updated',
        projectId: options.projectId,
        namespace: options.namespace,
        data: { projectId: options.projectId }
    })
}

function emitTaskUpdated(options: {
    engine: GoalControlEngine | null
    projectId: string
    namespace: string
    taskId: string
}): void {
    options.engine?.handleRealtimeEvent({
        type: 'task-updated',
        taskId: options.taskId,
        projectId: options.projectId,
        namespace: options.namespace,
        data: { taskId: options.taskId }
    })
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function getGoalTodoTaskKindForStoredTask(task: Pick<StoredTask, 'source'>): GoalTodoTaskKind {
    return task.source === 'planner' || task.source === 'radar'
        ? 'planning'
        : 'engineering'
}

function resolveGoalDecisionTaskForWrite(options: {
    store: Store
    namespace: string
    project: StoredProject
    goal: StoredGoal
    taskId: string
}): { current: StoredTask; writable: StoredTask } | null {
    const existing = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (existing && existing.projectId === options.project.id && existing.goalId === options.goal.id && !existing.archivedAt) {
        const current = findGoalTodoTaskProjectionById({
            store: options.store,
            namespace: options.namespace,
            taskId: existing.goalTodoRef?.trim() || existing.id,
            includeArchived: false
        })
        if (!current || current.projectId !== options.project.id || current.goalId !== options.goal.id || current.archivedAt) {
            return null
        }
        return {
            current,
            writable: existing
        }
    }

    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId
    })
    if (!projected || projected.projectId !== options.project.id || projected.goalId !== options.goal.id || projected.archivedAt) {
        return null
    }

    const writable = materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: projected.id
    }) ?? materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: projected.goalTodoRef?.trim() || projected.id
    })
    if (!writable) {
        return null
    }

    const current = findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: writable.goalTodoRef?.trim() || writable.id,
        includeArchived: false
    })
    if (!current || current.projectId !== options.project.id || current.goalId !== options.goal.id || current.archivedAt) {
        return null
    }

    return {
        current,
        writable
    }
}

function appendGoalStatusWorkflowEvent(options: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    action: 'goal_blocked_by_decision' | 'goal_unblocked_from_decision'
    reason: string
    beforeStatus: StoredGoal['status']
    afterStatus: StoredGoal['status']
    metadata?: Record<string, unknown>
}): void {
    const docsRoot = getDocsRoot(options.defaultWorkspace)
    if (!docsRoot) {
        return
    }

    appendGoalWorkflowEvent(getGoalEventsPath(docsRoot, options.goal.goalKey), {
        writer: 'hopi-api',
        action: options.action,
        entity: {
            type: 'goal',
            id: options.goal.id
        },
        before: {
            goalId: options.goal.id,
            goalKey: options.goal.goalKey,
            status: options.beforeStatus
        },
        after: {
            goalId: options.goal.id,
            goalKey: options.goal.goalKey,
            status: options.afterStatus
        },
        reason: options.reason,
        metadata: {
            projectId: options.project.id,
            source: options.action === 'goal_blocked_by_decision'
                ? 'createGoalDecisionTopic'
                : 'resolveGoalDecisionTopic',
            ...(options.metadata ?? {})
        }
    })
}

function writeGoalTodoStateForTask(options: {
    store: Store
    project: StoredProject
    goal: StoredGoal
    task: StoredTask
    status: GoalTodoStatus
    tag?: string | null
    source?: StoredTask['source']
    blocked?: {
        kind: string | null
        summary: string | null
        updatedAt: number | null
    } | null
    event?: GoalTodoEventOptions
}): boolean {
    const goalTodoRef = options.task.goalTodoRef?.trim() || options.task.id
    const nextSource = options.source ?? options.task.source
    return upsertGoalTodoTaskState({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: getDefaultWorkspace(options.store, options.project),
        taskId: goalTodoRef,
        status: options.status,
        tag: options.tag,
        taskKind: getGoalTodoTaskKindForStoredTask({
            source: nextSource
        } as Pick<StoredTask, 'source'>),
        title: options.task.title,
        body: options.task.description,
        blocked: options.blocked ?? null,
        event: options.event
    })
}

function buildGoalTaskRuntimeFallback(options: {
    previousTask: StoredTask
    updatedTask: StoredTask
}): StoredTask {
    return {
        ...options.updatedTask,
        title: options.previousTask.title,
        description: options.previousTask.description,
        goalTodoRef: options.previousTask.goalTodoRef,
        subTasks: options.previousTask.subTasks,
        subTasksUpdatedAt: options.previousTask.subTasksUpdatedAt,
        attachments: options.previousTask.attachments
    }
}

function getProjectedGoalTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask | null {
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

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt,
        mergeRuntime: options.task.mergeRuntime,
        previewRuntime: options.task.previewRuntime,
        initRuntime: options.task.initRuntime
    }
}

function resolveGoalTaskRuntimeViewOrFallback(options: {
    store: Store
    namespace: string
    previousTask: StoredTask
    updatedTask: StoredTask
}): StoredTask {
    const projected = getProjectedGoalTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: options.updatedTask
    })
    if (projected) {
        return projected
    }
    return buildGoalTaskRuntimeFallback({
        previousTask: options.previousTask,
        updatedTask: options.updatedTask
    })
}

type ResolvedDecisionEffect = {
    topic: StoredGoalDecisionTopic
    goal: StoredGoal | null
    reactivatedGoal: boolean
    requeuedTaskId: string | null
    autoRunTriggered: boolean
}

type CreatedDecisionEffect = {
    topic: StoredGoalDecisionTopic
    goal: StoredGoal | null
    blockedTask: StoredTask | null
}

type RequestedTaskLaneEffect = {
    task: StoredTask
    lane: GoalAssistantTaskLane
    message: string
    requestId: string
}

export function createGoalDecisionTopic(options: {
    store: Store
    engine: GoalControlEngine | null
    namespace: string
    project: StoredProject
    goal: StoredGoal
    taskId?: string | null
    title: string
    body: string
    blocking?: boolean
    prompt?: string | null
    writer?: string
    reason?: string
    blockedSessionId?: string | null
}): CreatedDecisionEffect {
    const defaultWorkspace = getDefaultWorkspace(options.store, options.project)
    const projectedTask = options.taskId
        ? findGoalTodoTaskProjectionById({
            store: options.store,
            namespace: options.namespace,
            taskId: options.taskId,
            includeArchived: false
        })
        : null
    const canonicalTaskId = projectedTask
        && projectedTask.projectId === options.project.id
        && projectedTask.goalId === options.goal.id
        && !projectedTask.archivedAt
        ? (projectedTask.goalTodoRef?.trim() || projectedTask.id)
        : null
    const decisionTodoEventBase = {
        writer: options.writer ?? 'hopi-api',
        metadata: {
            source: 'createGoalDecisionTopic'
        }
    } satisfies Pick<GoalTodoEventOptions, 'writer' | 'metadata'>
    const topic = createGoalDecisionTopicInDocs({
        project: options.project,
        goal: options.goal,
        defaultWorkspace,
        id: randomUUID(),
        taskId: canonicalTaskId,
        title: options.title,
        body: options.body,
        blocking: options.blocking,
        prompt: options.prompt ?? null,
        writer: options.writer ?? 'hopi-api',
        reason: options.reason ?? 'Created a durable decision topic.'
    })

    let blockedTask: StoredTask | null = null
    let goal = options.goal
    if (topic.blocking && topic.taskId) {
        const resolvedTask = resolveGoalDecisionTaskForWrite({
            store: options.store,
            namespace: options.namespace,
            project: options.project,
            goal: options.goal,
            taskId: topic.taskId
        })
        if (resolvedTask && resolvedTask.current.status !== 'done' && resolvedTask.current.status !== 'finished' && !hasStoredTaskBlock(resolvedTask.current)) {
            const task = resolvedTask.current
            const writableTask = resolvedTask.writable
            const nextBlockedTask = {
                ...task,
                blockedReason: topic.body,
                blockedSource: 'decision',
                blockedSessionId: options.blockedSessionId ?? null
            } as StoredTask
            const blockedTodo = syncGoalTodoForBlockedDecision({
                store: options.store,
                namespace: options.namespace,
                project: options.project,
                goal: options.goal,
                task: nextBlockedTask,
                summary: topic.body,
                event: {
                    ...decisionTodoEventBase,
                    action: 'todo_item_blocked_by_decision',
                    reason: 'Created a blocking decision topic and marked the todo item blocked by that decision.',
                    metadata: {
                        ...decisionTodoEventBase.metadata,
                        topicId: topic.id,
                        taskId: task.id
                    }
                }
            })
            blockedTask = options.store.tasks.updateTaskByNamespace(writableTask.id, options.namespace, {
                goalTodoRef: blockedTodo.task.goalTodoRef?.trim() || writableTask.goalTodoRef || task.goalTodoRef,
                status: task.status,
                blockedReason: topic.body,
                blockedSource: 'decision',
                blockedSessionId: options.blockedSessionId ?? null
            })
            if (blockedTask) {
                const blockedRuntimeTask = getTaskByNamespaceOrGoalTodoProjection({
                    store: options.store,
                    namespace: options.namespace,
                    taskId: blockedTask.id
                }) ?? blockedTask
                if (!blockedTodo.wrote) {
                    blockedTodo.task = blockedRuntimeTask
                    blockedTask = syncGoalTodoForBlockedDecision({
                        store: options.store,
                        namespace: options.namespace,
                        project: options.project,
                        goal: options.goal,
                        task: blockedRuntimeTask,
                        summary: topic.body,
                        event: {
                            ...decisionTodoEventBase,
                            action: 'todo_item_blocked_by_decision',
                            reason: 'Created a blocking decision topic and marked the todo item blocked by that decision.',
                            metadata: {
                                ...decisionTodoEventBase.metadata,
                                topicId: topic.id,
                                taskId: task.id
                            }
                        }
                    }).task
                } else if (blockedRuntimeTask.goalTodoRef !== blockedTodo.task.goalTodoRef) {
                    blockedTask = {
                        ...blockedRuntimeTask,
                        goalTodoRef: blockedTodo.task.goalTodoRef
                    }
                } else {
                    blockedTask = blockedRuntimeTask
                }
                emitTaskUpdated({
                    engine: options.engine,
                    projectId: blockedTask.projectId,
                    namespace: options.namespace,
                    taskId: blockedTask.id
                })
            }
        }
    } else if (topic.blocking && goal.status !== 'blocked') {
        syncGoalOwnedDocs({
            project: options.project,
            goal: {
                ...goal,
                status: 'blocked'
            },
            defaultWorkspace
        })
        goal = options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
            status: 'blocked'
        }) ?? {
            ...goal,
            status: 'blocked'
        }
        appendGoalStatusWorkflowEvent({
            project: options.project,
            goal,
            defaultWorkspace,
            action: 'goal_blocked_by_decision',
            reason: 'Created a goal-level blocking decision topic and blocked the goal until it is resolved.',
            beforeStatus: options.goal.status,
            afterStatus: 'blocked',
            metadata: {
                topicId: topic.id
            }
        })
    }

    emitProjectUpdated({
        engine: options.engine,
        projectId: options.project.id,
        namespace: options.namespace
    })

    return {
        topic,
        goal,
        blockedTask
    }
}

export function requestGoalTaskLane(options: {
    store: Store
    engine: GoalControlEngine | null
    namespace: string
    project: StoredProject
    goal: StoredGoal
    taskId: string
    lane: GoalAssistantTaskLane
    message: string
    requestId?: string
}): RequestedTaskLaneEffect | null {
    const projected = findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId,
        includeArchived: false
    })
    if (!projected || projected.projectId !== options.project.id || projected.goalId !== options.goal.id || projected.archivedAt) {
        return null
    }

    const writable = materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: projected.id
    })
    if (!writable) {
        return null
    }

    const requestId = options.requestId?.trim() || randomUUID()
    const event: GoalTodoEventOptions = {
        writer: 'goal-assistant',
        action: 'todo_item_lane_requested',
        reason: options.lane === 'merging'
            ? 'User requested a merge retry for this todo item.'
            : 'User requested this todo item return to the planned lane.',
        metadata: {
            requestId,
            lane: options.lane,
            message: options.message,
            source: 'requestGoalTaskLane'
        }
    }
    const currentTask = projected
    let updated: StoredTask | null = null
    if (options.lane === 'merging') {
        const nextStatus = currentTask.status === 'done' || currentTask.status === 'finished'
            ? 'done'
            : 'review'
        const nextTag = nextStatus === 'done' ? 'accepted' : 'merging'
        const wroteDocsFirst = writeGoalTodoStateForTask({
            store: options.store,
            project: options.project,
            goal: options.goal,
            task: currentTask,
            status: nextStatus,
            tag: nextTag,
            blocked: null,
            event
        })
        updated = options.store.tasks.updateTaskByNamespace(writable.id, options.namespace, {
            status: currentTask.status === 'done' || currentTask.status === 'finished'
                ? currentTask.status
                : 'review',
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            finishedAt: null,
            mergeRuntime: buildTaskMergeRuntime({
                current: writable.mergeRuntime,
                activeSessionId: writable.activeSessionId,
                status: 'waiting',
                latestNote: options.message
            })
        })
        if (updated && !wroteDocsFirst) {
            const projectedUpdated = getProjectedGoalTaskRuntimeView({
                store: options.store,
                namespace: options.namespace,
                task: updated
            })
            if (projectedUpdated) {
                writeGoalTodoStateForTask({
                    store: options.store,
                    project: options.project,
                    goal: options.goal,
                    task: projectedUpdated,
                    status: nextStatus,
                    tag: nextTag,
                    blocked: null,
                    event
                })
            }
        }
    } else {
        const nextSource = currentTask.source === 'evaluator' ? 'manual' : currentTask.source
        const wroteDocsFirst = writeGoalTodoStateForTask({
            store: options.store,
            project: options.project,
            goal: options.goal,
            task: currentTask,
            status: 'planning',
            tag: 'ready',
            source: nextSource,
            blocked: null,
            event
        })
        updated = options.store.tasks.updateTaskByNamespace(writable.id, options.namespace, {
            status: 'planning',
            ...(writable.source === 'evaluator' ? { source: 'manual' } : {}),
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            finishedAt: null,
            worktreeMergedAt: null,
            worktreeMergeCommit: null,
            mergedDiffSnapshot: null,
            mergeRuntime: null
        })
        if (updated && !wroteDocsFirst) {
            const projectedUpdated = getProjectedGoalTaskRuntimeView({
                store: options.store,
                namespace: options.namespace,
                task: updated
            })
            if (projectedUpdated) {
                writeGoalTodoStateForTask({
                    store: options.store,
                    project: options.project,
                    goal: options.goal,
                    task: projectedUpdated,
                    status: 'planning',
                    tag: 'ready',
                    source: nextSource,
                    blocked: null,
                    event
                })
            }
        }
    }
    if (!updated) {
        return null
    }
    const runtimeTask = resolveGoalTaskRuntimeViewOrFallback({
        store: options.store,
        namespace: options.namespace,
        previousTask: currentTask,
        updatedTask: updated
    })
    emitTaskUpdated({
        engine: options.engine,
        projectId: runtimeTask.projectId,
        namespace: options.namespace,
        taskId: runtimeTask.id
    })
    emitProjectUpdated({
        engine: options.engine,
        projectId: options.project.id,
        namespace: options.namespace
    })
    if (typeof options.engine?.requestAutoRunTick === 'function') {
        options.engine.requestAutoRunTick(options.namespace, options.project.id)
    }

    return {
        task: runtimeTask,
        lane: options.lane,
        message: options.message,
        requestId
    }
}

export function resolveGoalDecisionTopic(options: {
    store: Store
    engine: GoalControlEngine | null
    namespace: string
    topicId: string
    resolution: string
    expectedProjectId?: string
    expectedGoalId?: string
}): ResolvedDecisionEffect | null {
    const context = findGoalDecisionTopicContext({
        store: options.store,
        namespace: options.namespace,
        topicId: options.topicId,
        includeArchived: true
    })
    if (!context) {
        return null
    }
    if (options.expectedProjectId && context.project.id !== options.expectedProjectId) {
        return null
    }
    if (options.expectedGoalId && context.goal.id !== options.expectedGoalId) {
        return null
    }

    const topic = resolveGoalDecisionTopicInDocs({
        project: context.project,
        goal: context.goal,
        defaultWorkspace: context.defaultWorkspace,
        topicId: options.topicId,
        resolution: options.resolution,
        writer: 'hopi-api',
        reason: 'Resolved a durable decision topic.'
    })
    if (!topic) {
        return null
    }

    let requeuedTaskId: string | null = null
    let reactivatedGoal = false

    const remainingBlockingGoalTopics = topic.blocking
        ? listGoalDecisionTopicsFromDocs({
            project: context.project,
            goal: context.goal,
            defaultWorkspace: context.defaultWorkspace
        })
            .filter((candidate) => candidate.blocking && candidate.status === 'waiting')
        : []

    if (topic.blocking && topic.taskId) {
        const stillBlocked = remainingBlockingGoalTopics
            .some((candidate) => candidate.taskId === topic.taskId && candidate.blocking && candidate.status === 'waiting')
        if (!stillBlocked) {
            const resolvedTask = resolveGoalDecisionTaskForWrite({
                store: options.store,
                namespace: options.namespace,
                project: context.project,
                goal: context.goal,
                taskId: topic.taskId
            })
            if (resolvedTask) {
                const task = resolvedTask.current
                const writableTask = resolvedTask.writable
                const decisionResolvedEvent: GoalTodoEventOptions = {
                    writer: 'hopi-api',
                    action: 'todo_item_unblocked_from_decision',
                    reason: 'Resolved the last blocking decision topic and returned the todo item to its owning lane.',
                    metadata: {
                        source: 'resolveGoalDecisionTopic',
                        topicId: topic.id,
                        taskId: task.id
                    }
                }
                const taskWasDecisionBlocked = isStoredTaskDecisionBlocked(task)
                const nextPlannedTask = {
                    ...task,
                    status: recoverStoredTaskStatusFromLegacyBlocked(task),
                    blockedReason: null,
                    blockedSource: null,
                    blockedSessionId: null,
                    handoff: prependTaskHandoffDecisionContext(task, topic)
                } as StoredTask
                const resolvedTodo = syncGoalTodoForResolvedDecision({
                    store: options.store,
                    namespace: options.namespace,
                    previousTask: task,
                    task: nextPlannedTask,
                    event: decisionResolvedEvent
                })
                const plannedTask = options.store.tasks.updateTaskByNamespace(writableTask.id, options.namespace, {
                    goalTodoRef: resolvedTodo.task.goalTodoRef?.trim() || writableTask.goalTodoRef || task.goalTodoRef,
                    status: recoverStoredTaskStatusFromLegacyBlocked(task),
                    blockedReason: null,
                    blockedSource: null,
                    blockedSessionId: null,
                    finishedAt: null,
                    handoff: prependTaskHandoffDecisionContext(task, topic)
                })
                if (plannedTask) {
                    if (taskWasDecisionBlocked) {
                        requeuedTaskId = plannedTask.id
                    }
                    const plannedRuntimeTask = getTaskByNamespaceOrGoalTodoProjection({
                        store: options.store,
                        namespace: options.namespace,
                        taskId: plannedTask.id
                    }) ?? plannedTask
                    if (!resolvedTodo.wrote) {
                        syncGoalTodoForResolvedDecision({
                            store: options.store,
                            namespace: options.namespace,
                            previousTask: task,
                            task: plannedRuntimeTask,
                            event: decisionResolvedEvent
                        })
                    }
                    emitTaskUpdated({
                        engine: options.engine,
                        projectId: plannedRuntimeTask.projectId,
                        namespace: options.namespace,
                        taskId: plannedRuntimeTask.id
                    })
                }
            }
        }
    }

    let goal = options.store.goals.getGoalByNamespace(context.goal.id, options.namespace)
    if (topic.blocking && remainingBlockingGoalTopics.length === 0 && goal?.status === 'blocked') {
        const nextGoal = {
            ...goal,
            status: 'active'
        } satisfies StoredGoal
        syncGoalOwnedDocs({
            project: context.project,
            goal: nextGoal,
            defaultWorkspace: context.defaultWorkspace
        })
        goal = options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
            status: 'active'
        }) ?? nextGoal
        appendGoalStatusWorkflowEvent({
            project: context.project,
            goal,
            defaultWorkspace: context.defaultWorkspace,
            action: 'goal_unblocked_from_decision',
            reason: 'Resolved the last blocking decision topic and reactivated the goal.',
            beforeStatus: 'blocked',
            afterStatus: 'active',
            metadata: {
                topicId: topic.id
            }
        })
        reactivatedGoal = true
    }

    emitProjectUpdated({
        engine: options.engine,
        projectId: context.project.id,
        namespace: options.namespace
    })

    const canRequestAutoRun = typeof options.engine?.requestAutoRunTick === 'function'
    const autoRunTriggered = Boolean(canRequestAutoRun && (reactivatedGoal || requeuedTaskId))
    if (autoRunTriggered) {
        options.engine?.requestAutoRunTick(options.namespace, context.project.id)
    }

    return {
        topic,
        goal,
        reactivatedGoal,
        requeuedTaskId,
        autoRunTriggered
    }
}

function syncGoalTodoForBlockedDecision(options: {
    store: Store
    namespace: string
    project: StoredProject
    goal: StoredGoal
    task: StoredTask
    summary: string
    event?: GoalTodoEventOptions
}): { task: StoredTask; wrote: boolean } {
    const task = ensureGoalTodoRefForTask(options)
    const taskId = task.goalTodoRef?.trim() || options.task.id
    const goalTodoState = {
        status: getGoalTodoStatusForStoredTask(task),
        tag: getGoalTodoTagForStoredTask(task)
    }
    const wrote = upsertGoalTodoTaskState({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: getDefaultWorkspace(options.store, options.project),
        taskId,
        status: goalTodoState.status,
        tag: goalTodoState.tag,
        title: task.title,
        body: task.description,
        blocked: {
            kind: 'decision',
            summary: options.summary,
            updatedAt: Date.now()
        },
        event: options.event
    })
    return {
        task: task.goalTodoRef === taskId ? task : {
            ...task,
            goalTodoRef: taskId
        },
        wrote
    }
}

function syncGoalTodoForResolvedDecision(options: {
    store: Store
    namespace: string
    previousTask: Pick<StoredTask, 'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'>
    task: StoredTask
    event?: GoalTodoEventOptions
}): { task: StoredTask; wrote: boolean } {
    if (!isStoredTaskDecisionBlocked(options.previousTask) || !options.task.goalId) {
        return { task: options.task, wrote: false }
    }
    const project = options.store.projects.getProjectByNamespace(options.task.projectId, options.namespace)
    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (!project || !goal) {
        return { task: options.task, wrote: false }
    }
    const task = ensureGoalTodoRefForTask({
        store: options.store,
        namespace: options.namespace,
        project,
        goal,
        task: options.task
    })
    const goalTodoState = {
        status: getGoalTodoStatusForStoredTask(task),
        tag: getGoalTodoTagForStoredTask(task)
    }

    const wrote = upsertGoalTodoTaskState({
        project,
        goal,
        defaultWorkspace: getDefaultWorkspace(options.store, project),
        taskId: task.goalTodoRef?.trim() || task.id,
        status: goalTodoState.status,
        tag: goalTodoState.tag,
        title: task.title,
        body: task.description,
        blocked: null,
        event: options.event
    })
    return { task, wrote }
}

function ensureGoalTodoRefForTask(options: {
    store: Store
    namespace: string
    project: StoredProject
    goal: StoredGoal
    task: StoredTask
}): StoredTask {
    const existingRef = options.task.goalTodoRef?.trim()
    if (existingRef) {
        return options.task
    }

    const todo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: getDefaultWorkspace(options.store, options.project)
    })
    const nextGoalTodoRef = todo.board.items.find((item) => item.taskId === options.task.id)?.ref?.trim() || options.task.id
    const updated = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        goalTodoRef: nextGoalTodoRef
    })
    const task = updated
        ? {
            ...options.task,
            goalTodoRef: updated.goalTodoRef?.trim() || nextGoalTodoRef
        }
        : {
        ...options.task,
        goalTodoRef: nextGoalTodoRef
    }
    return task.goalTodoRef === nextGoalTodoRef ? task : {
        ...task,
        goalTodoRef: nextGoalTodoRef
    }
}

export function resumeGoalAutomation(options: {
    store: Store
    engine: GoalControlEngine | null
    namespace: string
    goalId: string
}): StoredGoal | null {
    const existing = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!existing) {
        return null
    }

    const goal = options.store.goals.updateGoalByNamespace(options.goalId, options.namespace, {
        automationPausedAt: null
    })
    if (!goal) {
        return null
    }

    emitProjectUpdated({
        engine: options.engine,
        projectId: existing.projectId,
        namespace: options.namespace
    })
    if (typeof options.engine?.requestAutoRunTick === 'function') {
        options.engine.requestAutoRunTick(options.namespace, existing.projectId)
    }

    return goal
}
