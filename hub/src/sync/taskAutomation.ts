import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import type { DecryptedMessage, SyncEvent } from '@hopi/protocol/types'
import type { Store, StoredTask } from '../store'
import { buildTaskInitRuntime, buildTaskPreviewRuntime } from '../utils/taskActionRuntime'
import { loadProjectActionContractFromSession } from './actionContract'
import { applyGoalActionPacketFromSession } from './goals/goalActionPacket'
import { getDocsRoot } from './goals/goalDocPaths'
import {
    findGoalTodoTaskProjectionById,
    getTaskByNamespaceOrGoalTodoProjection,
    materializeGoalTodoTaskOverlayForWrite
} from './goals/goalTodoProjection'
import {
    buildGoalTodoBlockedStateFromStoredTask,
    getGoalTodoStatusForStoredTask,
    getGoalTodoTagForStoredTask,
    recoverStoredTaskStatusFromLegacyBlocked
} from './goals/goalTaskState'
import { type GoalTodoEventOptions, upsertGoalTodoTaskState } from './goals/goalTodo'
import { notifyProjectControllerTaskBlockedTransition } from './projectController'
import { requestAutoMergeAcceptedTask } from './taskAutoMerge'
import {
    resolveSessionPreferredRootPath,
    resolveSessionRootPathCandidates,
    resolveSessionWorktreePath
} from './sessionRootPaths'
import type { RpcPreviewStatus, SyncEngine } from './syncEngine'
import { getWorkflowStrategy } from './workflowStrategy'

const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'
const AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX = 'auto:merge_conflict_resolve:'
const AUTO_MERGE_RUNTIME_LOCAL_ID_PREFIX = 'auto:merge_runtime:'
const AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX = 'auto:preview_setup:'
const AUTO_WORKFLOW_LOCAL_ID_PREFIX = 'auto:workflow:'
const AUTO_BOOTSTRAP_REPAIR_LOCAL_ID_PREFIX = 'auto:bootstrap_repair:'
const AUTO_BOOTSTRAP_PREVIEW_REPAIR_LOCAL_ID_PREFIX = 'auto:bootstrap_preview_repair:'
const AUTO_TASK_KICKOFF_LOCAL_ID_PREFIX = 'auto:kickoff:'
const AUTO_TASK_BLOCKED_LOCAL_ID_PREFIX = 'auto:task_blocked:'
const BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS = 2
const BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS = 2
const BOOTSTRAP_PREVIEW_POLL_INTERVAL_MS = 1_000
const BOOTSTRAP_PREVIEW_TIMEOUT_MS = 120_000
const EVALUATOR_MISSING_ACTION_RETRY_MAX_ATTEMPTS = 1
const GOAL_ACTION_PACKET_INACTIVE_BLOCKED_REASON = 'Agent session became inactive before applying its final HOPI_ACTIONS packet.'
const RUNNER_OFFLINE_BLOCKED_REASON = 'Runner offline or not connected. Start it on the machine and try again: hopi runner start'

function buildGoalTodoAutomationEvent(
    action: string,
    reason: string,
    metadata?: Record<string, unknown>
): GoalTodoEventOptions {
    return {
        writer: 'task-automation',
        action,
        reason,
        metadata
    }
}

function isSameAutomationBlock(task: Pick<StoredTask, 'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'>, next: {
    status: StoredTask['status']
    blockedReason: string
    blockedSource: string
    blockedSessionId: string
}): boolean {
    return task.status === next.status
        && task.blockedReason === next.blockedReason
        && task.blockedSource === next.blockedSource
        && task.blockedSessionId === next.blockedSessionId
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

function buildTaskRuntimeFallback(options: {
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

function getTaskRuntimeViewOrFallback(options: {
    store: Store
    namespace: string
    previousTask: StoredTask
    updatedTask: StoredTask
}): StoredTask {
    const runtimeTask = getTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: options.updatedTask
    })
    if (!options.updatedTask.goalId || runtimeTask !== options.updatedTask) {
        return runtimeTask
    }

    return buildTaskRuntimeFallback({
        previousTask: options.previousTask,
        updatedTask: options.updatedTask
    })
}

function getMessageRole(message: DecryptedMessage): 'user' | 'assistant' | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role === 'user') return 'user'
    if (record.role === 'assistant' || record.role === 'agent') return 'assistant'
    return null
}

function getMessageSentFrom(message: DecryptedMessage): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record || !record.meta || typeof record.meta !== 'object') return null
    if (!('sentFrom' in record.meta)) return null
    const sentFrom = (record.meta as { sentFrom?: unknown }).sentFrom
    return typeof sentFrom === 'string' ? sentFrom : null
}

function containsText(value: unknown, needle: string): boolean {
    if (typeof value === 'string') return value.includes(needle)
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some((item) => containsText(item, needle))
    return Object.values(value).some((item) => containsText(item, needle))
}

function messageContainsGoalActionMarker(message: DecryptedMessage): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return false
    if (record.role !== 'assistant' && record.role !== 'agent') return false
    return containsText(record.content, 'HOPI_ACTIONS')
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isInternalAutomationLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX)
}

function isMergeConflictAutoResolveLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX)
}

function isMergeRuntimeLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_MERGE_RUNTIME_LOCAL_ID_PREFIX)
}

function isPreviewSetupLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX)
}

function isWorkflowAutomationLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_WORKFLOW_LOCAL_ID_PREFIX)
}

function isTaskKickoffLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_TASK_KICKOFF_LOCAL_ID_PREFIX)
}

function isReadyEventMessage(message: DecryptedMessage): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return false
    if (record.role !== 'assistant' && record.role !== 'agent') return false

    const content = record.content
    if (!content || typeof content !== 'object') return false
    if (!('type' in content) || (content as { type?: unknown }).type !== 'event') return false
    if (!('data' in content)) return false

    const data = (content as { data?: unknown }).data
    if (!data || typeof data !== 'object') return false
    if (!('type' in data)) return false
    return (data as { type?: unknown }).type === 'ready'
}

function isMergeRuntimeReadyEvent(message: DecryptedMessage): boolean {
    const details = getReadyEventDetails(message)
    return Boolean(details?.forLocalKey && isMergeRuntimeLocalId(details.forLocalKey))
}

type ReadyEventDetails = {
    forLocalKey: string | null
    hasAssistantReply: boolean | null
}

function getReadyEventDetails(message: DecryptedMessage): ReadyEventDetails | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null

    const content = record.content
    if (!content || typeof content !== 'object') return null
    if (!('type' in content) || (content as { type?: unknown }).type !== 'event') return null
    if (!('data' in content)) return null

    const data = (content as { data?: unknown }).data
    if (!data || typeof data !== 'object') return null
    if (!('type' in data) || (data as { type?: unknown }).type !== 'ready') return null

    const forLocalKey = 'forLocalKey' in data && typeof (data as { forLocalKey?: unknown }).forLocalKey === 'string'
        ? (data as { forLocalKey: string }).forLocalKey
        : null
    const hasAssistantReply = 'hasAssistantReply' in data && typeof (data as { hasAssistantReply?: unknown }).hasAssistantReply === 'boolean'
        ? (data as { hasAssistantReply: boolean }).hasAssistantReply
        : null

    return { forLocalKey, hasAssistantReply }
}

type ErrorEventDetails = {
    message: string | null
    reason: string | null
}

function getErrorEventDetails(message: DecryptedMessage): ErrorEventDetails | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null

    const content = record.content
    if (!content || typeof content !== 'object') return null
    if (!('type' in content) || (content as { type?: unknown }).type !== 'event') return null
    if (!('data' in content)) return null

    const data = (content as { data?: unknown }).data
    if (!data || typeof data !== 'object') return null
    if (!('type' in data) || (data as { type?: unknown }).type !== 'error') return null

    const messageText = 'message' in data && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message.trim()
        : ''
    const reason = 'reason' in data && typeof (data as { reason?: unknown }).reason === 'string'
        ? (data as { reason: string }).reason.trim()
        : ''

    return {
        message: messageText || null,
        reason: reason || null
    }
}

function getLegacyProcessExitedMessageDetails(message: DecryptedMessage): ErrorEventDetails | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null

    const content = record.content
    if (!content || typeof content !== 'object') return null
    if (!('type' in content) || (content as { type?: unknown }).type !== 'event') return null
    if (!('data' in content)) return null

    const data = (content as { data?: unknown }).data
    if (!data || typeof data !== 'object') return null
    if (!('type' in data) || (data as { type?: unknown }).type !== 'message') return null

    const messageText = 'message' in data && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message.trim()
        : ''

    if (!messageText || !messageText.toLowerCase().includes('process exited unexpectedly')) {
        return null
    }

    return {
        message: messageText,
        reason: 'process-exited'
    }
}

function getCodexErrorDetails(message: DecryptedMessage): ErrorEventDetails | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null

    const content = record.content
    if (!content || typeof content !== 'object') return null
    if (!('type' in content) || (content as { type?: unknown }).type !== 'codex') return null
    if (!('data' in content)) return null

    const data = (content as { data?: unknown }).data
    if (!data || typeof data !== 'object') return null
    if (!('type' in data) || (data as { type?: unknown }).type !== 'error') return null

    const messageText = 'message' in data && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message.trim()
        : ''
    const reason = 'reason' in data && typeof (data as { reason?: unknown }).reason === 'string'
        ? (data as { reason: string }).reason.trim()
        : ''

    return {
        message: messageText || null,
        reason: reason || 'task-failed'
    }
}

function getTaskInterruptionDetails(message: DecryptedMessage): ErrorEventDetails | null {
    return getErrorEventDetails(message) ?? getLegacyProcessExitedMessageDetails(message) ?? getCodexErrorDetails(message)
}

function formatBootstrapContractErrors(error: string): string {
    return error
        .split(/;\s*/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => `- ${part}`)
        .join('\n')
}

function buildBootstrapContractRepairPrompt(error: string, attempt: number): string {
    return [
        `The bootstrap contract at \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` is still invalid after your last turn.`,
        '',
        `Repair attempt: ${attempt}/${BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS}`,
        '',
        'Current validation errors:',
        formatBootstrapContractErrors(error),
        '',
        'Required next step:',
        `Edit \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` so it becomes a valid project action contract for this repository.`,
        '- Replace placeholder empty arrays with real setup steps and preview services.',
        '- Keep merge config concrete for this repo.',
        '- Re-check the file before stopping; do not leave it in a placeholder state.',
        '',
        'Do not finish this task until the contract is valid and review-ready.'
    ].join('\n')
}

function buildBootstrapPreviewFailureReason(preview: RpcPreviewStatus): string {
    if (preview.error && preview.error.trim().length > 0) {
        return preview.error.trim()
    }
    if (preview.status === 'stopped') {
        return 'Preview stopped before it became ready'
    }
    if (preview.status === 'idle') {
        return 'Preview returned to idle before it became ready'
    }
    return 'Preview did not become ready'
}

function buildBootstrapPreviewRepairPrompt(options: {
    error: string
    attempt: number
    rootPath: string
    mode: 'local' | 'worktree'
    preview: RpcPreviewStatus
}): string {
    const logTail = Array.isArray(options.preview.logTail)
        ? options.preview.logTail.map((line) => line.trim()).filter((line) => line.length > 0).slice(-8)
        : []

    const details = [
        `Repair attempt: ${options.attempt}/${BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS}`,
        `Preview mode: ${options.mode}`,
        `Preview root: ${options.rootPath}`,
        options.preview.command ? `Command: ${options.preview.command}` : null,
        options.preview.url ? `Last URL: ${options.preview.url}` : null,
        `Failure: ${options.error}`
    ].filter((line): line is string => Boolean(line))

    return [
        'The bootstrap preview probe failed after your last turn.',
        '',
        ...details,
        ...(logTail.length > 0
            ? [
                '',
                'Recent preview log tail:',
                ...logTail.map((line) => `- ${line}`)
            ]
            : []),
        '',
        'Required next step:',
        `Fix the repository and/or \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` so preview can start and become ready.`,
        '- Keep the contract valid.',
        '- Fix the actual preview startup problem, not just the schema.',
        '- Wait for HOPI to run the next preview probe after your changes.',
        '',
        'Do not finish this task until preview is ready.'
    ].join('\n')
}

function buildBootstrapPreviewTaskKey(linked: LinkedTask): string {
    return `${linked.namespace}:${linked.taskId}`
}

function appendTaskBlockedMessage(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    taskId: string
    reason: string
    localId: string
}): void {
    const message = options.store.messages.addMessage(options.sessionId, {
        role: 'assistant',
        content: {
            type: 'text',
            text: `Task blocked: ${options.reason}`
        },
        meta: {
            sentFrom: 'webapp',
            hopiEvent: 'task_blocked',
            taskId: options.taskId
        }
    }, options.localId)

    const handler = options.engine.handleRealtimeEvent
    if (typeof handler !== 'function') {
        return
    }

    handler.call(options.engine, {
        type: 'message-received',
        sessionId: options.sessionId,
        message: {
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }
    })
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function getBlockedReasonSpecificity(reason: string | null | undefined): number {
    const normalized = reason?.trim().toLowerCase() ?? ''
    if (!normalized) return 0
    if (normalized.includes('usage limit') || normalized.includes('rate limit') || normalized.includes('quota')) return 4
    if (normalized.includes('rpc handler not registered') || normalized.includes('missing ') || normalized.includes('invalid ')) return 3
    if (normalized.includes('check logs') || normalized.includes('systemerror state') || normalized === 'agent session reported an error') return 1
    return 2
}

function chooseBlockedReason(currentReason: string | null | undefined, nextReason: string): string {
    return getBlockedReasonSpecificity(currentReason) > getBlockedReasonSpecificity(nextReason)
        ? currentReason!.trim()
        : nextReason
}

function isAutomationPromptMessage(message: DecryptedMessage): boolean {
    if (!isTaskProgressPromptMessage(message)) return false
    return getMessageSentFrom(message) !== 'cli'
}

function isTaskProgressPromptMessage(message: DecryptedMessage): boolean {
    if (getMessageRole(message) !== 'user') return false
    if (isInternalAutomationLocalId(message.localId)) return false
    if (isMergeConflictAutoResolveLocalId(message.localId)) return false
    if (isMergeRuntimeLocalId(message.localId)) return false
    if (isPreviewSetupLocalId(message.localId)) return false
    if (isWorkflowAutomationLocalId(message.localId)) return false
    return true
}

type LinkedTask = {
    namespace: string
    projectId: string
    taskId: string
}

function isRunningTaskStatus(status: string | null | undefined): boolean {
    return status === 'running' || status === 'in_progress'
}

function isReviewTaskStatus(status: string | null | undefined): boolean {
    return status === 'review' || status === 'in_review'
}

function isDoneTaskStatus(status: string | null | undefined): boolean {
    return status === 'done' || status === 'finished'
}

function isTaskAlreadyMerged(task: Pick<StoredTask, 'finishedAt' | 'worktreeMergedAt' | 'mergeRuntime'>): boolean {
    return task.finishedAt !== null
        || task.worktreeMergedAt !== null
        || task.mergeRuntime?.status === 'succeeded'
}

function buildMergeResultResetPatch(task: Pick<StoredTask, 'finishedAt' | 'worktreeMergedAt' | 'worktreeMergeCommit' | 'mergedDiffSnapshot' | 'mergeRuntime'>): {
    finishedAt: null
    worktreeMergedAt: null
    worktreeMergeCommit: null
    mergedDiffSnapshot: null
    mergeRuntime: null
} | null {
    const hasMergeResult = task.finishedAt !== null
        || task.worktreeMergedAt !== null
        || task.worktreeMergeCommit !== null
        || task.mergedDiffSnapshot !== null
        || task.mergeRuntime !== null

    if (!hasMergeResult) {
        return null
    }

    return {
        finishedAt: null,
        worktreeMergedAt: null,
        worktreeMergeCommit: null,
        mergedDiffSnapshot: null,
        mergeRuntime: null
    }
}

function isRecoverableGoalActionPacketBlock(task: Pick<StoredTask, 'blockedReason' | 'blockedSource' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'>): boolean {
    return (
        task.blockedReason === GOAL_ACTION_PACKET_INACTIVE_BLOCKED_REASON
        && task.blockedSource === 'agent'
    ) || (
        task.blockedReason === RUNNER_OFFLINE_BLOCKED_REASON
        && task.blockedSource === 'scheduler'
    ) || task.blockedSource === 'merge'
        || task.blockedSource === 'preview'
        || task.blockedSource === 'init'
        || task.blockedSource === 'evaluator'
        || task.mergeRuntime?.status === 'blocked'
        || task.previewRuntime?.status === 'blocked'
        || task.initRuntime?.status === 'blocked'
    
}

function isRecoverableInactiveLiveMessageBlock(task: Pick<StoredTask, 'blockedReason' | 'blockedSource'>): boolean {
    return task.blockedReason === GOAL_ACTION_PACKET_INACTIVE_BLOCKED_REASON
        && task.blockedSource === 'agent'
}

function sessionHasPendingRequests(session: { agentState?: unknown } | null | undefined): boolean {
    const agentState = session?.agentState
    if (!agentState || typeof agentState !== 'object') return false
    const requests = (agentState as { requests?: unknown }).requests
    return Boolean(requests && typeof requests === 'object' && Object.keys(requests).length > 0)
}

function isStaleDbOnlyGoalTaskForSource(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
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
    const project = options.store.projects.getProjectByNamespace(options.task.projectId, options.namespace)
    if (!project) {
        return false
    }
    const defaultWorkspace = project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    if (!getDocsRoot(defaultWorkspace)) {
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
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'manual'
    })
}

function isStaleDbOnlyBootstrapGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'project_init'
    })
}

function isStaleDbOnlyRuntimeGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyManualGoalTask(options) || isStaleDbOnlyBootstrapGoalTask(options)
}

function getLinkedTaskFromSession(engine: SyncEngine, store: Store, sessionId: string): LinkedTask | null {
    const session = engine.getSession(sessionId)
    const namespace = session?.namespace
    const metadata = session?.metadata
    const projectId = metadata && typeof metadata === 'object' && 'projectId' in metadata
        ? (metadata as { projectId?: unknown }).projectId
        : undefined
    const taskId = metadata && typeof metadata === 'object' && 'taskId' in metadata
        ? (metadata as { taskId?: unknown }).taskId
        : undefined

    if (namespace && typeof projectId === 'string' && typeof taskId === 'string') {
        const projected = getTaskByNamespaceOrGoalTodoProjection({
            store,
            namespace,
            taskId
        })
        if (projected && projected.projectId === projectId) {
            if (isStaleDbOnlyRuntimeGoalTask({
                store,
                namespace,
                task: projected
            })) {
                return null
            }
            if (projected.goalId) {
                const writable = materializeGoalTodoTaskOverlayForWrite({
                    store,
                    namespace,
                    taskId
                })
                if (writable && writable.projectId === projectId) {
                    return { namespace, projectId, taskId: writable.id }
                }
            }
            return { namespace, projectId, taskId: projected.id }
        }

        const stored = store.tasks.getTaskByNamespace(taskId, namespace)
        if (stored && stored.projectId === projectId && isStaleDbOnlyRuntimeGoalTask({
            store,
            namespace,
            task: stored
        })) {
            return null
        }
        return { namespace, projectId, taskId }
    }

    if (!namespace) {
        return null
    }

    const candidates = store.tasks.listTasksByActiveSessionIdAndNamespace(sessionId, namespace)
        .filter((task) => !isStaleDbOnlyRuntimeGoalTask({
            store,
            namespace,
            task
        }))
    if (candidates.length === 0) {
        return null
    }

    if (typeof projectId === 'string') {
        const projectMatches = candidates.filter((task) => task.projectId === projectId)
        if (projectMatches.length === 1) {
            return { namespace, projectId: projectMatches[0].projectId, taskId: projectMatches[0].id }
        }
    }

    const inProgress = candidates.filter((task) => {
        const runtimeView = getTaskRuntimeView({
            store,
            namespace,
            task
        })
        return isRunningTaskStatus(runtimeView.status)
    })
    if (inProgress.length === 1) {
        return { namespace, projectId: inProgress[0].projectId, taskId: inProgress[0].id }
    }

    if (candidates.length === 1) {
        return { namespace, projectId: candidates[0].projectId, taskId: candidates[0].id }
    }

    return null
}

export class TaskAutomation {
    private readonly lastThinkingBySessionId: Map<string, boolean> = new Map()
    private readonly autoCommitInFlightBySessionId: Set<string> = new Set()
    private readonly bootstrapPreviewInFlightByTaskKey: Set<string> = new Set()
    private readonly appliedGoalActionPacketBySessionId: Set<string> = new Set()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {
    }

    private resolveRuntimeTask(
        task: StoredTask | null | undefined,
        namespace: string,
        previousTask?: StoredTask | null
    ): StoredTask | null {
        if (!task) {
            return null
        }
        if (previousTask) {
            return getTaskRuntimeViewOrFallback({
                store: this.store,
                namespace,
                previousTask,
                updatedTask: task
            })
        }
        return getTaskRuntimeView({
            store: this.store,
            namespace,
            task
        })
    }

    reconcileIdleGoalActionSessions(namespace: string, projectId: string): boolean {
        let reconciled = false
        for (const session of this.engine.getSessionsByNamespace(namespace)) {
            const metadata = toRecord(session.metadata)
            if (metadata?.projectId !== projectId) continue
            if (session.active === false || session.thinking) continue
            if (sessionHasPendingRequests(session)) continue

            const linked = getLinkedTaskFromSession(this.engine, this.store, session.id)
            if (!linked || linked.namespace !== namespace || linked.projectId !== projectId) continue

            const stored = this.store.tasks.getTaskByNamespace(linked.taskId, namespace)
            const task = stored ? getTaskRuntimeView({ store: this.store, namespace, task: stored }) : null
            if (!task || task.archivedAt || !task.goalId) continue
            if (
                !isRunningTaskStatus(task.status)
                && !isReviewTaskStatus(task.status)
                && !isRecoverableGoalActionPacketBlock(task)
            ) {
                continue
            }

            if (this.tryReplayIdleSessionCompletion(session.id)) {
                reconciled = true
            }
        }
        return reconciled
    }

    private syncGoalTodo(
        updatedTask: ReturnType<Store['tasks']['getTaskByNamespace']>,
        namespace: string,
        previousTask?: Pick<
            NonNullable<ReturnType<Store['tasks']['getTaskByNamespace']>>,
            'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'
        > | null,
        event?: GoalTodoEventOptions
    ): void {
        const runtimeTask = this.resolveRuntimeTask(updatedTask, namespace)
        if (!runtimeTask) return
        this.writeGoalTodoStateForTask({
            task: runtimeTask,
            namespace,
            event
        })
        notifyProjectControllerTaskBlockedTransition({
            store: this.store,
            engine: this.engine,
            namespace,
            previousTask,
            task: runtimeTask
        })
    }

    private syncGoalTodoBeforeTaskUpdate(options: {
        currentTask: StoredTask
        namespace: string
        patch: Partial<StoredTask>
        event?: GoalTodoEventOptions
    }): boolean {
        const currentTask = getProjectedTaskRuntimeView({
            store: this.store,
            namespace: options.namespace,
            task: options.currentTask
        })
        if (!currentTask || !currentTask.goalId || !currentTask.goalTodoRef) {
            return false
        }

        const nextTask = {
            ...currentTask,
            ...options.patch
        } as StoredTask

        return this.writeGoalTodoStateForResolvedTask({
            task: nextTask,
            namespace: options.namespace,
            event: options.event
        })
    }

    private writeGoalTodoStateForTask(options: {
        task: StoredTask
        namespace: string
        event?: GoalTodoEventOptions
    }): boolean {
        if (!options.task.goalId || !options.task.goalTodoRef) {
            return false
        }
        const task = getProjectedTaskRuntimeView({
            store: this.store,
            namespace: options.namespace,
            task: options.task
        })
        if (!task || !task.goalId || !task.goalTodoRef) {
            return false
        }

        return this.writeGoalTodoStateForResolvedTask({
            task,
            namespace: options.namespace,
            event: options.event
        })
    }

    private writeGoalTodoStateForResolvedTask(options: {
        task: StoredTask
        namespace: string
        event?: GoalTodoEventOptions
    }): boolean {
        if (!options.task.goalId || !options.task.goalTodoRef) {
            return false
        }

        const project = this.store.projects.getProjectByNamespace(options.task.projectId, options.namespace)
        const goal = this.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
        if (!project || !goal || goal.projectId !== project.id) {
            return false
        }

        const defaultWorkspace = project.defaultWorkspaceId
            ? this.store.workspaces.getWorkspace(project.defaultWorkspaceId)
            : this.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
        const blocked = buildGoalTodoBlockedStateFromStoredTask(options.task)

        return upsertGoalTodoTaskState({
            project,
            goal,
            defaultWorkspace,
            taskId: options.task.goalTodoRef,
            status: getGoalTodoStatusForStoredTask(options.task),
            tag: getGoalTodoTagForStoredTask(options.task),
            taskKind: options.task.source === 'planner' || options.task.source === 'radar' ? 'planning' : 'engineering',
            title: options.task.title,
            body: options.task.description,
            blocked,
            event: options.event
        })
    }

    handleEvent(event: SyncEvent): void {
        if (event.type.startsWith('task-') || event.type.startsWith('project-') || event.type.startsWith('workspace-')) {
            return
        }

        if (event.type === 'session-added' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (session) {
                this.lastThinkingBySessionId.set(event.sessionId, Boolean(session.thinking))
                if (!session.active) {
                    this.tryResolveInactiveSession(event.sessionId)
                } else if (!session.thinking) {
                    this.tryReplayIdleSessionCompletion(event.sessionId)
                }
            }
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.lastThinkingBySessionId.delete(event.sessionId)
            this.autoCommitInFlightBySessionId.delete(event.sessionId)
            this.appliedGoalActionPacketBySessionId.delete(event.sessionId)
            return
        }

        if (event.type === 'session-updated' && event.sessionId) {
            this.handleSessionUpdated(event.sessionId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            this.handleMessageReceived(event.sessionId, event.message)
            return
        }
    }

    private handleSessionUpdated(sessionId: string): void {
        const session = this.engine.getSession(sessionId)
        if (!session) return

        const previousThinking = this.lastThinkingBySessionId.get(sessionId)
        const currentThinking = Boolean(session.thinking)
        const hasPendingRequests = Boolean(session.agentState?.requests && Object.keys(session.agentState.requests).length > 0)

        if (!session.active) {
            if (this.tryResolveInactiveSession(sessionId)) {
                this.lastThinkingBySessionId.set(sessionId, currentThinking)
                return
            }
        }

        // When the agent starts thinking again (e.g. after approvals / mode changes),
        // the task should reflect "running" even if the agentState clears in a later tick.
        if (currentThinking) {
            this.tryMoveToInProgressWhenThinking(sessionId)
            this.lastThinkingBySessionId.set(sessionId, currentThinking)
            return
        }

        if (hasPendingRequests) {
            this.tryMoveToInReviewForPermissionRequest(sessionId)
        } else if (!currentThinking && previousThinking !== false) {
            this.tryReplayIdleSessionCompletion(sessionId)
        }

        this.lastThinkingBySessionId.set(sessionId, currentThinking)
    }

    private getLatestReplayableReadyMessage(sessionId: string): DecryptedMessage | null {
        const messages = this.store.messages.getMessages(sessionId, 50)
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index]!
            const candidate: DecryptedMessage = {
                id: message.id,
                seq: message.seq,
                localId: message.localId,
                content: message.content,
                createdAt: message.createdAt
            }
            if (!isReadyEventMessage(candidate)) continue
            const details = getReadyEventDetails(candidate)
            if (details?.hasAssistantReply === false) continue
            return candidate
        }
        return null
    }

    private getIdleReplayGoalActionMarkerSeq(sessionId: string): number | null {
        const messages = this.store.messages.getMessages(sessionId, 50)
        let latestTaskPromptSeq: number | null = null
        let latestGoalActionMarkerSeq: number | null = null
        for (const message of messages) {
            const candidate: DecryptedMessage = {
                id: message.id,
                seq: message.seq,
                localId: message.localId,
                content: message.content,
                createdAt: message.createdAt
            }
            if (isTaskProgressPromptMessage(candidate)) {
                latestTaskPromptSeq = candidate.seq
            }
            if (messageContainsGoalActionMarker(candidate)) {
                latestGoalActionMarkerSeq = candidate.seq
            }
        }

        if (latestGoalActionMarkerSeq === null) {
            return null
        }
        if (latestTaskPromptSeq !== null && latestGoalActionMarkerSeq <= latestTaskPromptSeq) {
            return null
        }
        return latestGoalActionMarkerSeq
    }

    private tryReplayIdleSessionCompletion(sessionId: string): boolean {
        const readyMessage = this.getLatestReplayableReadyMessage(sessionId)
        let goalActionResult: 'applied' | 'already_applied' | 'goal_task' | 'not_goal_task' = 'not_goal_task'
        if (this.getIdleReplayGoalActionMarkerSeq(sessionId) !== null) {
            goalActionResult = this.tryApplyGoalActionPacketFromSession(sessionId)
        } else {
            const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
            const stored = linked ? this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace) : null
            const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked!.namespace, task: stored }) : null
            if (current?.goalId) {
                goalActionResult = 'goal_task'
            }
        }
        if (goalActionResult === 'applied' || goalActionResult === 'already_applied') {
            this.maybeRequestAutoMergeAcceptedTask(sessionId)
            if (readyMessage) {
                this.maybeAutoCommitWorktreeFromReady(sessionId, readyMessage)
            }
            return true
        }

        if (!readyMessage) {
            return false
        }

        if (goalActionResult === 'goal_task') {
            const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
            const stored = linked ? this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace) : null
            const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked!.namespace, task: stored }) : null
            if (current?.source === 'project_init' && isRunningTaskStatus(current.status)) {
                this.tryMoveToInReviewFromReady(sessionId, readyMessage)
                return true
            }
            if (isMergeRuntimeReadyEvent(readyMessage)) {
                this.maybeRequestAutoMergeAcceptedTask(sessionId)
                return true
            }
            if (this.tryRecoverMissingEvaluatorActionPacket(sessionId)) {
                return true
            }
            return false
        }

        this.tryMoveToInReviewFromReady(sessionId, readyMessage)
        if (isMergeRuntimeReadyEvent(readyMessage)) {
            this.maybeRequestAutoMergeAcceptedTask(sessionId)
        }
        this.maybeAutoCommitWorktreeFromReady(sessionId, readyMessage)
        return true
    }

    private handleMessageReceived(sessionId: string, message: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return
        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current || current.archivedAt) return
        let taskForMessage = current
        const recovered = this.tryRecoverInactiveGoalTaskFromLiveMessage(current, linked.namespace, sessionId)
        if (recovered) {
            taskForMessage = recovered
        }

        if (isTaskProgressPromptMessage(message)) {
            if (isStaleDbOnlyManualGoalTask({
                store: this.store,
                namespace: linked.namespace,
                task: taskForMessage
            })) {
                return
            }
            if (taskForMessage.goalId && isReviewTaskStatus(taskForMessage.status) && isTaskKickoffLocalId(message.localId)) return

            const strategy = getWorkflowStrategy(taskForMessage)
            const transitionPatch = strategy.getTaskPatchForTransition('task_prompted', taskForMessage) ?? { status: 'running' }
            const shouldApplyTransition = (transitionPatch.status !== undefined && transitionPatch.status !== taskForMessage.status)
                || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== taskForMessage.workflowPhase)
            const shouldResetMergeState = taskForMessage.worktreeMergedAt !== null
                || taskForMessage.worktreeMergeCommit !== null
                || taskForMessage.finishedAt !== null
                || taskForMessage.mergedDiffSnapshot !== null

            if (shouldApplyTransition || shouldResetMergeState) {
                const event = buildGoalTodoAutomationEvent(
                    'automation_task_prompted',
                    'A follow-up automation prompt moved the todo item back into active execution.',
                    { sessionId, taskId: taskForMessage.id }
                )
                const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                    currentTask: taskForMessage,
                    namespace: linked.namespace,
                    patch: {
                        status: transitionPatch.status ?? 'running',
                        workflowPhase: transitionPatch.workflowPhase,
                        worktreeMergedAt: null,
                        worktreeMergeCommit: null,
                        mergedDiffSnapshot: null,
                        mergeRuntime: null,
                        finishedAt: null,
                        blockedReason: null,
                        blockedSource: null,
                        blockedSessionId: null
                    },
                    event
                })
                const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                    status: transitionPatch.status ?? 'running',
                    workflowPhase: transitionPatch.workflowPhase,
                    worktreeMergedAt: null,
                    worktreeMergeCommit: null,
                    mergedDiffSnapshot: null,
                    mergeRuntime: null,
                    finishedAt: null,
                    blockedReason: null,
                    blockedSource: null,
                    blockedSessionId: null
                })
                if (updated) {
                    const resumedTask = this.resolveRuntimeTask(updated, linked.namespace, taskForMessage)
                    if (!resumedTask) {
                        return
                    }
                    if (!wroteDocsFirst) {
                        this.syncGoalTodo(resumedTask, linked.namespace, taskForMessage, event)
                    } else {
                        notifyProjectControllerTaskBlockedTransition({
                            store: this.store,
                            engine: this.engine,
                            namespace: linked.namespace,
                            previousTask: taskForMessage,
                            task: resumedTask
                        })
                    }
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: resumedTask.id,
                        projectId: resumedTask.projectId,
                        namespace: linked.namespace,
                        data: { taskId: resumedTask.id }
                    })
                }
            }
            return
        }

        if (messageContainsGoalActionMarker(message)) {
            const goalActionResult = this.tryApplyGoalActionPacketFromSession(sessionId)
            if (goalActionResult === 'applied' || goalActionResult === 'already_applied') {
                this.maybeRequestAutoMergeAcceptedTask(sessionId)
                return
            }
        }

        if (getMessageRole(message) === 'assistant' && isReadyEventMessage(message)) {
            const details = getReadyEventDetails(message)
            if (details?.hasAssistantReply === false) {
                return
            }
            const goalActionResult = this.tryApplyGoalActionPacketFromSession(sessionId)
            if (goalActionResult === 'applied' || goalActionResult === 'already_applied') {
                this.maybeRequestAutoMergeAcceptedTask(sessionId)
                this.maybeAutoCommitWorktreeFromReady(sessionId, message)
                return
            }
            if (goalActionResult === 'goal_task') {
                if (isStaleDbOnlyManualGoalTask({
                    store: this.store,
                    namespace: linked.namespace,
                    task: taskForMessage
                })) {
                    return
                }
                if (taskForMessage.source === 'project_init' && isRunningTaskStatus(taskForMessage.status)) {
                    this.tryMoveToInReviewFromReady(sessionId, message)
                    return
                }
                if (isMergeRuntimeReadyEvent(message)) {
                    this.maybeRequestAutoMergeAcceptedTask(sessionId)
                    return
                }
                if (this.tryRecoverMissingEvaluatorActionPacket(sessionId)) {
                    return
                }
                return
            }
            if (isStaleDbOnlyManualGoalTask({
                store: this.store,
                namespace: linked.namespace,
                task: taskForMessage
            })) {
                return
            }
            this.tryMoveToInReviewFromReady(sessionId, message)
            if (isMergeRuntimeReadyEvent(message)) {
                this.maybeRequestAutoMergeAcceptedTask(sessionId)
            }
            this.maybeAutoCommitWorktreeFromReady(sessionId, message)
            return
        }

        if (getMessageRole(message) === 'assistant' && getTaskInterruptionDetails(message)) {
            this.tryBlockTaskFromInterruptionEvent(sessionId, message)
        }
    }

    private tryRecoverInactiveGoalTaskFromLiveMessage(task: StoredTask, namespace: string, sessionId: string): StoredTask | null {
        if (!isRecoverableInactiveLiveMessageBlock(task)) return null
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace,
            task
        })) return null
        if (task.blockedSessionId && task.blockedSessionId !== sessionId) return null

        const event = buildGoalTodoAutomationEvent(
            'automation_task_recovered',
            'A live session message cleared an inactive automation block and resumed execution.',
            { sessionId, taskId: task.id }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: task,
            namespace,
            patch: {
                status: 'running',
                blockedReason: null,
                blockedSource: null,
                blockedSessionId: null,
                finishedAt: null
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
            status: 'running',
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null,
            finishedAt: null
        })
        if (!updated) return null

        const resumedTask = this.resolveRuntimeTask(updated, namespace, task)
        if (!resumedTask) return null

        if (!wroteDocsFirst) {
            this.syncGoalTodo(resumedTask, namespace, task, event)
        } else {
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace,
                previousTask: task,
                task: resumedTask
            })
        }
        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: resumedTask.id,
            projectId: resumedTask.projectId,
            namespace,
            data: { taskId: resumedTask.id }
        })
        return resumedTask
    }

    private tryResolveInactiveSession(sessionId: string): boolean {
        const goalActionResult = this.tryApplyGoalActionPacketFromSession(sessionId)
        if (goalActionResult === 'applied' || goalActionResult === 'already_applied') {
            this.maybeRequestAutoMergeAcceptedTask(sessionId)
            return true
        }
        if (goalActionResult === 'goal_task' && this.tryRecoverMissingEvaluatorActionPacket(sessionId)) {
            return true
        }
        return this.tryBlockTaskFromInactiveSession(sessionId)
    }

    private tryApplyGoalActionPacketFromSession(sessionId: string): 'applied' | 'already_applied' | 'goal_task' | 'not_goal_task' {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return 'not_goal_task'

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current || current.archivedAt || !current.goalId) {
            return 'not_goal_task'
        }
        if (this.appliedGoalActionPacketBySessionId.has(sessionId)) {
            return 'already_applied'
        }
        if (
            !isRunningTaskStatus(current.status)
            && !isReviewTaskStatus(current.status)
            && !isRecoverableGoalActionPacketBlock(current)
        ) {
            return 'goal_task'
        }

        const applied = applyGoalActionPacketFromSession({
            store: this.store,
            engine: this.engine,
            namespace: linked.namespace,
            projectId: linked.projectId,
            taskId: linked.taskId,
            sessionId
        })
        if (applied) {
            this.appliedGoalActionPacketBySessionId.add(sessionId)
        }
        return applied ? 'applied' : 'goal_task'
    }

    private tryRecoverMissingEvaluatorActionPacket(sessionId: string): boolean {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return false

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current || current.archivedAt || !current.goalId) return false
        if (!isReviewTaskStatus(current.status) || current.source !== 'evaluator') return false

        const session = this.engine.getSession(sessionId)
        const metadata = toRecord(session?.metadata)
        if (metadata?.hopiTaskRole !== 'evaluator') return false

        const blockedReason = 'Evaluator finished without a HOPI_ACTIONS packet.'
        if (isTaskAlreadyMerged(current)) {
            const finishedAt = current.finishedAt
                ?? current.worktreeMergedAt
                ?? current.mergeRuntime?.completedAt
                ?? Date.now()
            const event = buildGoalTodoAutomationEvent(
                'automation_task_completed',
                'Evaluator output was missing, but the task was already merged and was finalized as done.',
                { sessionId, taskId: current.id }
            )
            const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                currentTask: current,
                namespace: linked.namespace,
                patch: {
                    status: 'done',
                    source: 'manual',
                    blockedReason: null,
                    blockedSource: null,
                    blockedSessionId: null,
                    finishedAt
                },
                event
            })
            const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                status: 'done',
                source: 'manual',
                blockedReason: null,
                blockedSource: null,
                blockedSessionId: null,
                finishedAt,
                initRuntime: buildTaskInitRuntime({
                    current: current.initRuntime,
                    activeSessionId: current.activeSessionId,
                    status: 'succeeded',
                    sessionId,
                    completedAt: finishedAt,
                    latestNote: `${blockedReason} Ignored because the task already merged successfully.`
                })
            })
            if (!updated) return false

            const finishedTask = this.resolveRuntimeTask(updated, linked.namespace, current)
            if (!finishedTask) return false

            if (!wroteDocsFirst) {
                this.syncGoalTodo(finishedTask, linked.namespace, current, event)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: linked.namespace,
                    previousTask: current,
                    task: finishedTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: finishedTask.id,
                projectId: finishedTask.projectId,
                namespace: linked.namespace,
                data: { taskId: finishedTask.id }
            })
            return true
        }

        const currentRetryCount = current.initRuntime?.retryCount ?? 0
        const shouldBlock = currentRetryCount >= EVALUATOR_MISSING_ACTION_RETRY_MAX_ATTEMPTS
        const blockedStatus = recoverStoredTaskStatusFromLegacyBlocked(current)
        const mergeResultResetPatch = buildMergeResultResetPatch(current)
        const event = buildGoalTodoAutomationEvent(
            shouldBlock ? 'automation_task_blocked' : 'automation_review_requeued',
            shouldBlock
                ? 'Evaluator finished without a HOPI_ACTIONS packet and the task was blocked.'
                : 'Evaluator finished without a HOPI_ACTIONS packet and review was requeued.',
            { sessionId, taskId: current.id }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: shouldBlock ? blockedStatus : 'review',
                source: 'manual',
                blockedReason: shouldBlock ? blockedReason : null,
                blockedSource: shouldBlock ? 'evaluator' : null,
                blockedSessionId: shouldBlock ? sessionId : null,
                ...mergeResultResetPatch
            },
            event
        })

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: shouldBlock ? blockedStatus : 'review',
            source: 'manual',
            blockedReason: shouldBlock ? blockedReason : null,
            blockedSource: shouldBlock ? 'evaluator' : null,
            blockedSessionId: shouldBlock ? sessionId : null,
            ...(mergeResultResetPatch ?? {}),
            initRuntime: buildTaskInitRuntime({
                current: current.initRuntime,
                activeSessionId: current.activeSessionId,
                status: shouldBlock ? 'blocked' : 'retrying',
                sessionId,
                retryCount: shouldBlock ? currentRetryCount : currentRetryCount + 1,
                latestNote: shouldBlock
                    ? `${blockedReason} Review automation is blocked until the task is retried.`
                    : `${blockedReason} Requeued evaluator review (${currentRetryCount + 1}/${EVALUATOR_MISSING_ACTION_RETRY_MAX_ATTEMPTS}).`,
                blockedReason: shouldBlock ? blockedReason : null
            })
        })
        if (!updated) return false

        const reviewTask = this.resolveRuntimeTask(updated, linked.namespace, current)
        if (!reviewTask) return false

        if (!wroteDocsFirst) {
            this.syncGoalTodo(reviewTask, linked.namespace, current, event)
        } else {
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace: linked.namespace,
                previousTask: current,
                task: reviewTask
            })
        }
        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: reviewTask.id,
            projectId: reviewTask.projectId,
            namespace: linked.namespace,
            data: { taskId: reviewTask.id }
        })
        if (shouldBlock) {
            appendTaskBlockedMessage({
                store: this.store,
                engine: this.engine,
                sessionId,
                taskId: reviewTask.id,
                reason: blockedReason,
                localId: `${AUTO_TASK_BLOCKED_LOCAL_ID_PREFIX}${reviewTask.id}:${sessionId}:missing-evaluator-action`
            })
        }

        return true
    }

    private maybeRequestAutoMergeAcceptedTask(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        requestAutoMergeAcceptedTask({
            store: this.store,
            engine: this.engine,
            namespace: linked.namespace,
            taskId: linked.taskId,
            preferredSessionId: sessionId
        })
    }

    private maybeAutoCommitWorktreeFromReady(sessionId: string, readyMessage: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const task = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!task) return
        if (task.archivedAt) return
        if (isDoneTaskStatus(task.status)) return

        const project = this.store.projects.getProjectByNamespace(linked.projectId, linked.namespace)
        if (!project) return
        if (project.worktreeAutoCommitMode !== 'per_conversation') return

        const session = this.engine.getSession(sessionId)
        if (!session?.metadata?.worktree) return

        if (this.autoCommitInFlightBySessionId.has(sessionId)) {
            return
        }

        const shouldCommit = (() => {
            const details = getReadyEventDetails(readyMessage)
            if (!details?.forLocalKey) return false

            const storedPrompt = this.store.messages.getMessageByLocalId(sessionId, details.forLocalKey)
            if (!storedPrompt) return false

            const prompt: DecryptedMessage = {
                id: storedPrompt.id,
                seq: storedPrompt.seq,
                localId: storedPrompt.localId,
                content: storedPrompt.content,
                createdAt: storedPrompt.createdAt
            }
            return isAutomationPromptMessage(prompt)
        })()

        if (!shouldCommit) return

        const taskIdPrefix = task.id.slice(0, 8)
        const title = task.title.trim() || 'Task'
        const commitMessage = `HOPI: task ${taskIdPrefix} — ${title}`.slice(0, 180)

        this.autoCommitInFlightBySessionId.add(sessionId)
        void this.engine.gitAutocommitWorktree(sessionId, { message: commitMessage })
            .then((result) => {
                if (!result.success) {
                    this.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: linked.namespace,
                        data: {
                            title: 'Worktree auto-commit failed',
                            body: result.error ?? 'Unknown error',
                            sessionId,
                            url: ''
                        }
                    })
                }
            })
            .catch((error) => {
                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: linked.namespace,
                    data: {
                        title: 'Worktree auto-commit failed',
                        body: error instanceof Error ? error.message : String(error),
                        sessionId,
                        url: ''
                    }
                })
            })
            .finally(() => {
                this.autoCommitInFlightBySessionId.delete(sessionId)
            })
    }

    private tryMoveToInReviewFromReady(sessionId: string, readyMessage: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return
        if (current.archivedAt) return
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (isStaleDbOnlyBootstrapGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (!isRunningTaskStatus(current.status)) return

        if (current.source === 'project_init') {
            void this.tryMoveProjectInitTaskToReviewFromReady(sessionId, readyMessage, linked)
            return
        }

        const details = getReadyEventDetails(readyMessage)
        if (details?.forLocalKey) {
            const storedPrompt = this.store.messages.getMessageByLocalId(sessionId, details.forLocalKey)
            if (storedPrompt) {
                const prompt: DecryptedMessage = {
                    id: storedPrompt.id,
                    seq: storedPrompt.seq,
                    localId: storedPrompt.localId,
                    content: storedPrompt.content,
                    createdAt: storedPrompt.createdAt
                }

                // Internal automation turns should not affect human-facing task progress.
                if (!isTaskProgressPromptMessage(prompt)) {
                    return
                }
            }
        }

        const strategy = getWorkflowStrategy(current)
        const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', current) ?? { status: 'review' }
        const mergeResultResetPatch = buildMergeResultResetPatch(current)
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
            || mergeResultResetPatch !== null
        if (!shouldApply) return

        const event = buildGoalTodoAutomationEvent(
            'automation_task_ready',
            'The agent reported ready and the todo item advanced to review.',
            { sessionId, taskId: current.id }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: transitionPatch.status ?? 'review',
                workflowPhase: transitionPatch.workflowPhase,
                ...mergeResultResetPatch
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'review',
            workflowPhase: transitionPatch.workflowPhase,
            ...(mergeResultResetPatch ?? {})
        })
        if (updated) {
            const readyTask = this.resolveRuntimeTask(updated, linked.namespace, current)
            if (!readyTask) {
                return
            }
            if (!wroteDocsFirst) {
                this.syncGoalTodo(readyTask, linked.namespace, current, event)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: linked.namespace,
                    previousTask: current,
                    task: readyTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: readyTask.id,
                projectId: readyTask.projectId,
                namespace: linked.namespace,
                data: { taskId: readyTask.id }
            })
        }
    }

    private async tryMoveProjectInitTaskToReviewFromReady(
        sessionId: string,
        readyMessage: DecryptedMessage,
        linked: LinkedTask
    ): Promise<void> {
        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return
        if (current.archivedAt) return
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (isStaleDbOnlyBootstrapGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (!isRunningTaskStatus(current.status)) return
        if (current.source !== 'project_init') return

        const session = this.engine.getSession(sessionId)
        if (!session) return

        const workspace = current.workspaceId
            ? this.store.workspaces.getWorkspace(current.workspaceId)
            : null

        const contractLoad = await loadProjectActionContractFromSession({
            engine: this.engine,
            sessionId,
            rootPaths: resolveSessionRootPathCandidates({
                session,
                workspacePath: workspace?.path ?? null
            })
        })

        const refreshedStored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const refreshed = refreshedStored ? getTaskRuntimeViewOrFallback({
            store: this.store,
            namespace: linked.namespace,
            previousTask: current,
            updatedTask: refreshedStored
        }) : null
        if (!refreshed) return
        if (refreshed.archivedAt) return
        if (isStaleDbOnlyBootstrapGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: refreshed
        })) return
        if (!isRunningTaskStatus(refreshed.status)) return
        if (refreshed.source !== 'project_init') return

        if (contractLoad.kind !== 'valid') {
            const blockedReason = contractLoad.kind === 'missing'
                ? `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`
                : `Invalid ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}: ${contractLoad.error}`
            const currentRetryCount = refreshed.initRuntime?.retryCount ?? 0
            const nextRetryCount = currentRetryCount + 1

            if (contractLoad.kind === 'invalid' && nextRetryCount <= BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS) {
                const latestNote = `Bootstrap contract still invalid after ready; asked the agent to continue repairing it (${nextRetryCount}/${BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS}).`
                const retryEvent = buildGoalTodoAutomationEvent(
                    'automation_bootstrap_contract_retry',
                    'Bootstrap contract validation failed and the task was kept running for another repair attempt.',
                    { sessionId, taskId: refreshed.id, attempt: nextRetryCount }
                )
                const wroteRetryDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                    currentTask: refreshed,
                    namespace: linked.namespace,
                    patch: {
                        status: 'running'
                    },
                    event: retryEvent
                })
                const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                    status: 'running',
                    initRuntime: buildTaskInitRuntime({
                        current: refreshed.initRuntime,
                        activeSessionId: refreshed.activeSessionId,
                        status: 'retrying',
                        sessionId,
                        retryCount: nextRetryCount,
                        latestNote
                    })
                })
                if (!updated) {
                    return
                }
                const retryTask = this.resolveRuntimeTask(updated, linked.namespace, refreshed)
                if (!retryTask) {
                    return
                }

                if (!wroteRetryDocsFirst) {
                    this.syncGoalTodo(retryTask, linked.namespace, refreshed, retryEvent)
                } else {
                    notifyProjectControllerTaskBlockedTransition({
                        store: this.store,
                        engine: this.engine,
                        namespace: linked.namespace,
                        previousTask: refreshed,
                        task: retryTask
                    })
                }
                this.engine.handleRealtimeEvent({
                    type: 'task-updated',
                    taskId: retryTask.id,
                    projectId: retryTask.projectId,
                    namespace: linked.namespace,
                    data: { taskId: retryTask.id }
                })

                try {
                    await this.engine.sendMessage(sessionId, {
                        text: buildBootstrapContractRepairPrompt(contractLoad.error, nextRetryCount),
                        localId: `${AUTO_BOOTSTRAP_REPAIR_LOCAL_ID_PREFIX}${retryTask.id}:${Date.now()}`,
                        sentFrom: 'webapp'
                    })
                    return
                } catch (error) {
                    const sendError = error instanceof Error ? error.message : String(error)
                    const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(retryTask)
                    const blockedEvent = buildGoalTodoAutomationEvent(
                        'automation_task_blocked',
                        'Bootstrap contract repair prompt could not be sent, so the todo item was blocked.',
                        { sessionId, taskId: retryTask.id, attempt: nextRetryCount }
                    )
                    const wroteBlockedDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                        currentTask: retryTask,
                        namespace: linked.namespace,
                        patch: {
                            status: nextBlockedStatus,
                            blockedReason: sendError,
                            blockedSource: retryTask.blockedSource ?? 'bootstrap_contract',
                            blockedSessionId: sessionId
                        },
                        event: blockedEvent
                    })
                    const blocked = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                        status: nextBlockedStatus,
                        blockedReason: sendError,
                        blockedSource: retryTask.blockedSource ?? 'bootstrap_contract',
                        blockedSessionId: sessionId,
                        initRuntime: buildTaskInitRuntime({
                            current: retryTask.initRuntime,
                            activeSessionId: retryTask.activeSessionId,
                            status: 'blocked',
                            sessionId,
                            retryCount: nextRetryCount,
                            latestNote: `Bootstrap contract repair prompt could not be sent: ${sendError}`,
                            blockedReason: sendError
                        })
                    })
                    const blockedTask = this.resolveRuntimeTask(blocked, linked.namespace, retryTask)
                    if (!blockedTask) {
                        return
                    }
                    if (!wroteBlockedDocsFirst) {
                        this.syncGoalTodo(blockedTask, linked.namespace, retryTask, blockedEvent)
                    } else {
                        notifyProjectControllerTaskBlockedTransition({
                            store: this.store,
                            engine: this.engine,
                            namespace: linked.namespace,
                            previousTask: retryTask,
                            task: blockedTask
                        })
                    }
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: blockedTask.id,
                        projectId: blockedTask.projectId,
                        namespace: linked.namespace,
                        data: { taskId: blockedTask.id }
                    })
                    this.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: linked.namespace,
                        data: {
                            title: 'Bootstrap repair failed',
                            body: `${blockedTask.title}: ${sendError}`,
                            sessionId,
                            url: ''
                        }
                    })
                    return
                }
            }

            const latestNote = contractLoad.kind === 'missing'
                ? `Bootstrap task reached ready, but \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` is still missing. Finish the contract before retrying the bootstrap task.`
                : `Bootstrap task reached ready, but \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` is still invalid after ${currentRetryCount} repair attempt(s): ${contractLoad.error}. Finish the contract before retrying the bootstrap task.`

            const blockedEvent = buildGoalTodoAutomationEvent(
                'automation_task_blocked',
                'Bootstrap contract validation failed after retries and the todo item was blocked.',
                { sessionId, taskId: refreshed.id, blockedReason }
            )
            const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(refreshed)
            const wroteBlockedDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                currentTask: refreshed,
                namespace: linked.namespace,
                patch: {
                    status: nextBlockedStatus,
                    blockedReason,
                    blockedSource: refreshed.blockedSource ?? 'bootstrap_contract',
                    blockedSessionId: sessionId
                },
                event: blockedEvent
            })
            const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                status: nextBlockedStatus,
                blockedReason,
                blockedSource: refreshed.blockedSource ?? 'bootstrap_contract',
                blockedSessionId: sessionId,
                initRuntime: refreshed.initRuntime?.sessionId === sessionId
                    ? buildTaskInitRuntime({
                        current: refreshed.initRuntime,
                        activeSessionId: refreshed.activeSessionId,
                        status: 'blocked',
                        sessionId,
                        retryCount: currentRetryCount,
                        latestNote,
                        blockedReason
                    })
                    : undefined
            })
            const blockedTask = updated ? getTaskRuntimeViewOrFallback({
                store: this.store,
                namespace: linked.namespace,
                previousTask: refreshed,
                updatedTask: updated
            }) : null
            if (!blockedTask) {
                return
            }

            if (!wroteBlockedDocsFirst) {
                this.syncGoalTodo(blockedTask, linked.namespace, refreshed, blockedEvent)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: linked.namespace,
                    previousTask: refreshed,
                    task: blockedTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: blockedTask.id,
                projectId: blockedTask.projectId,
                namespace: linked.namespace,
                data: { taskId: blockedTask.id }
            })
            this.engine.handleRealtimeEvent({
                type: 'toast',
                namespace: linked.namespace,
                data: {
                    title: 'Bootstrap contract is not ready',
                    body: `${blockedTask.title}: ${blockedReason}`,
                    sessionId,
                    url: ''
                }
            })
            return
        }

        await this.runBootstrapPreviewProbe({
            linked,
            sessionId,
            session,
            task: refreshed
        })
    }

    private async runBootstrapPreviewProbe(options: {
        linked: LinkedTask
        sessionId: string
        session: NonNullable<ReturnType<SyncEngine['getSession']>>
        task: ReturnType<Store['tasks']['getTaskByNamespace']> extends infer T ? T extends null ? never : T : never
    }): Promise<void> {
        const previewTaskKey = buildBootstrapPreviewTaskKey(options.linked)
        if (this.bootstrapPreviewInFlightByTaskKey.has(previewTaskKey)) {
            return
        }

        this.bootstrapPreviewInFlightByTaskKey.add(previewTaskKey)
        try {
            const workspace = options.task.workspaceId
                ? this.store.workspaces.getWorkspace(options.task.workspaceId)
                : null
            const rootPath = resolveSessionPreferredRootPath(options.session) ?? workspace?.path ?? null
            const mode: 'local' | 'worktree' = resolveSessionWorktreePath(options.session) ? 'worktree' : 'local'

            const failBootstrapPreview = async (failure: {
                error: string
                preview: RpcPreviewStatus
            }): Promise<void> => {
                const latestStored = this.store.tasks.getTaskByNamespace(options.linked.taskId, options.linked.namespace)
                const latestTask = latestStored
                    ? getTaskRuntimeViewOrFallback({
                        store: this.store,
                        namespace: options.linked.namespace,
                        previousTask: options.task,
                        updatedTask: latestStored
                    })
                    : null
                if (!latestTask || latestTask.archivedAt || !isRunningTaskStatus(latestTask.status) || latestTask.source !== 'project_init') {
                    return
                }

                const currentRetryCount = latestTask.previewRuntime?.retryCount ?? 0
                const nextRetryCount = currentRetryCount + 1

                try {
                    await this.engine.previewStopForSession(options.sessionId, { taskId: options.linked.taskId })
                } catch {
                }

                if (nextRetryCount <= BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS) {
                    const retryEvent = buildGoalTodoAutomationEvent(
                        'automation_bootstrap_preview_retry',
                        'Bootstrap preview probing failed and the task was kept running for another repair attempt.',
                        { sessionId: options.sessionId, taskId: latestTask.id, attempt: nextRetryCount }
                    )
                    const wroteRetryDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                        currentTask: latestTask,
                        namespace: options.linked.namespace,
                        patch: {
                            status: 'running'
                        },
                        event: retryEvent
                    })
                    const updated = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                        status: 'running',
                        initRuntime: buildTaskInitRuntime({
                            current: latestTask.initRuntime,
                            activeSessionId: latestTask.activeSessionId,
                            status: 'retrying',
                            sessionId: options.sessionId,
                            retryCount: nextRetryCount,
                            latestNote: `Bootstrap preview probe failed; asked the agent to keep repairing it (${nextRetryCount}/${BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS}).`
                        }),
                        previewRuntime: buildTaskPreviewRuntime({
                            current: latestTask.previewRuntime,
                            activeSessionId: latestTask.activeSessionId,
                            status: 'retrying',
                            sessionId: options.sessionId,
                            retryCount: nextRetryCount,
                            latestNote: `Bootstrap preview probe failed: ${failure.error}. HOPI asked the agent to continue repairing the repo.`,
                            blockedReason: null
                        })
                    })
                    if (!updated) {
                        return
                    }
                    const retryTask = updated ? getTaskRuntimeViewOrFallback({
                        store: this.store,
                        namespace: options.linked.namespace,
                        previousTask: latestTask,
                        updatedTask: updated
                    }) : null
                    if (!retryTask) {
                        return
                    }

                    if (!wroteRetryDocsFirst) {
                        this.syncGoalTodo(retryTask, options.linked.namespace, latestTask, retryEvent)
                    } else {
                        notifyProjectControllerTaskBlockedTransition({
                            store: this.store,
                            engine: this.engine,
                            namespace: options.linked.namespace,
                            previousTask: latestTask,
                            task: retryTask
                        })
                    }
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: retryTask.id,
                        projectId: retryTask.projectId,
                        namespace: options.linked.namespace,
                        data: { taskId: retryTask.id }
                    })

                    try {
                        await this.engine.sendMessage(options.sessionId, {
                            text: buildBootstrapPreviewRepairPrompt({
                                error: failure.error,
                                attempt: nextRetryCount,
                                rootPath: rootPath ?? '(unknown)',
                                mode,
                                preview: failure.preview
                            }),
                            localId: `${AUTO_BOOTSTRAP_PREVIEW_REPAIR_LOCAL_ID_PREFIX}${retryTask.id}:${Date.now()}`,
                            sentFrom: 'webapp'
                        })
                    } catch (error) {
                        const sendError = error instanceof Error ? error.message : String(error)
                        const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(retryTask)
                        const blockedEvent = buildGoalTodoAutomationEvent(
                            'automation_task_blocked',
                            'Bootstrap preview repair prompt could not be sent, so the todo item was blocked.',
                            { sessionId: options.sessionId, taskId: retryTask.id, attempt: nextRetryCount }
                        )
                        const wroteBlockedDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                            currentTask: retryTask,
                            namespace: options.linked.namespace,
                            patch: {
                                status: nextBlockedStatus,
                                blockedReason: sendError,
                                blockedSource: retryTask.blockedSource ?? 'bootstrap_preview',
                                blockedSessionId: options.sessionId
                            },
                            event: blockedEvent
                        })
                        const blocked = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                            status: nextBlockedStatus,
                            blockedReason: sendError,
                            blockedSource: retryTask.blockedSource ?? 'bootstrap_preview',
                            blockedSessionId: options.sessionId,
                            initRuntime: buildTaskInitRuntime({
                                current: retryTask.initRuntime,
                                activeSessionId: retryTask.activeSessionId,
                                status: 'blocked',
                                sessionId: options.sessionId,
                                retryCount: nextRetryCount,
                                latestNote: `Bootstrap preview repair prompt could not be sent: ${sendError}`,
                                blockedReason: sendError
                            }),
                            previewRuntime: buildTaskPreviewRuntime({
                                current: retryTask.previewRuntime,
                                activeSessionId: retryTask.activeSessionId,
                                status: 'blocked',
                                sessionId: options.sessionId,
                                retryCount: nextRetryCount,
                                latestNote: `Bootstrap preview repair prompt could not be sent: ${sendError}`,
                                blockedReason: sendError
                            })
                        })
                        const blockedTask = blocked ? getTaskRuntimeViewOrFallback({
                            store: this.store,
                            namespace: options.linked.namespace,
                            previousTask: retryTask,
                            updatedTask: blocked
                        }) : null
                        if (!blockedTask) {
                            return
                        }
                        if (!wroteBlockedDocsFirst) {
                            this.syncGoalTodo(blockedTask, options.linked.namespace, retryTask, blockedEvent)
                        } else {
                            notifyProjectControllerTaskBlockedTransition({
                                store: this.store,
                                engine: this.engine,
                                namespace: options.linked.namespace,
                                previousTask: retryTask,
                                task: blockedTask
                            })
                        }
                        this.engine.handleRealtimeEvent({
                            type: 'task-updated',
                            taskId: blockedTask.id,
                            projectId: blockedTask.projectId,
                            namespace: options.linked.namespace,
                            data: { taskId: blockedTask.id }
                        })
                    }
                    return
                }

                const blockedEvent = buildGoalTodoAutomationEvent(
                    'automation_task_blocked',
                    'Bootstrap preview probing failed after retries and the todo item was blocked.',
                    { sessionId: options.sessionId, taskId: latestTask.id, blockedReason: failure.error }
                )
                const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(latestTask)
                const wroteBlockedDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                    currentTask: latestTask,
                    namespace: options.linked.namespace,
                    patch: {
                        status: nextBlockedStatus,
                        blockedReason: failure.error,
                        blockedSource: latestTask.blockedSource ?? 'bootstrap_preview',
                        blockedSessionId: options.sessionId
                    },
                    event: blockedEvent
                })
                const blocked = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                    status: nextBlockedStatus,
                    blockedReason: failure.error,
                    blockedSource: latestTask.blockedSource ?? 'bootstrap_preview',
                    blockedSessionId: options.sessionId,
                    initRuntime: buildTaskInitRuntime({
                        current: latestTask.initRuntime,
                        activeSessionId: latestTask.activeSessionId,
                        status: 'blocked',
                        sessionId: options.sessionId,
                        retryCount: currentRetryCount,
                        latestNote: `Bootstrap preview probe failed after ${currentRetryCount} repair attempt(s): ${failure.error}. Fix the repo and retry bootstrap.`,
                        blockedReason: failure.error
                    }),
                    previewRuntime: buildTaskPreviewRuntime({
                        current: latestTask.previewRuntime,
                        activeSessionId: latestTask.activeSessionId,
                        status: 'blocked',
                        sessionId: options.sessionId,
                        retryCount: currentRetryCount,
                        latestNote: `Bootstrap preview probe failed after ${currentRetryCount} repair attempt(s): ${failure.error}.`,
                        blockedReason: failure.error
                    })
                })
                if (!blocked) {
                    return
                }
                const blockedTask = getTaskRuntimeViewOrFallback({
                    store: this.store,
                    namespace: options.linked.namespace,
                    previousTask: latestTask,
                    updatedTask: blocked
                })
                if (!blockedTask) {
                    return
                }

                if (!wroteBlockedDocsFirst) {
                    this.syncGoalTodo(blockedTask, options.linked.namespace, latestTask, blockedEvent)
                } else {
                    notifyProjectControllerTaskBlockedTransition({
                        store: this.store,
                        engine: this.engine,
                        namespace: options.linked.namespace,
                        previousTask: latestTask,
                        task: blockedTask
                    })
                }
                this.engine.handleRealtimeEvent({
                    type: 'task-updated',
                    taskId: blockedTask.id,
                    projectId: blockedTask.projectId,
                    namespace: options.linked.namespace,
                    data: { taskId: blockedTask.id }
                })
                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: options.linked.namespace,
                    data: {
                        title: 'Bootstrap preview failed',
                        body: `${blockedTask.title}: ${failure.error}`,
                        sessionId: options.sessionId,
                        url: ''
                    }
                })
            }

            if (!rootPath) {
                await failBootstrapPreview({
                    error: 'Bootstrap preview root path could not be resolved',
                    preview: {
                        active: false,
                        status: 'error',
                        updatedAt: Date.now(),
                        error: 'Bootstrap preview root path could not be resolved',
                        logTail: []
                    }
                })
                return
            }

            const startedEvent = buildGoalTodoAutomationEvent(
                'automation_bootstrap_preview_started',
                'Bootstrap contract validation succeeded and preview readiness probing started.',
                { sessionId: options.sessionId, taskId: options.task.id }
            )
            const wroteStartedDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                currentTask: options.task,
                namespace: options.linked.namespace,
                patch: {
                    status: 'running'
                },
                event: startedEvent
            })
            const runningTask = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                status: 'running',
                initRuntime: buildTaskInitRuntime({
                    current: options.task.initRuntime,
                    activeSessionId: options.task.activeSessionId,
                    status: 'waiting',
                    sessionId: options.sessionId,
                    latestNote: 'Bootstrap contract is valid. HOPI is probing preview readiness now.'
                }),
                previewRuntime: buildTaskPreviewRuntime({
                    current: options.task.previewRuntime,
                    activeSessionId: options.task.activeSessionId,
                    status: 'running',
                    sessionId: options.sessionId,
                    latestNote: 'Bootstrap preview probe is starting.'
                })
            })
            if (!runningTask) {
                return
            }

            const runtimeTask = this.resolveRuntimeTask(runningTask, options.linked.namespace, options.task)
            if (!runtimeTask) {
                return
            }

            if (!wroteStartedDocsFirst) {
                this.syncGoalTodo(runtimeTask, options.linked.namespace, options.task, startedEvent)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: options.linked.namespace,
                    previousTask: options.task,
                    task: runtimeTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: runtimeTask.id,
                projectId: runtimeTask.projectId,
                namespace: options.linked.namespace,
                data: { taskId: runtimeTask.id }
            })

            let preview: RpcPreviewStatus
            try {
                preview = await this.engine.previewStartForSession(options.sessionId, {
                    taskId: options.linked.taskId,
                    rootPath,
                    mode
                })
            } catch (error) {
                await failBootstrapPreview({
                    error: error instanceof Error ? error.message : String(error),
                    preview: {
                        active: false,
                        status: 'error',
                        updatedAt: Date.now(),
                        error: error instanceof Error ? error.message : String(error),
                        logTail: []
                    }
                })
                return
            }

            const startedAt = Date.now()
            while (preview.status === 'starting' && Date.now() - startedAt < BOOTSTRAP_PREVIEW_TIMEOUT_MS) {
                await sleep(BOOTSTRAP_PREVIEW_POLL_INTERVAL_MS)
                try {
                    preview = await this.engine.previewStatusForSession(options.sessionId)
                } catch (error) {
                    await failBootstrapPreview({
                        error: error instanceof Error ? error.message : String(error),
                        preview: {
                            active: false,
                            status: 'error',
                            updatedAt: Date.now(),
                            error: error instanceof Error ? error.message : String(error),
                            logTail: []
                        }
                    })
                    return
                }
            }

            if (preview.status === 'starting') {
                preview = {
                    ...preview,
                    status: 'error',
                    updatedAt: Date.now(),
                    error: `Preview did not become ready within ${Math.round(BOOTSTRAP_PREVIEW_TIMEOUT_MS / 1000)} seconds`
                }
            }

            if (preview.status !== 'ready') {
                await failBootstrapPreview({
                    error: buildBootstrapPreviewFailureReason(preview),
                    preview
                })
                return
            }

            const latestStored = this.store.tasks.getTaskByNamespace(options.linked.taskId, options.linked.namespace)
            const latestTask = latestStored
                ? getTaskRuntimeViewOrFallback({
                    store: this.store,
                    namespace: options.linked.namespace,
                    previousTask: options.task,
                    updatedTask: latestStored
                })
                : null
            if (!latestTask || latestTask.archivedAt || !isRunningTaskStatus(latestTask.status) || latestTask.source !== 'project_init') {
                return
            }

            const strategy = getWorkflowStrategy(latestTask)
            const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', latestTask) ?? { status: 'review' }
            const mergeResultResetPatch = buildMergeResultResetPatch(latestTask)
            const readyEvent = buildGoalTodoAutomationEvent(
                'automation_bootstrap_preview_ready',
                'Bootstrap preview became ready and the todo item advanced to review.',
                { sessionId: options.sessionId, taskId: latestTask.id, previewUrl: preview.url ?? null }
            )
            const wroteReadyDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                currentTask: latestTask,
                namespace: options.linked.namespace,
                patch: {
                    status: transitionPatch.status ?? 'review',
                    workflowPhase: transitionPatch.workflowPhase,
                    ...mergeResultResetPatch
                },
                event: readyEvent
            })
            const updated = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                status: transitionPatch.status ?? 'review',
                workflowPhase: transitionPatch.workflowPhase,
                ...(mergeResultResetPatch ?? {}),
                initRuntime: buildTaskInitRuntime({
                    current: latestTask.initRuntime,
                    activeSessionId: latestTask.activeSessionId,
                    status: 'succeeded',
                    sessionId: options.sessionId,
                    latestNote: preview.url
                        ? `Bootstrap verified by preview readiness at ${preview.url}.`
                        : 'Bootstrap verified by preview readiness.'
                }),
                previewRuntime: buildTaskPreviewRuntime({
                    current: latestTask.previewRuntime,
                    activeSessionId: latestTask.activeSessionId,
                    status: 'ready',
                    sessionId: options.sessionId,
                    retryCount: latestTask.previewRuntime?.retryCount,
                    failureFingerprint: null,
                    latestNote: preview.url
                        ? `Bootstrap preview is ready at ${preview.url}.`
                        : 'Bootstrap preview is ready.',
                    blockedReason: null
                })
            })
            if (!updated) {
                return
            }

            const readyTask = updated ? getTaskRuntimeViewOrFallback({
                store: this.store,
                namespace: options.linked.namespace,
                previousTask: latestTask,
                updatedTask: updated
            }) : null
            if (!readyTask) {
                return
            }

            if (!wroteReadyDocsFirst) {
                this.syncGoalTodo(readyTask, options.linked.namespace, latestTask, readyEvent)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: options.linked.namespace,
                    previousTask: latestTask,
                    task: readyTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: readyTask.id,
                projectId: readyTask.projectId,
                namespace: options.linked.namespace,
                data: { taskId: readyTask.id }
            })
        } finally {
            this.bootstrapPreviewInFlightByTaskKey.delete(previewTaskKey)
        }
    }

    private tryMoveToInReviewForPermissionRequest(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return
        if (current.archivedAt) return
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (!isRunningTaskStatus(current.status)) return

        const strategy = getWorkflowStrategy(current)
        const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', current) ?? { status: 'review' }
        const mergeResultResetPatch = buildMergeResultResetPatch(current)
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
            || mergeResultResetPatch !== null
        if (!shouldApply) return

        const event = buildGoalTodoAutomationEvent(
            'automation_task_ready',
            'Pending permission/approval moved the todo item into review.',
            { sessionId, taskId: current.id }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: transitionPatch.status ?? 'review',
                workflowPhase: transitionPatch.workflowPhase,
                ...mergeResultResetPatch
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'review',
            workflowPhase: transitionPatch.workflowPhase,
            ...(mergeResultResetPatch ?? {})
        })
        if (updated) {
            const reviewTask = this.resolveRuntimeTask(updated, linked.namespace, current)
            if (!reviewTask) {
                return
            }
            if (!wroteDocsFirst) {
                this.syncGoalTodo(reviewTask, linked.namespace, current, event)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: linked.namespace,
                    previousTask: current,
                    task: reviewTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: reviewTask.id,
                projectId: reviewTask.projectId,
                namespace: linked.namespace,
                data: { taskId: reviewTask.id }
            })
        }
    }

    private tryMoveToInProgressWhenThinking(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return
        if (current.archivedAt) return
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return
        if (!isReviewTaskStatus(current.status)) return

        const strategy = getWorkflowStrategy(current)
        const transitionPatch = strategy.getTaskPatchForTransition('thinking_resumed', current) ?? { status: 'running' }
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
        if (!shouldApply) return

        const event = buildGoalTodoAutomationEvent(
            'automation_task_resumed',
            'Agent resumed thinking and the todo item moved back into active execution.',
            { sessionId, taskId: current.id }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: transitionPatch.status ?? 'running',
                workflowPhase: transitionPatch.workflowPhase
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'running',
            workflowPhase: transitionPatch.workflowPhase
        })
        if (updated) {
            const resumedTask = this.resolveRuntimeTask(updated, linked.namespace, current)
            if (!resumedTask) {
                return
            }
            if (!wroteDocsFirst) {
                this.syncGoalTodo(resumedTask, linked.namespace, current, event)
            } else {
                notifyProjectControllerTaskBlockedTransition({
                    store: this.store,
                    engine: this.engine,
                    namespace: linked.namespace,
                    previousTask: current,
                    task: resumedTask
                })
            }
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: resumedTask.id,
                projectId: resumedTask.projectId,
                namespace: linked.namespace,
                data: { taskId: resumedTask.id }
            })
        }
    }

    private tryBlockTaskFromInterruptionEvent(sessionId: string, errorMessage: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return
        if (current.archivedAt) return
        if (isDoneTaskStatus(current.status)) return
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return

        const details = getTaskInterruptionDetails(errorMessage)
        if (!details) return

        const reportedBlockedReason = details.message ?? 'Agent session reported an error'
        const blockedReason = chooseBlockedReason(current.blockedReason, reportedBlockedReason)
        const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(current)
        const alreadyBlocked = isSameAutomationBlock(current, {
            status: nextBlockedStatus,
            blockedReason,
            blockedSource: 'agent',
            blockedSessionId: sessionId
        })
        const shouldAppendBlockedMessage = !alreadyBlocked
        const isBootstrapTask = current.source === 'project_init'
        const shouldBlockInitRuntime = current.initRuntime?.sessionId === sessionId
            && (current.initRuntime.status === 'running'
                || current.initRuntime.status === 'waiting'
                || current.initRuntime.status === 'retrying'
                || (isBootstrapTask && current.initRuntime.status === 'succeeded'))

        const initRuntime = shouldBlockInitRuntime
            ? buildTaskInitRuntime({
                current: current.initRuntime,
                activeSessionId: current.activeSessionId,
                status: 'blocked',
                sessionId,
                latestNote: isBootstrapTask
                    ? `Starter scaffold was written, but the agent session exited unexpectedly before it could continue filling \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`. Retry the bootstrap task to continue.`
                    : `Agent session exited unexpectedly before task kickoff could continue. Retry the task to continue.`,
                blockedReason
            })
            : undefined

        const event = buildGoalTodoAutomationEvent(
            'automation_task_blocked',
            'The agent session reported an interruption and the todo item was blocked.',
            { sessionId, taskId: current.id, blockedReason }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: nextBlockedStatus,
                blockedReason,
                blockedSource: 'agent',
                blockedSessionId: sessionId,
                initRuntime
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: nextBlockedStatus,
            blockedReason,
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            initRuntime
        })
        if (!updated) {
            return
        }

        const blockedTask = this.resolveRuntimeTask(updated, linked.namespace, current)
        if (!blockedTask) {
            return
        }

        if (!wroteDocsFirst) {
            this.syncGoalTodo(blockedTask, linked.namespace, current, event)
        } else {
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace: linked.namespace,
                previousTask: current,
                task: blockedTask
            })
        }
        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: blockedTask.id,
            projectId: blockedTask.projectId,
            namespace: linked.namespace,
            data: { taskId: blockedTask.id }
        })
        this.engine.handleRealtimeEvent({
            type: 'toast',
            namespace: linked.namespace,
            data: {
                title: 'Task blocked',
                body: `${blockedTask.title}: ${blockedReason}`,
                sessionId,
                url: ''
            }
        })
        if (shouldAppendBlockedMessage) {
            appendTaskBlockedMessage({
                store: this.store,
                engine: this.engine,
                sessionId,
                taskId: blockedTask.id,
                reason: blockedReason,
                localId: `${AUTO_TASK_BLOCKED_LOCAL_ID_PREFIX}${blockedTask.id}:${sessionId}:${errorMessage.id}`
            })
        }
    }

    private tryBlockTaskFromInactiveSession(sessionId: string): boolean {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return false

        const stored = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        const current = stored ? getTaskRuntimeView({ store: this.store, namespace: linked.namespace, task: stored }) : null
        if (!current) return false
        if (current.archivedAt) return false
        if (isDoneTaskStatus(current.status)) return false
        if (isStaleDbOnlyManualGoalTask({
            store: this.store,
            namespace: linked.namespace,
            task: current
        })) return false

        const reportedBlockedReason = current.goalId
            ? GOAL_ACTION_PACKET_INACTIVE_BLOCKED_REASON
            : 'Agent session became inactive before updating the task status.'
        const blockedReason = chooseBlockedReason(current.blockedReason, reportedBlockedReason)
        const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(current)
        const alreadyBlocked = isSameAutomationBlock(current, {
            status: nextBlockedStatus,
            blockedReason,
            blockedSource: 'agent',
            blockedSessionId: sessionId
        })
        if (alreadyBlocked) return false
        const shouldAppendBlockedMessage = true
        const isBootstrapTask = current.source === 'project_init'
        const shouldBlockInitRuntime = current.initRuntime?.sessionId === sessionId
            && (current.initRuntime.status === 'running'
                || current.initRuntime.status === 'waiting'
                || current.initRuntime.status === 'retrying'
                || (isBootstrapTask && current.initRuntime.status === 'succeeded'))

        const initRuntime = shouldBlockInitRuntime
            ? buildTaskInitRuntime({
                current: current.initRuntime,
                activeSessionId: current.activeSessionId,
                status: 'blocked',
                sessionId,
                latestNote: isBootstrapTask
                    ? `Starter scaffold was written, but the agent session became inactive before it could continue filling \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\`. Retry the bootstrap task to continue.`
                    : 'Agent session became inactive before task kickoff could continue. Retry the task to continue.',
                blockedReason
            })
            : undefined

        const event = buildGoalTodoAutomationEvent(
            'automation_task_blocked',
            'The agent session became inactive before completion and the todo item was blocked.',
            { sessionId, taskId: current.id, blockedReason }
        )
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            currentTask: current,
            namespace: linked.namespace,
            patch: {
                status: nextBlockedStatus,
                blockedReason,
                blockedSource: 'agent',
                blockedSessionId: sessionId,
                initRuntime
            },
            event
        })
        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: nextBlockedStatus,
            blockedReason,
            blockedSource: 'agent',
            blockedSessionId: sessionId,
            initRuntime
        })
        if (!updated) {
            return false
        }

        const blockedTask = this.resolveRuntimeTask(updated, linked.namespace, current)
        if (!blockedTask) {
            return false
        }

        if (!wroteDocsFirst) {
            this.syncGoalTodo(blockedTask, linked.namespace, current, event)
        } else {
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace: linked.namespace,
                previousTask: current,
                task: blockedTask
            })
        }
        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: blockedTask.id,
            projectId: blockedTask.projectId,
            namespace: linked.namespace,
            data: { taskId: blockedTask.id }
        })
        this.engine.handleRealtimeEvent({
            type: 'toast',
            namespace: linked.namespace,
            data: {
                title: 'Task blocked',
                body: `${blockedTask.title}: ${blockedReason}`,
                sessionId,
                url: ''
            }
        })
        if (shouldAppendBlockedMessage) {
            appendTaskBlockedMessage({
                store: this.store,
                engine: this.engine,
                sessionId,
                taskId: blockedTask.id,
                reason: blockedReason,
                localId: `${AUTO_TASK_BLOCKED_LOCAL_ID_PREFIX}${blockedTask.id}:${sessionId}:inactive`
            })
        }

        return true
    }
}
