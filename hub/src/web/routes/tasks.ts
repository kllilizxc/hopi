import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { MergeWorkflow } from '@hopi/protocol/actions'
import { AgentFlavorSchema, ModelModeSchema, ModelNameSchema, PermissionModeSchema, TaskStatusSchema, TaskWorkflowPhaseSchema, TodoItemSchema } from '@hopi/protocol/schemas'
import {
    PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH,
    PRODUCT_ENV,
    PRODUCT_HEADERS,
    PRODUCT_INIT_SCRIPT_RELATIVE_PATH,
    PRODUCT_NAME,
    PRODUCT_PREVIEW_READY_MARKER,
    PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH
} from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredTask } from '../../store'
import {
    buildApprovalPendingActionRuntimeNote,
    buildQueuedActionRuntimeNote,
    buildRepeatedTaskActionFailureNote,
    getSessionRunnableState,
    sessionHasPendingRequests,
    trimTaskActionOutput,
    waitForSessionToBecomeRunnable,
    waitWithUnrefTimer
} from '../../utils/taskActionFlow'
import { buildTaskMergeRuntime as buildSharedTaskMergeRuntime, buildTaskPreviewRuntime as buildSharedTaskPreviewRuntime, hasMeaningfulTaskActionRuntimeChange } from '../../utils/taskActionRuntime'
import { waitForAssistantCompletion } from '../../sync/improvementsScan'
import {
    buildMergeConflictResolutionPrompt,
    findBlockedMergeConflictPath,
    getMergeRunVerifyChecks,
    loadMergeWorkflowFromSession,
    type MergeVerifyRunCheckResult,
    resolveMergeConflictResolutionMaxAttempts,
    resolveMergeConflictResolutionMode,
    requiresSnapshotMergeVerification,
    runMergeVerifyChecks
} from '../../sync/mergeWorkflowRunner'
import {
    resolveSessionLocalPath,
    resolveSessionPreferredRootPath,
    resolveSessionWorktreePath
} from '../../sync/sessionRootPaths'
import type { RpcGitMergeWorktreeResponse, RpcGitMergeWorktreeStateResponse, SyncEngine } from '../../sync/syncEngine'
import { relinkTaskToSession, resolveBestUsableTaskSession } from '../../sync/sessionTaskLink'
import { startSessionFromTask } from '../../sync/taskSessionService'
import { getDefaultWorkflowPhase, getWorkflowStrategy } from '../../sync/workflowStrategy'
import type { WebAppEnv } from '../middleware/auth'
import { handleTaskMovedToFinished } from './taskFinishAutomation'

const MAX_TASK_ATTACHMENTS_BYTES = 10 * 1024 * 1024
const AUTO_CONVERSATION_MERGE_LOCAL_ID_PREFIX = 'auto:merge_runtime:'
const AUTO_DIRECT_MERGE_RESULT_LOCAL_ID_PREFIX = 'auto:merge_direct_result:'
const AUTO_CONVERSATION_MERGE_TIMEOUT_MS = 1_800_000
const AUTO_CONVERSATION_MERGE_POLL_INTERVAL_MS = 500
const AUTO_PREVIEW_RESULT_LOCAL_ID_PREFIX = 'auto:preview_result:'
const AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX = 'auto:preview_setup:'
const AUTO_PREVIEW_MONITOR_POLL_INTERVAL_MS = 500
const AUTO_PREVIEW_MAX_REPAIR_ATTEMPTS = 2
const AUTO_PREVIEW_MONITOR_TIMEOUT_MS = 1_800_000
const AUTO_PREVIEW_START_OBSERVE_TIMEOUT_MS = 2_000
const AUTO_PREVIEW_SETUP_TIMEOUT_MS = 240_000
const AUTO_PREVIEW_DEFERRED_START_TIMEOUT_MS = 1_800_000
const inFlightConversationMergeMonitorKeys = new Set<string>()
const inFlightPreviewDeferredStartControllers = new Map<string, { canceled: boolean }>()
const inFlightPreviewMonitorControllers = new Map<string, { canceled: boolean }>()

function estimateDataUrlBytes(dataUrl: string): number {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return 0
    const base64 = dataUrl.slice(comma + 1)
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

function parseDiffNumstat(output: string): Array<{
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
}> {
    const lines = output.trim().split('\n').filter(line => line.trim())
    const files: Array<{
        fileName: string
        filePath: string
        fullPath: string
        status: 'modified' | 'added' | 'deleted'
        isStaged: boolean
        linesAdded: number
        linesRemoved: number
    }> = []

    for (const line of lines) {
        const parts = line.split(/\t/)
        if (parts.length < 3) continue

        const added = parts[0]?.trim() === '-' ? 0 : Number.parseInt(parts[0]?.trim() ?? '0', 10)
        const removed = parts[1]?.trim() === '-' ? 0 : Number.parseInt(parts[1]?.trim() ?? '0', 10)
        let rawPath = parts.slice(2).join('\t').trim()

        // Handle rename syntax: old => new or {old => new}
        if (rawPath.includes('{') && rawPath.includes('=>') && rawPath.includes('}')) {
            rawPath = rawPath.replace(/\{[^{}]+?\s*=>\s*([^{}]+?)\}/g, (_match, newPart: string) => newPart.trim())
        } else if (rawPath.includes('=>')) {
            const renameParts = rawPath.split(/\s*=>\s*/)
            rawPath = renameParts[renameParts.length - 1]?.trim() ?? rawPath
        }

        if (!rawPath) continue

        const pathParts = rawPath.split('/')
        const fileName = pathParts[pathParts.length - 1] ?? rawPath
        const filePath = pathParts.slice(0, -1).join('/')

        const status: 'modified' | 'added' | 'deleted' =
            parts[0]?.trim() === '-' ? 'deleted' :
            parts[1]?.trim() === '-' ? 'added' :
            'modified'

        files.push({
            fileName,
            filePath,
            fullPath: rawPath,
            status,
            isStaged: true,
            linesAdded: added,
            linesRemoved: removed
        })
    }

    return files
}

function buildWorktreeMergeCommitMessage(task: Pick<StoredTask, 'id' | 'title'>): string {
    return `HOPI: task ${task.id.slice(0, 8)} — ${task.title}`.slice(0, 180)
}

function emitTaskUpdatedEvent(options: {
    engine: SyncEngine
    namespace: string
    taskId: string
    projectId: string
    data?: Record<string, unknown>
}): void {
    const handler = options.engine.handleRealtimeEvent

    if (typeof handler !== 'function') {
        return
    }

    handler.call(options.engine, {
        type: 'task-updated',
        taskId: options.taskId,
        projectId: options.projectId,
        namespace: options.namespace,
        data: {
            taskId: options.taskId,
            ...(options.data ?? {})
        }
    })
}

function emitSessionMessageReceivedEvent(options: {
    engine: SyncEngine
    sessionId: string
    message: {
        id: string
        seq: number
        localId: string | null
        content: unknown
        createdAt: number
    }
}): void {
    const handler = options.engine.handleRealtimeEvent

    if (typeof handler !== 'function') {
        return
    }

    handler.call(options.engine, {
        type: 'message-received',
        sessionId: options.sessionId,
        message: options.message
    })
}

function appendAssistantTextMessage(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    text: string
    localId?: string
}): void {
    const message = options.store.messages.addMessage(options.sessionId, {
        role: 'assistant',
        content: {
            type: 'text',
            text: options.text
        },
        meta: {
            sentFrom: 'webapp'
        }
    }, options.localId)

    emitSessionMessageReceivedEvent({
        engine: options.engine,
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

type MergeKickoffRuntimeStatus = 'queued' | 'approval_pending' | 'running'

type TaskPreviewRuntimeStatus = NonNullable<StoredTask['previewRuntime']>['status']
type TaskPreviewRuntime = NonNullable<StoredTask['previewRuntime']>

type StoredTaskWithPreviewRuntime = StoredTask

function isActiveMergeRuntimeStatus(status: string | null | undefined): boolean {
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
}

function isPendingPreviewRuntimeStatus(status: TaskPreviewRuntimeStatus | null | undefined): boolean {
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
}

function isPreviewRetryAttempt(task: Pick<StoredTask, 'previewRuntime'>): boolean {
    const status = task.previewRuntime?.status
    return status === 'blocked'
        || status === 'canceled'
        || status === 'retrying'
        || ((task.previewRuntime?.retryCount ?? 0) > 0)
}

function buildTaskMergeRuntime(options: {
    task: StoredTask
    status: NonNullable<StoredTask['mergeRuntime']>['status']
    sessionId?: string | null
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
}): NonNullable<StoredTask['mergeRuntime']> {
    return buildSharedTaskMergeRuntime({
        current: options.task.mergeRuntime,
        activeSessionId: options.task.activeSessionId,
        status: options.status,
        sessionId: options.sessionId,
        retryCount: options.retryCount,
        failureFingerprint: options.failureFingerprint,
        latestNote: options.latestNote,
        blockedReason: options.blockedReason,
        startedAt: options.startedAt,
        completedAt: options.completedAt
    })
}

function updateTaskMergeRuntime(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    status: NonNullable<StoredTask['mergeRuntime']>['status']
    sessionId?: string | null
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
}): StoredTask | null {
    const updatedTask = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        mergeRuntime: buildTaskMergeRuntime({
            task: options.task,
            status: options.status,
            sessionId: options.sessionId,
            retryCount: options.retryCount,
            failureFingerprint: options.failureFingerprint,
            latestNote: options.latestNote,
            blockedReason: options.blockedReason,
            startedAt: options.startedAt,
            completedAt: options.completedAt
        })
    })
    if (!updatedTask) {
        return null
    }

    emitTaskUpdatedEvent({
        engine: options.engine,
        namespace: options.namespace,
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        data: {
            activeSessionId: updatedTask.activeSessionId,
            mergeRuntime: updatedTask.mergeRuntime,
            worktreeMergedAt: updatedTask.worktreeMergedAt
        }
    })

    return updatedTask
}

function getTaskPreviewRuntime(task: Pick<StoredTask, 'previewRuntime'>): TaskPreviewRuntime | null {
    return task.previewRuntime ?? null
}

function withTaskPreviewRuntime<T extends StoredTask>(task: T | null, previewRuntime?: TaskPreviewRuntime | null): T | null {
    if (!task || previewRuntime === undefined) {
        return task
    }

    return {
        ...task,
        previewRuntime
    }
}

function normalizePreviewRuntimeText(text: string | null | undefined, maxChars = 280): string | null {
    const normalized = text?.trim().replace(/\s+/g, ' ') ?? ''
    if (!normalized) {
        return null
    }

    if (normalized.length <= maxChars) {
        return normalized
    }

    return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`
}

function buildPreviewRunningNote(): string {
    return 'Starting preview directly from the task action.'
}

function buildPreviewQueuedNote(): string {
    return buildQueuedActionRuntimeNote({
        actionLabel: 'Preview',
        continuation: 'HOPI will auto-run preview start'
    })
}

function buildPreviewApprovalPendingNote(): string {
    return buildApprovalPendingActionRuntimeNote({
        actionLabel: 'Preview',
        continuation: 'HOPI will auto-run preview start'
    })
}

function buildPreviewWaitingNote(): string {
    return 'Preview is booting and waiting to report ready.'
}

function buildPreviewRetryingNote(): string {
    return 'Preview start failed. HOPI is asking the linked session to repair the blocker before retrying.'
}

function buildPreviewReadyNote(preview: { url?: string | null }): string {
    return normalizePreviewRuntimeText(
        preview.url
            ? `Preview is ready at ${preview.url}.`
            : 'Preview is ready.'
    ) ?? 'Preview is ready.'
}

function buildPreviewStoppedNote(): string {
    return 'Preview stopped from the task action.'
}

function buildPreviewCanceledNote(): string {
    return 'Preview canceled before it became ready.'
}

function buildPreviewBlockedNote(error: string, manualStep: string): string {
    return normalizePreviewRuntimeText(`Preview blocked: ${error}. ${manualStep}`) ?? 'Preview blocked.'
}

function parsePreviewUrlPort(url: string | null | undefined): number | undefined {
    if (!url) {
        return undefined
    }

    try {
        const parsed = new URL(url)
        if (!parsed.port) {
            return undefined
        }
        const value = Number.parseInt(parsed.port, 10)
        return Number.isFinite(value) ? value : undefined
    } catch {
        return undefined
    }
}

function normalizeLivePreviewStatus(preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>): Awaited<ReturnType<SyncEngine['previewStatusForSession']>> {
    if (preview.status !== 'starting') {
        return preview
    }

    const readyMarkerPattern = new RegExp(`${PRODUCT_PREVIEW_READY_MARKER}(\\S+)`, 'i')
    const previewUrlPattern = /(https?:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}[^\s]*)/i
    const logTail = Array.isArray(preview.logTail) ? [...preview.logTail].reverse() : []

    for (const line of logTail) {
        const readyUrl = line.match(readyMarkerPattern)?.[1]?.trim()
            ?? line.match(previewUrlPattern)?.[1]?.trim()
        if (!readyUrl) {
            continue
        }

        return {
            ...preview,
            active: true,
            status: 'ready',
            url: readyUrl,
            port: parsePreviewUrlPort(readyUrl) ?? preview.port,
            error: undefined
        }
    }

    return preview
}

function hasMeaningfulPreviewRuntimeChange(current: TaskPreviewRuntime | null, next: TaskPreviewRuntime): boolean {
    return hasMeaningfulTaskActionRuntimeChange(current, next)
}

function buildTaskPreviewRuntime(options: {
    task: StoredTaskWithPreviewRuntime
    status: TaskPreviewRuntimeStatus
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
}): TaskPreviewRuntime {
    return buildSharedTaskPreviewRuntime({
        current: getTaskPreviewRuntime(options.task),
        activeSessionId: options.task.activeSessionId,
        status: options.status,
        sessionId: options.sessionId,
        requestedAt: options.requestedAt,
        retryCount: options.retryCount,
        failureFingerprint: options.failureFingerprint,
        latestNote: options.latestNote,
        blockedReason: options.blockedReason,
        startedAt: options.startedAt,
        completedAt: options.completedAt
    })
}

function updateTaskPreviewRuntime(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTaskWithPreviewRuntime
    status: TaskPreviewRuntimeStatus
    sessionId?: string | null
    requestedAt?: number
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
}): StoredTaskWithPreviewRuntime | null {
    const nextPreviewRuntime = buildTaskPreviewRuntime({
        task: options.task,
        status: options.status,
        sessionId: options.sessionId,
        requestedAt: options.requestedAt,
        retryCount: options.retryCount,
        failureFingerprint: options.failureFingerprint,
        latestNote: options.latestNote,
        blockedReason: options.blockedReason,
        startedAt: options.startedAt,
        completedAt: options.completedAt
    })

    if (!hasMeaningfulPreviewRuntimeChange(getTaskPreviewRuntime(options.task), nextPreviewRuntime)) {
        const latestTask = options.store.tasks.getTaskByNamespace(options.task.id, options.namespace) ?? options.task
        return withTaskPreviewRuntime(latestTask, nextPreviewRuntime)
    }

    const updatedTask = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        previewRuntime: nextPreviewRuntime
    })

    const nextTask = withTaskPreviewRuntime(updatedTask ?? options.task, nextPreviewRuntime)

    if (updatedTask && nextTask) {
        emitTaskUpdatedEvent({
            engine: options.engine,
            namespace: options.namespace,
            taskId: nextTask.id,
            projectId: nextTask.projectId,
            data: {
                activeSessionId: nextTask.activeSessionId,
                previewRuntime: nextTask.previewRuntime
            }
        })
    }

    return nextTask
}

function syncPreviewRuntimeFromLivePreview(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTaskWithPreviewRuntime
    preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>
}): StoredTaskWithPreviewRuntime {
    const preview = normalizeLivePreviewStatus(options.preview)

    if (preview.status === 'ready') {
        return updateTaskPreviewRuntime({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: options.task,
            status: 'ready',
            sessionId: preview.sessionId ?? options.task.activeSessionId ?? null,
            latestNote: buildPreviewReadyNote({ url: preview.url ?? null })
        }) ?? options.task
    }

    if (preview.status === 'starting') {
        return updateTaskPreviewRuntime({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: options.task,
            status: 'waiting',
            sessionId: preview.sessionId ?? options.task.activeSessionId ?? null,
            latestNote: buildPreviewWaitingNote()
        }) ?? options.task
    }

    return options.task
}

type TaskPreviewKickoffSkippedReason = 'queued' | 'waiting' | 'approval_pending' | 'running' | 'retrying'

function buildTaskPreviewResponse(options: {
    task: StoredTaskWithPreviewRuntime
    preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>
    skippedReason?: TaskPreviewKickoffSkippedReason | null
}): {
    preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>
    previewRuntime: TaskPreviewRuntime | null
    skippedReason?: TaskPreviewKickoffSkippedReason | null
} {
    const runtime = options.task.previewRuntime ?? null
    const livePreview = normalizeLivePreviewStatus(options.preview)
    const preview = livePreview.status === 'idle' && isPendingPreviewRuntimeStatus(runtime?.status)
        ? {
            ...livePreview,
            active: true,
            status: 'starting' as const,
            taskId: livePreview.taskId ?? options.task.id,
            sessionId: livePreview.sessionId ?? runtime?.sessionId ?? options.task.activeSessionId ?? undefined,
            updatedAt: Math.max(livePreview.updatedAt, runtime?.updatedAt ?? livePreview.updatedAt)
        }
        : livePreview

    return {
        preview,
        previewRuntime: runtime,
        ...(options.skippedReason !== undefined ? { skippedReason: options.skippedReason } : {})
    }
}

function buildMergeKickoffResponse(options: {
    task: StoredTask
    skippedReason: string | null
}): {
    ok: true
    commitHash: string | null
    skippedReason: string | null
    mergedAt: number | null
    autoResolved: null
} {
    return {
        ok: true,
        commitHash: options.task.worktreeMergeCommit ?? null,
        skippedReason: options.skippedReason,
        mergedAt: options.task.worktreeMergedAt ?? null,
        autoResolved: null
    }
}

function buildMergeHandoffNote(options: {
    autoStarted: boolean
    resumed: boolean
    relinked: boolean
}): string | null {
    if (options.autoStarted) {
        return 'HOPI note: started a fresh worktree session for this merge request.'
    }
    if (options.resumed) {
        return 'HOPI note: resumed the linked worktree session before merging.'
    }
    if (options.relinked) {
        return 'HOPI note: relinked this task to the best usable worktree session before merging.'
    }
    return null
}

function buildMergeStateCheckBlockedNote(error: string): string {
    return `${error}. Inspect the linked session output, clear the repo blocker inside the workspace, then retry merge.`
}

type MergeVerificationSnapshot = {
    mergeBase: string
    snapshotRef: string
    expectedChangeCount: number
}

function buildMergeVerificationCaptureBlockedNote(error: string): string {
    return `Could not capture merge verification snapshot: ${error}. Inspect repo state in the linked session, then retry merge.`
}

function buildMergeVerificationBlockedNote(error?: string | null): string {
    if (error && error.trim().length > 0) {
        return `Merge finished, but repo-truth verification failed: ${error.trim()}. Inspect the linked session output, verify the target branch manually, then retry if needed.`
    }

    return 'Merge finished, but repo-truth verification could not prove the target branch contains the expected worktree changes. Inspect the linked session output, verify the target branch manually, then retry if needed.'
}

function buildMissingMergeWorkflowContractNote(manifestPath: string): string {
    return `Merge workflow contract is missing (${manifestPath}). Create ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH} and retry merge.`
}

function buildInvalidMergeWorkflowContractNote(manifestPath: string, error: string): string {
    return `Merge workflow contract is invalid (${manifestPath}): ${error}. Fix ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH} and retry merge.`
}

function buildPlatformMergeFailureNote(error: string): string {
    return `Platform merge failed: ${error}. Inspect the linked session output or repo state, then retry merge.`
}

function buildMergeVerifyRunBlockedNote(error: string): string {
    return `Merge verify command failed before landing: ${error}. Fix the source branch in the linked worktree, then retry merge.`
}

function buildMergeVerifyRepairAttemptNote(attempt: number): string {
    return `Merge verify checks failed. Repairing the linked worktree before retry (${attempt}).`
}

function buildManualConflictResolutionNote(conflictFiles: string[]): string {
    const suffix = conflictFiles.length > 0
        ? ` Conflicts: ${conflictFiles.join(', ')}.`
        : ''
    return `Platform merge found conflicts that need manual resolution.${suffix} Resolve them in the linked worktree, then retry merge.`
}

function buildBlockedConflictPathNote(conflictFile: string): string {
    return `Platform merge found a conflict in blocked path "${conflictFile}". Manual review required before retrying merge.`
}

function buildConflictResolutionExhaustedNote(attempts: number, conflictFiles: string[]): string {
    const suffix = conflictFiles.length > 0
        ? ` Latest conflicts: ${conflictFiles.join(', ')}.`
        : ''
    return `Platform merge still conflicts after ${attempts} AI repair attempt${attempts === 1 ? '' : 's'}.${suffix} Manual review required.`
}

function buildMergeVerifyRepairExhaustedNote(attempts: number): string {
    return `Merge verify checks still fail after ${attempts} AI repair attempt${attempts === 1 ? '' : 's'}. Manual review required.`
}

function buildPlatformMergeSuccessMessage(options: {
    targetBranch: string
    strategy: MergeWorkflow['strategy']
    targetHead: string | null
    autoResolved: boolean
}): string {
    return [
        options.autoResolved
            ? 'HOPI retried the platform merge after AI repair and verified the result.'
            : 'HOPI completed the platform merge and verified the result.',
        '',
        `Target branch: ${options.targetBranch}`,
        `Strategy: ${options.strategy}`,
        options.targetHead ? `Target head: ${options.targetHead}` : null
    ].filter((line): line is string => Boolean(line)).join('\n')
}

function buildPlatformMergeConflictMessage(options: {
    targetBranch: string
    strategy: MergeWorkflow['strategy']
    conflictFiles: string[]
}): string {
    return [
        'HOPI attempted the platform merge and found conflicts before landing the task.',
        '',
        `Target branch: ${options.targetBranch}`,
        `Strategy: ${options.strategy}`,
        options.conflictFiles.length > 0
            ? `Conflicts: ${options.conflictFiles.join(', ')}`
            : 'Conflicts: inspect the latest merge stderr for exact paths.'
    ].join('\n')
}

function buildMergeVerifyFailureMessage(options: {
    targetBranch: string
    failedCheck: MergeVerifyRunCheckResult | null
}): string {
    return [
        'HOPI attempted merge verification before landing and found a repairable repo issue.',
        '',
        `Target branch: ${options.targetBranch}`,
        options.failedCheck?.command ? `Failed check: ${options.failedCheck.command}` : null,
        options.failedCheck?.summary ? `Summary: ${options.failedCheck.summary}` : null
    ].filter((line): line is string => Boolean(line)).join('\n')
}

function buildMergeVerifyRepairPrompt(options: {
    task: Pick<StoredTask, 'id' | 'title'>
    targetBranch: string
    sourceBranch: string | null
    rootPath: string | null
    worktreeBasePath?: string | null
    repairAttempt: number
    maxAttempts: number
    failedCheck: MergeVerifyRunCheckResult | null
    handoffNote?: string | null
}): string {
    const failedCommand = options.failedCheck?.command?.trim() || null
    const failedSummary = options.failedCheck?.summary?.trim() || 'Merge verify command failed before landing.'
    const stdout = trimMergeCommandOutput(options.failedCheck?.stdout, 4_000)
    const stderr = trimMergeCommandOutput(options.failedCheck?.stderr, 4_000)

    return [
        options.handoffNote ?? null,
        'HOPI already attempted merge verification before landing this task and it failed.',
        '',
        `Task: ${options.task.title}`,
        `Task id: ${options.task.id}`,
        `Source branch: ${options.sourceBranch ?? '(inspect current branch first)'}`,
        `Target branch: ${options.targetBranch}`,
        options.rootPath
            ? `Working directory: ${options.rootPath}`
            : 'Working directory: inspect the linked worktree path before editing files.',
        options.worktreeBasePath ? `Base repo path: ${options.worktreeBasePath}` : null,
        `Repair attempt: ${options.repairAttempt} / ${options.maxAttempts}`,
        failedCommand ? `Failed verify command: \`${failedCommand}\`` : null,
        `Failure summary: ${failedSummary}`,
        stdout ? `Verify stdout:\n\`\`\`\n${stdout}\n\`\`\`` : null,
        stderr ? `Verify stderr:\n\`\`\`\n${stderr}\n\`\`\`` : null,
        '',
        'Repair rules:',
        '- Stay on the task source branch in this worktree.',
        '- Fix the real repo/code/config issue that caused merge verification to fail.',
        '- Keep changes minimal; avoid unrelated refactors.',
        '- Do not create or edit legacy merge scripts.',
        '- If you need human product judgment, stop and explain the exact blocker.',
        '',
        'Required outcome:',
        '- Source branch is updated so HOPI can rerun merge verification and the platform merge.',
        '- Reply with a short summary of what changed or why you are blocked.'
    ].filter((line): line is string => Boolean(line)).join('\n')
}

type PlatformMergeAttemptOutcome =
    | {
        kind: 'success'
        targetHead: string | null
        transcriptText: string
    }
    | {
        kind: 'repair'
        repairKind: 'conflict' | 'verify'
        promptText: string
        transcriptText: string
        failureFingerprint: string
        conflictFiles?: string[]
    }
    | {
        kind: 'blocked'
        note: string
        blockedReason: string
        failureFingerprint: string
    }

async function attemptPlatformMerge(options: {
    engine: SyncEngine
    sessionId: string
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>
    task: Pick<StoredTask, 'id' | 'title' | 'projectId'>
    targetBranch: string
    sourceBranch: string | null
    workflow: MergeWorkflow
    conflictStrategy?: 'manual' | 'agent'
    handoffNote?: string | null
    nextRepairAttempt: number
}): Promise<PlatformMergeAttemptOutcome> {
    const verifyRunChecks = getMergeRunVerifyChecks(options.workflow)
    const rootPath = resolveSessionMergeRootPath(options.session)
    if (verifyRunChecks.length > 0) {
        if (!rootPath) {
            const blockedReason = 'Linked session is missing a merge verify root path'
            return {
                kind: 'blocked',
                note: buildMergeVerifyRunBlockedNote(blockedReason),
                blockedReason,
                failureFingerprint: buildMergeFailureFingerprint({
                    reason: 'verification_failed',
                    blockedReason
                })
            }
        }

        const verifyRunResult = await runMergeVerifyChecks({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath,
            taskId: options.task.id,
            projectId: options.task.projectId,
            targetBranch: options.targetBranch,
            sourceBranch: options.sourceBranch,
            worktreeBasePath: options.session.metadata?.worktree?.basePath,
            worktreePath: options.session.metadata?.worktree?.worktreePath ?? options.session.metadata?.path ?? rootPath,
            checks: verifyRunChecks
        })
        if (!verifyRunResult.ok) {
            return {
                kind: 'repair',
                repairKind: 'verify',
                promptText: buildMergeVerifyRepairPrompt({
                    task: options.task,
                    targetBranch: options.targetBranch,
                    sourceBranch: options.sourceBranch,
                    rootPath,
                    worktreeBasePath: options.session.metadata?.worktree?.basePath,
                    repairAttempt: options.nextRepairAttempt,
                    maxAttempts: resolveMergeConflictResolutionMaxAttempts(options.workflow),
                    failedCheck: verifyRunResult.failedCheck,
                    handoffNote: options.handoffNote
                }),
                transcriptText: buildMergeVerifyFailureMessage({
                    targetBranch: options.targetBranch,
                    failedCheck: verifyRunResult.failedCheck
                }),
                failureFingerprint: buildMergeFailureFingerprint({
                    reason: 'verification_failed',
                    blockedReason: verifyRunResult.error
                })
            }
        }
    }

    const shouldRunSnapshotVerification = requiresSnapshotMergeVerification(options.workflow)
    const snapshotResult = shouldRunSnapshotVerification
        ? await captureMergeVerificationSnapshot({
            engine: options.engine,
            sessionId: options.sessionId,
            targetBranch: options.targetBranch
        })
        : null
    if (snapshotResult && !snapshotResult.ok) {
        const blockedReason = snapshotResult.error
        return {
            kind: 'blocked',
            note: buildMergeVerificationCaptureBlockedNote(blockedReason),
            blockedReason,
            failureFingerprint: buildMergeFailureFingerprint({
                reason: 'snapshot_capture_failed',
                blockedReason
            })
        }
    }

    let mergeResult: RpcGitMergeWorktreeResponse
    try {
        mergeResult = await options.engine.gitMergeWorktree(options.sessionId, {
            targetBranch: options.targetBranch,
            commitMessage: buildWorktreeMergeCommitMessage(options.task),
            strategy: options.workflow.strategy
        })
    } catch (error) {
        const blockedReason = formatErrorMessage(error, 'Platform merge failed unexpectedly')
        return {
            kind: 'blocked',
            note: buildPlatformMergeFailureNote(blockedReason),
            blockedReason,
            failureFingerprint: buildMergeFailureFingerprint({
                reason: 'merge_execution_failed',
                blockedReason
            })
        }
    }

    if (!mergeResult.success) {
        const blockedReason = pickReadableMergeError(mergeResult, 'Platform merge failed')
        const conflictFiles = Array.isArray(mergeResult.conflictFiles)
            ? mergeResult.conflictFiles.map((file) => file.trim()).filter((file) => file.length > 0)
            : []
        const hasConflict = conflictFiles.length > 0 || /conflict/i.test(`${blockedReason}\n${mergeResult.stderr ?? ''}\n${mergeResult.stdout ?? ''}`)
        const blockedConflict = findBlockedMergeConflictPath(conflictFiles, options.workflow.conflictResolution?.blockPaths)
        if (blockedConflict) {
            return {
                kind: 'blocked',
                note: buildBlockedConflictPathNote(blockedConflict),
                blockedReason: blockedReason || `Conflict in blocked path ${blockedConflict}`,
                failureFingerprint: buildMergeFailureFingerprint({
                    reason: 'conflict_blocked',
                    blockedReason: blockedReason || blockedConflict
                })
            }
        }

        if (!hasConflict || resolveMergeConflictResolutionMode(options.workflow, options.conflictStrategy) !== 'ai') {
            return {
                kind: 'blocked',
                note: hasConflict ? buildManualConflictResolutionNote(conflictFiles) : buildPlatformMergeFailureNote(blockedReason),
                blockedReason,
                failureFingerprint: buildMergeFailureFingerprint({
                    reason: hasConflict ? 'merge_conflict' : 'merge_execution_failed',
                    blockedReason
                })
            }
        }

        return {
            kind: 'repair',
            repairKind: 'conflict',
            promptText: buildMergeConflictResolutionPrompt({
                task: options.task,
                targetBranch: options.targetBranch,
                sourceBranch: options.sourceBranch,
                rootPath: resolveSessionMergeRootPath(options.session),
                worktreeBasePath: options.session.metadata?.worktree?.basePath,
                conflictFiles,
                repairAttempt: options.nextRepairAttempt,
                maxAttempts: resolveMergeConflictResolutionMaxAttempts(options.workflow),
                handoffNote: options.handoffNote
            }),
            transcriptText: buildPlatformMergeConflictMessage({
                targetBranch: options.targetBranch,
                strategy: options.workflow.strategy,
                conflictFiles
            }),
            conflictFiles,
            failureFingerprint: buildMergeFailureFingerprint({
                reason: 'merge_conflict',
                blockedReason
            })
        }
    }

    const verificationResult = snapshotResult
        ? await verifyMergeVerificationSnapshot({
            engine: options.engine,
            sessionId: options.sessionId,
            targetBranch: options.targetBranch,
            snapshot: snapshotResult.snapshot
        })
        : { ok: true as const, targetHead: mergeResult.commitHash ?? null }
    if (!verificationResult.ok) {
        return {
            kind: 'blocked',
            note: verificationResult.note,
            blockedReason: verificationResult.blockedReason,
            failureFingerprint: buildMergeFailureFingerprint({
                reason: 'verification_failed',
                blockedReason: verificationResult.blockedReason
            })
        }
    }

    return {
        kind: 'success',
        targetHead: verificationResult.targetHead ?? mergeResult.commitHash ?? null,
        transcriptText: buildPlatformMergeSuccessMessage({
            targetBranch: options.targetBranch,
            strategy: options.workflow.strategy,
            targetHead: verificationResult.targetHead ?? mergeResult.commitHash ?? null,
            autoResolved: options.nextRepairAttempt > 1
        })
    }
}

async function captureMergeVerificationSnapshot(options: {
    engine: SyncEngine
    sessionId: string
    targetBranch: string
}): Promise<
    | { ok: true; snapshot: MergeVerificationSnapshot }
    | { ok: false; error: string }
> {
    let result: Awaited<ReturnType<SyncEngine['gitCaptureWorktreeMergeSnapshot']>>
    try {
        result = await options.engine.gitCaptureWorktreeMergeSnapshot(options.sessionId, {
            targetBranch: options.targetBranch
        })
    } catch (error) {
        return {
            ok: false,
            error: formatErrorMessage(error, 'Failed to capture merge verification snapshot')
        }
    }

    if (!result.success) {
        return {
            ok: false,
            error: pickReadableMergeError(result, 'Failed to capture merge verification snapshot')
        }
    }

    const mergeBase = typeof result.mergeBase === 'string' ? result.mergeBase.trim() : ''
    const snapshotRef = typeof result.snapshotRef === 'string' ? result.snapshotRef.trim() : ''
    const expectedChangeCount = typeof result.expectedChangeCount === 'number' && Number.isFinite(result.expectedChangeCount)
        ? Math.max(0, Math.trunc(result.expectedChangeCount))
        : NaN

    if (!mergeBase || !snapshotRef || !Number.isFinite(expectedChangeCount)) {
        return {
            ok: false,
            error: 'Merge verification snapshot was incomplete'
        }
    }

    return {
        ok: true,
        snapshot: {
            mergeBase,
            snapshotRef,
            expectedChangeCount
        }
    }
}

async function verifyMergeVerificationSnapshot(options: {
    engine: SyncEngine
    sessionId: string
    targetBranch: string
    snapshot: MergeVerificationSnapshot
}): Promise<
    | { ok: true; targetHead: string | null }
    | { ok: false; note: string; blockedReason: string }
> {
    let result: Awaited<ReturnType<SyncEngine['gitVerifyWorktreeMerge']>>
    try {
        result = await options.engine.gitVerifyWorktreeMerge(options.sessionId, {
            targetBranch: options.targetBranch,
            mergeBase: options.snapshot.mergeBase,
            snapshotRef: options.snapshot.snapshotRef
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Merge verification failed unexpectedly')
        return {
            ok: false,
            note: buildMergeVerificationBlockedNote(message),
            blockedReason: message
        }
    }

    if (!result.success) {
        const message = pickReadableMergeError(result, 'Merge verification failed')
        return {
            ok: false,
            note: buildMergeVerificationBlockedNote(message),
            blockedReason: message
        }
    }

    if (result.verified !== true) {
        const message = typeof result.error === 'string' && result.error.trim().length > 0
            ? result.error.trim()
            : 'Target branch does not contain the expected worktree changes'
        return {
            ok: false,
            note: buildMergeVerificationBlockedNote(message),
            blockedReason: message
        }
    }

    const targetHead = typeof result.targetHead === 'string' && result.targetHead.trim().length > 0
        ? result.targetHead.trim()
        : null

    return {
        ok: true,
        targetHead
    }
}

function trimMergeCommandOutput(output: string | undefined, maxChars: number): string | null {
    return trimTaskActionOutput(output, maxChars)
}


const MERGE_STATE_CHECK_MANUAL_STEP = 'Inspect the linked session output, clear the repo blocker inside the workspace, then retry merge.'
const MERGE_REPAIR_MANUAL_STEP = 'Inspect the linked session tool output, resolve the repo blocker in the worktree, then retry merge.'
const MERGE_STILL_PENDING_BLOCKED_REASON = 'Target branch still missing the task changes after the latest agent turn'
const PREVIEW_REPAIR_MANUAL_STEP = 'Inspect the linked session tool output, change the repo state or `.hopi/preview.sh`, then retry preview.'
const PREVIEW_SESSION_MANUAL_STEP = 'Restart or relink the task session inside the workspace, then retry preview.'
const PREVIEW_WAIT_MANUAL_STEP = 'Wait for the linked session to become idle, then retry preview.'
const PREVIEW_SESSION_INACTIVE_BLOCKED_REASON = 'Linked session became inactive before preview could start.'
const PREVIEW_WAIT_TIMEOUT_BLOCKED_REASON = 'Preview stayed queued because the linked session never became idle.'

type MergeFailureFingerprintReason =
    | 'contract_missing'
    | 'contract_invalid'
    | 'merge_execution_failed'
    | 'merge_conflict'
    | 'conflict_blocked'
    | 'snapshot_capture_failed'
    | 'merge_check_failed'
    | 'verification_failed'
    | 'merge_still_pending'

function buildMergeFailureFingerprint(options: {
    reason: MergeFailureFingerprintReason
    blockedReason?: string | null
    mergeState?: Pick<MergeGitState, 'reason' | 'sourceBranch' | 'hasWorkingTreeChanges' | 'committedChangedCount'> | null
}): string {
    const digest = createHash('sha1').update(JSON.stringify({
        reason: options.reason,
        blockedReason: options.blockedReason?.trim() ?? null,
        mergeState: options.mergeState
            ? {
                reason: options.mergeState.reason,
                sourceBranch: options.mergeState.sourceBranch,
                hasWorkingTreeChanges: options.mergeState.hasWorkingTreeChanges,
                committedChangedCount: options.mergeState.committedChangedCount
            }
            : null,
    })).digest('hex').slice(0, 12)

    return `${options.reason}:${digest}`
}

function buildRepeatedMergeFailureNote(options: {
    blockedReason: string
    manualStep: string
}): string {
    return buildRepeatedTaskActionFailureNote(options)
}

function buildMergeBlockedRuntimeState(options: {
    task: Pick<StoredTask, 'mergeRuntime'>
    note: string
    blockedReason: string
    failureFingerprint: string
    manualStep: string
}): {
    latestNote: string
    blockedReason: string
    failureFingerprint: string
} {
    const repeated = options.task.mergeRuntime?.failureFingerprint === options.failureFingerprint

    return {
        latestNote: repeated
            ? buildRepeatedMergeFailureNote({
                blockedReason: options.blockedReason,
                manualStep: options.manualStep
            })
            : options.note,
        blockedReason: options.blockedReason,
        failureFingerprint: options.failureFingerprint
    }
}

function getNextMergeAttemptRetryCount(task: Pick<StoredTask, 'mergeRuntime'>): number | undefined {
    const status = task.mergeRuntime?.status
    if (status === 'blocked' || status === 'canceled') {
        return (task.mergeRuntime?.retryCount ?? 0) + 1
    }

    return task.mergeRuntime?.retryCount
}

function isMergeRetryAttempt(task: Pick<StoredTask, 'mergeRuntime'>): boolean {
    const status = task.mergeRuntime?.status
    return status === 'blocked'
        || status === 'canceled'
        || status === 'retrying'
        || ((task.mergeRuntime?.retryCount ?? 0) > 0)
}

type PreviewFailureFingerprintReason =
    | 'preview_start_failed'
    | 'repair_prompt_failed'
    | 'session_inactive'
    | 'session_busy_timeout'
    | 'preview_path_unavailable'

function buildPreviewFailureFingerprint(options: {
    reason: PreviewFailureFingerprintReason
    blockedReason: string
    previewPath?: { mode: 'local' | 'worktree'; rootPath: string } | null
    preview?: {
        status?: string | null
        command?: string | null
        error?: string | null
        logTail?: string[] | null
    } | null
}): string {
    const digest = createHash('sha1').update(JSON.stringify({
        reason: options.reason,
        blockedReason: normalizePreviewRuntimeText(options.blockedReason, 512),
        previewPath: options.previewPath
            ? {
                mode: options.previewPath.mode,
                rootPath: options.previewPath.rootPath
            }
            : null,
        preview: options.preview
            ? {
                status: options.preview.status ?? null,
                command: options.preview.command ?? null,
                error: options.preview.error ?? null,
                logTail: trimMergeCommandOutput((options.preview.logTail ?? []).slice(-8).join('\n'), 512)
            }
            : null
    })).digest('hex').slice(0, 12)

    return `${options.reason}:${digest}`
}

function buildRepeatedPreviewFailureNote(options: {
    blockedReason: string
    manualStep: string
}): string {
    return normalizePreviewRuntimeText(buildRepeatedTaskActionFailureNote(options))
        ?? `Same blocker repeated with no repo progress: ${options.blockedReason}.`
}

function buildPreviewBlockedRuntimeState(options: {
    task: Pick<StoredTask, 'previewRuntime'>
    note: string
    blockedReason: string
    failureFingerprint: string
    manualStep: string
}): {
    latestNote: string
    blockedReason: string
    failureFingerprint: string
} {
    const blockedReason = normalizePreviewRuntimeText(options.blockedReason) ?? 'Preview start failed'
    const repeated = options.task.previewRuntime?.failureFingerprint === options.failureFingerprint

    return {
        latestNote: repeated
            ? buildRepeatedPreviewFailureNote({
                blockedReason,
                manualStep: options.manualStep
            })
            : normalizePreviewRuntimeText(options.note) ?? 'Preview blocked.',
        blockedReason,
        failureFingerprint: options.failureFingerprint
    }
}

function blockPreviewRuntime(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTaskWithPreviewRuntime
    sessionId: string
    blockedReason: string
    failureFingerprint: string
    note: string
    manualStep: string
    retryCount?: number
}): StoredTaskWithPreviewRuntime {
    const blockedState = buildPreviewBlockedRuntimeState({
        task: options.task,
        note: options.note,
        blockedReason: options.blockedReason,
        failureFingerprint: options.failureFingerprint,
        manualStep: options.manualStep
    })

    return updateTaskPreviewRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: options.task,
        status: 'blocked',
        sessionId: options.sessionId,
        retryCount: options.retryCount,
        failureFingerprint: blockedState.failureFingerprint,
        latestNote: blockedState.latestNote,
        blockedReason: blockedState.blockedReason
    }) ?? options.task
}

function getNextPreviewRepairAttemptRetryCount(task: Pick<StoredTask, 'previewRuntime'>): number {
    return (task.previewRuntime?.retryCount ?? 0) + 1
}

function buildTaskKickoffSummary(task: Pick<StoredTask, 'title' | 'description' | 'subTasks'>): string {
    const title = (task.title ?? '').trim()
    const description = (task.description ?? '').trim()
    const subTasks = Array.isArray(task.subTasks)
        ? task.subTasks as Array<{ content?: unknown; status?: unknown }>
        : []
    const subTaskLines = subTasks
        .map((subTask) => {
            const content = typeof subTask.content === 'string' ? subTask.content.trim() : ''
            if (!content) {
                return null
            }
            const done = subTask.status === 'completed'
            return `- [${done ? 'x' : ' '}] ${content}`
        })
        .filter((line): line is string => Boolean(line))
    const subTasksSection = subTaskLines.length > 0
        ? `\n\nSubtasks:\n${subTaskLines.join('\n')}`
        : ''

    if (title && description) {
        return `Task: ${title}\n\nDescription:\n${description}${subTasksSection}`
    }
    if (description) {
        return `${description}${subTasksSection}`
    }
    if (title) {
        return `Task: ${title}${subTasksSection}`
    }
    if (subTasksSection) {
        return `Task${subTasksSection}`
    }
    return 'Task'
}

function buildPreviewStartResultMessage(options: {
    status: 'success' | 'failure'
    mode: 'local' | 'worktree'
    rootPath: string
    command?: string | null
    url?: string | null
    previewStatus?: string | null
    error?: string | null
    logTail?: string[]
    fallbackNote?: string | null
}): string {
    const trimmedLogs = trimMergeCommandOutput((options.logTail ?? []).slice(-8).join('\n'), 4_000)
    const header = options.status === 'success'
        ? 'HOPI started preview directly from the task action.'
        : 'HOPI attempted preview start directly before any agent repair step.'

    return [
        header,
        '',
        `Mode: ${options.mode}`,
        `Root path: ${options.rootPath}`,
        options.command ? `Command: \`${options.command}\`` : 'Command: (unknown)',
        options.url ? `URL: ${options.url}` : null,
        options.previewStatus ? `Status: ${options.previewStatus}` : null,
        options.error ? `Result: ${options.error}` : null,
        options.fallbackNote ?? null,
        trimmedLogs ? `Log tail:\n\`\`\`\n${trimmedLogs}\n\`\`\`` : null
    ].filter((line): line is string => Boolean(line)).join('\n')
}

function resolveSessionMergeRootPath(session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>): string | null {
    return resolveSessionPreferredRootPath(session)
}

function getReadyEventLocalKey(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record || (record.role !== 'assistant' && record.role !== 'agent')) {
        return null
    }

    const messageContent = record.content
    if (!messageContent || typeof messageContent !== 'object') {
        return null
    }
    if ((messageContent as { type?: unknown }).type !== 'event') {
        return null
    }

    const data = (messageContent as { data?: unknown }).data
    if (!data || typeof data !== 'object') {
        return null
    }
    if ((data as { type?: unknown }).type !== 'ready') {
        return null
    }

    return typeof (data as { forLocalKey?: unknown }).forLocalKey === 'string'
        ? (data as { forLocalKey: string }).forLocalKey
        : null
}

function isAssistantTurnCompletionMessage(content: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record || (record.role !== 'assistant' && record.role !== 'agent')) {
        return false
    }

    const messageContent = record.content
    if (!messageContent || typeof messageContent !== 'object') {
        return true
    }

    return (messageContent as { type?: unknown }).type !== 'event'
}

async function waitForReadyEventForLocalId(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    namespace: string
    localId: string
    afterSeq: number
    timeoutMs: number
}): Promise<'ready' | 'session_inactive' | 'timeout'> {
    const startedAt = Date.now()
    let cursor = options.afterSeq
    let sawAssistantTurnCompletion = false

    while (Date.now() - startedAt < options.timeoutMs) {
        const messages = options.store.messages.getMessagesAfter(options.sessionId, cursor, 200)
        for (const message of messages) {
            cursor = Math.max(cursor, message.seq)
            if (getReadyEventLocalKey(message.content) === options.localId) {
                return 'ready'
            }
            if (isAssistantTurnCompletionMessage(message.content)) {
                sawAssistantTurnCompletion = true
            }
        }

        const session = options.engine.getSessionByNamespace(options.sessionId, options.namespace)
        const hasPendingRequests = sessionHasPendingRequests(session)
        if (sawAssistantTurnCompletion && (!session || !session.active || (!session.thinking && !hasPendingRequests))) {
            return 'ready'
        }
        if (!session || !session.active) {
            return 'session_inactive'
        }

        await waitWithUnrefTimer(AUTO_CONVERSATION_MERGE_POLL_INTERVAL_MS)
    }

    return 'timeout'
}

function resolveTaskSessionStartErrorStatus(error: string): 400 | 404 | 500 | 503 {
    return error === 'Task not found'
        ? 404
        : error === 'Project not found' || error === 'Workspace not found' || error === 'Machine not found'
            ? 404
            : error === 'No workspace selected'
                ? 400
                : error.startsWith('Runner offline')
                    ? 503
                    : 500
}

function buildMergeMonitorKey(namespace: string, taskId: string): string {
    return `${namespace}:${taskId}`
}

function buildPreviewMonitorKey(namespace: string, taskId: string): string {
    return `${namespace}:${taskId}`
}

function cancelPreviewDeferredStart(namespace: string, taskId: string): void {
    const key = buildPreviewMonitorKey(namespace, taskId)
    const existing = inFlightPreviewDeferredStartControllers.get(key)
    if (!existing) {
        return
    }

    existing.canceled = true
    inFlightPreviewDeferredStartControllers.delete(key)
}

function cancelPreviewSelfHealMonitor(namespace: string, taskId: string): void {
    const key = buildPreviewMonitorKey(namespace, taskId)
    const existing = inFlightPreviewMonitorControllers.get(key)
    if (!existing) {
        return
    }

    existing.canceled = true
    inFlightPreviewMonitorControllers.delete(key)
}

type DeferredPlatformMergeMonitorOptions = {
    conflictStrategy?: 'manual' | 'agent'
    handoffNote?: string | null
}

async function waitForSessionToBecomeMergeRunnable(options: {
    engine: SyncEngine
    sessionId: string
    namespace: string
    timeoutMs: number
}): Promise<'ready' | 'session_inactive' | 'timeout'> {
    return waitForSessionToBecomeRunnable({
        ...options,
        pollIntervalMs: AUTO_CONVERSATION_MERGE_POLL_INTERVAL_MS
    })
}

function scheduleConversationMergeMonitor(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    sessionId: string
    promptLocalId?: string | null
    targetBranch: string
    workflow: MergeWorkflow
    repairAttempt?: number
    conflictStrategy?: 'manual' | 'agent'
    handoffNote?: string | null
    deferredPlatformMerge?: DeferredPlatformMergeMonitorOptions
    preferredLocale?: string
}): boolean {
    const key = buildMergeMonitorKey(options.namespace, options.taskId)
    if (inFlightConversationMergeMonitorKeys.has(key)) {
        return false
    }
    inFlightConversationMergeMonitorKeys.add(key)

    void (async () => {
        try {
            let promptLocalId = options.promptLocalId ?? null
            let promptSessionId = options.sessionId
            let repairAttempt = options.repairAttempt ?? 0
            const maxRepairAttempts = resolveMergeConflictResolutionMaxAttempts(options.workflow)

            const applyBlockedRuntime = (task: StoredTask, sessionId: string, outcome: {
                note: string
                blockedReason: string
                failureFingerprint: string
                manualStep?: string
            }) => {
                const blockedState = buildMergeBlockedRuntimeState({
                    task,
                    note: outcome.note,
                    blockedReason: outcome.blockedReason,
                    failureFingerprint: outcome.failureFingerprint,
                    manualStep: outcome.manualStep ?? MERGE_REPAIR_MANUAL_STEP
                })
                updateTaskMergeRuntime({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task,
                    status: 'blocked',
                    sessionId,
                    failureFingerprint: blockedState.failureFingerprint,
                    latestNote: blockedState.latestNote,
                    blockedReason: blockedState.blockedReason
                })
            }

            const persistSuccessfulMerge = async (
                task: StoredTask,
                session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>,
                targetHead: string | null,
                transcriptText: string
            ) => {
                appendAssistantTextMessage({
                    store: options.store,
                    engine: options.engine,
                    sessionId: session.id,
                    localId: `${AUTO_DIRECT_MERGE_RESULT_LOCAL_ID_PREFIX}${task.id}:${Date.now()}`,
                    text: transcriptText
                })

                await persistSuccessfulTaskMerge({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task,
                    sessionId: session.id,
                    sessionMetadataWorktreeBaseCommit: session.metadata?.worktree?.baseCommit,
                    mergeResult: {
                        success: true,
                        commitHash: targetHead ?? undefined
                    },
                    markFinishedOnMerge: task.status === 'in_review',
                    preferredLocale: options.preferredLocale
                })
            }

            const dispatchConflictPrompt = async (
                task: StoredTask,
                session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>,
                attempt: Extract<PlatformMergeAttemptOutcome, { kind: 'repair' }>,
                nextAttempt: number
            ) => {
                appendAssistantTextMessage({
                    store: options.store,
                    engine: options.engine,
                    sessionId: session.id,
                    localId: `${AUTO_DIRECT_MERGE_RESULT_LOCAL_ID_PREFIX}${task.id}:${Date.now()}`,
                    text: attempt.transcriptText
                })

                const nextLocalId = `${AUTO_CONVERSATION_MERGE_LOCAL_ID_PREFIX}${task.id}:${Date.now()}`
                await options.engine.sendMessage(session.id, {
                    text: attempt.promptText,
                    localId: nextLocalId,
                    sentFrom: 'webapp'
                })

                updateTaskMergeRuntime({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task,
                    status: isMergeRetryAttempt(task) ? 'retrying' : 'running',
                    sessionId: session.id,
                    failureFingerprint: attempt.failureFingerprint,
                    latestNote: attempt.repairKind === 'verify'
                        ? buildMergeVerifyRepairAttemptNote(nextAttempt)
                        : 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                    startedAt: task.mergeRuntime?.startedAt ?? Date.now(),
                    completedAt: null
                })

                promptLocalId = nextLocalId
                promptSessionId = session.id
                repairAttempt = nextAttempt
            }

            const handleResolutionAttempt = async (task: StoredTask, session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>) => {
                const sourceBranch = normalizeBranchName(session.metadata?.worktree?.branch)
                const attempt = await attemptPlatformMerge({
                    engine: options.engine,
                    sessionId: session.id,
                    session,
                    task,
                    targetBranch: options.targetBranch,
                    sourceBranch,
                    workflow: options.workflow,
                    conflictStrategy: options.conflictStrategy ?? options.deferredPlatformMerge?.conflictStrategy,
                    handoffNote: options.handoffNote ?? options.deferredPlatformMerge?.handoffNote,
                    nextRepairAttempt: repairAttempt + 1
                })

                if (attempt.kind === 'success') {
                    await persistSuccessfulMerge(task, session, attempt.targetHead, attempt.transcriptText)
                    return 'done' as const
                }

                if (attempt.kind === 'blocked') {
                    applyBlockedRuntime(task, session.id, attempt)
                    return 'done' as const
                }

                if (repairAttempt >= maxRepairAttempts) {
                    applyBlockedRuntime(task, session.id, {
                        note: attempt.repairKind === 'verify'
                            ? buildMergeVerifyRepairExhaustedNote(repairAttempt)
                            : buildConflictResolutionExhaustedNote(repairAttempt, attempt.conflictFiles ?? []),
                        blockedReason: attempt.repairKind === 'verify'
                            ? 'Merge verify checks still fail after the latest agent turn'
                            : MERGE_STILL_PENDING_BLOCKED_REASON,
                        failureFingerprint: buildMergeFailureFingerprint({
                            reason: 'verification_failed',
                            blockedReason: attempt.repairKind === 'verify'
                                ? 'Merge verify checks still fail after the latest agent turn'
                                : MERGE_STILL_PENDING_BLOCKED_REASON
                        }),
                        manualStep: MERGE_REPAIR_MANUAL_STEP
                    })
                    return 'done' as const
                }

                try {
                    await dispatchConflictPrompt(task, session, attempt, repairAttempt + 1)
                } catch (error) {
                    const message = formatErrorMessage(error, 'Failed to send merge conflict resolution request')
                    applyBlockedRuntime(task, session.id, {
                        note: `Platform merge found conflicts, but conflict-resolution handoff failed: ${message}. Retry merge after the linked session is ready.`,
                        blockedReason: message,
                        failureFingerprint: attempt.failureFingerprint
                    })
                    return 'done' as const
                }

                return 'prompted' as const
            }

            if (!promptLocalId && options.deferredPlatformMerge) {
                const runnableResult = await waitForSessionToBecomeMergeRunnable({
                    engine: options.engine,
                    sessionId: options.sessionId,
                    namespace: options.namespace,
                    timeoutMs: AUTO_CONVERSATION_MERGE_TIMEOUT_MS
                })

                const latestTask = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
                if (!latestTask) {
                    return
                }

                const resolved = await resolveBestUsableTaskSession({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task: latestTask,
                    requireWorktree: true,
                    allowResume: true
                })

                if (!resolved.ok) {
                    if (latestTask.mergeRuntime?.status !== 'canceled') {
                        updateTaskMergeRuntime({
                            store: options.store,
                            engine: options.engine,
                            namespace: options.namespace,
                            task: latestTask,
                            status: 'blocked',
                            latestNote: 'Merge runtime lost its linked worktree session.',
                            blockedReason: resolved.reason
                        })
                    }
                    return
                }

                const task = resolved.task
                const session = resolved.session
                if (task.mergeRuntime?.status === 'canceled') {
                    return
                }

                const hasPendingRequests = sessionHasPendingRequests(session)
                if (runnableResult === 'timeout') {
                    const timeoutStatus = hasPendingRequests
                        ? 'approval_pending'
                        : session.thinking
                            ? 'queued'
                            : 'waiting'
                    const timeoutNote = hasPendingRequests
                        ? 'Merge is waiting for an approval request before HOPI can attempt the platform merge.'
                        : session.thinking
                            ? 'Merge is still queued behind the current session turn. HOPI will attempt the platform merge when the session is free.'
                            : 'Waiting to attempt the platform merge in the linked session.'
                    updateTaskMergeRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task,
                        status: timeoutStatus,
                        sessionId: session.id,
                        latestNote: timeoutNote,
                        startedAt: task.mergeRuntime?.startedAt ?? null,
                        completedAt: null
                    })
                    return
                }

                if (runnableResult === 'session_inactive') {
                    updateTaskMergeRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task,
                        status: 'blocked',
                        sessionId: session.id,
                        latestNote: 'Merge stopped because the linked session went inactive before HOPI could attempt the platform merge. Re-open the worktree session and retry merge.',
                        blockedReason: 'session_inactive',
                        failureFingerprint: 'session_inactive'
                    })
                    return
                }

                const mergeState = await computeMergeGitState({
                    engine: options.engine,
                    sessionId: session.id,
                    targetBranch: options.targetBranch,
                    sourceBranch: normalizeBranchName(session.metadata?.worktree?.branch),
                    taskMergedAt: task.worktreeMergedAt ?? null
                })

                if (!mergeState.canMerge) {
                    if (mergeState.reason === 'merge_check_failed') {
                        const blockedReason = mergeState.error ?? 'Merge state check failed before platform merge'
                        applyBlockedRuntime(task, session.id, {
                            note: buildMergeStateCheckBlockedNote(blockedReason),
                            blockedReason,
                            failureFingerprint: buildMergeFailureFingerprint({
                                reason: 'merge_check_failed',
                                blockedReason,
                                mergeState
                            }),
                            manualStep: MERGE_STATE_CHECK_MANUAL_STEP
                        })
                    } else {
                        updateTaskMergeRuntime({
                            store: options.store,
                            engine: options.engine,
                            namespace: options.namespace,
                            task,
                            status: 'succeeded',
                            sessionId: session.id,
                            latestNote: mergeState.reason === 'already_merged'
                                ? 'Target branch already contains this task.'
                                : 'No committed changes are waiting to merge.',
                            completedAt: Date.now()
                        })
                    }
                    return
                }

                const result = await handleResolutionAttempt(task, session)
                if (result === 'done') {
                    return
                }
            }

            while (promptLocalId) {
                const promptMessage = options.store.messages.getMessageByLocalId(promptSessionId, promptLocalId)
                const afterSeq = promptMessage?.seq ?? 0
                const readyResult = await waitForReadyEventForLocalId({
                    store: options.store,
                    engine: options.engine,
                    sessionId: promptSessionId,
                    namespace: options.namespace,
                    localId: promptLocalId,
                    afterSeq,
                    timeoutMs: AUTO_CONVERSATION_MERGE_TIMEOUT_MS
                })

                const latestTask = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
                if (!latestTask) {
                    return
                }

                const resolved = await resolveBestUsableTaskSession({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task: latestTask,
                    requireWorktree: true,
                    allowResume: true
                })

                if (!resolved.ok) {
                    if (latestTask.mergeRuntime?.status !== 'canceled') {
                        updateTaskMergeRuntime({
                            store: options.store,
                            engine: options.engine,
                            namespace: options.namespace,
                            task: latestTask,
                            status: 'blocked',
                            latestNote: 'Merge runtime lost its linked worktree session.',
                            blockedReason: resolved.reason
                        })
                    }
                    return
                }

                const task = resolved.task
                const session = resolved.session
                if (task.mergeRuntime?.status === 'canceled') {
                    return
                }

                const hasPendingRequests = sessionHasPendingRequests(session)
                if (readyResult === 'timeout') {
                    const timeoutStatus = hasPendingRequests
                        ? 'approval_pending'
                        : session.thinking
                            ? (isMergeRetryAttempt(task) ? 'retrying' : 'running')
                            : 'waiting'
                    const timeoutNote = hasPendingRequests
                        ? 'Merge is waiting for an approval request before it can continue.'
                        : session.thinking
                            ? 'Merge is still running in the linked session.'
                            : 'Waiting for the linked session to confirm the merge result.'
                    updateTaskMergeRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task,
                        status: timeoutStatus,
                        sessionId: session.id,
                        latestNote: timeoutNote,
                        startedAt: timeoutStatus === 'running' ? Date.now() : task.mergeRuntime?.startedAt ?? null,
                        completedAt: null
                    })
                    return
                }

                if (readyResult === 'session_inactive') {
                    updateTaskMergeRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task,
                        status: 'blocked',
                        sessionId: session.id,
                        latestNote: 'Merge stopped because the linked session went inactive. Re-open the worktree session, inspect the last tool output, and retry merge from the task conversation.',
                        blockedReason: 'session_inactive',
                        failureFingerprint: 'session_inactive'
                    })
                    return
                }

                const result = await handleResolutionAttempt(task, session)
                if (result === 'done') {
                    return
                }
            }
        } finally {
            inFlightConversationMergeMonitorKeys.delete(key)
        }
    })()

    return true
}

async function persistSuccessfulTaskMerge(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    sessionId: string
    sessionMetadataWorktreeBaseCommit: string | undefined
    mergeResult: RpcGitMergeWorktreeResponse
    markFinishedOnMerge?: boolean
    preferredLocale?: string
}): Promise<StoredTask | null> {
    const mergedAt = Date.now()
    const shouldMarkFinished = options.markFinishedOnMerge ?? options.task.status === 'in_review'
    const statusChangingToFinished = shouldMarkFinished && options.task.status !== 'finished'
    const strategy = getWorkflowStrategy(options.task)
    const finishedTransitionPatch = statusChangingToFinished
        ? strategy.getTaskPatchForTransition('task_finished', options.task)
        : null

    let diffSnapshot: unknown = null
    try {
        const baseCommit = options.sessionMetadataWorktreeBaseCommit
        if (baseCommit) {
            const diffResult = await options.engine.getGitDiffNumstat(options.sessionId, { baseRef: baseCommit })
            if (diffResult.success && diffResult.stdout) {
                const files = parseDiffNumstat(diffResult.stdout)
                diffSnapshot = {
                    files,
                    capturedAt: mergedAt,
                    baseCommit
                }
            }
        }
    } catch (error) {
        console.warn('[Tasks] Failed to capture diff snapshot:', error)
    }

    const updatedTask = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        worktreeMergedAt: mergedAt,
        worktreeMergeCommit: options.mergeResult.commitHash ?? null,
        mergedDiffSnapshot: diffSnapshot,
        mergeRuntime: buildTaskMergeRuntime({
            task: options.task,
            status: 'succeeded',
            sessionId: options.sessionId,
            latestNote: 'Merge completed in the linked session.',
            blockedReason: null,
            startedAt: options.task.mergeRuntime?.startedAt ?? options.task.mergeRuntime?.requestedAt ?? mergedAt,
            completedAt: mergedAt
        }),
        status: statusChangingToFinished ? 'finished' : undefined,
        workflowPhase: finishedTransitionPatch?.workflowPhase,
        finishedAt: statusChangingToFinished ? mergedAt : undefined
    })
    if (!updatedTask) {
        return null
    }

    if (statusChangingToFinished) {
        void handleTaskMovedToFinished({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            taskId: options.task.id,
            preferredLocale: options.preferredLocale
        })
    }

    emitTaskUpdatedEvent({
        engine: options.engine,
        namespace: options.namespace,
        taskId: options.task.id,
        projectId: updatedTask.projectId,
        data: {
            worktreeMergedAt: updatedTask.worktreeMergedAt,
            mergeRuntime: updatedTask.mergeRuntime
        }
    })

    return updatedTask
}

const taskAttachmentSchema = z.object({
    id: z.string().min(1),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().min(0),
    dataUrl: z.string().min(1),
    previewUrl: z.string().optional()
})

const createTaskSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(200_000).optional(),
    status: TaskStatusSchema.optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    workspaceId: z.string().min(1).optional(),
    agentFlavor: AgentFlavorSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    model: ModelNameSchema.optional(),
    modelMode: ModelModeSchema.optional(),
    workflowProfile: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
    workflowPhase: TaskWorkflowPhaseSchema.nullable().optional(),
    sortKey: z.number().optional(),
    attachments: z.array(taskAttachmentSchema).optional(),
    subTasks: z.array(TodoItemSchema).optional()
})

const updateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(200_000).nullable().optional(),
    status: TaskStatusSchema.optional(),
    source: z.literal('manual').optional(),
    priority: z.enum(['high', 'medium', 'low']).nullable().optional(),
    workspaceId: z.string().min(1).nullable().optional(),
    agentFlavor: AgentFlavorSchema.nullable().optional(),
    permissionMode: PermissionModeSchema.nullable().optional(),
    model: ModelNameSchema.nullable().optional(),
    modelMode: ModelModeSchema.nullable().optional(),
    workflowProfile: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i).optional(),
    workflowPhase: TaskWorkflowPhaseSchema.nullable().optional(),
    sortKey: z.number().nullable().optional(),
    activeSessionId: z.string().min(1).nullable().optional(),
    attachments: z.array(taskAttachmentSchema).optional(),
    subTasks: z.array(TodoItemSchema).optional()
})

const listTasksQuerySchema = z.object({
    includeArchived: z.enum(['true', 'false']).optional()
})

const attachSessionSchema = z.object({
    sessionId: z.string().min(1)
})

const startSessionSchema = z.object({
    workspaceId: z.string().min(1).optional(),
    agent: AgentFlavorSchema.optional(),
    model: ModelNameSchema.optional(),
    yolo: z.boolean().optional(),
    permissionMode: PermissionModeSchema.optional(),
    modelMode: ModelModeSchema.optional()
})

const mergeWorktreeSchema = z.object({
    targetBranch: z.string().min(1).optional(),
    conflictStrategy: z.enum(['manual', 'agent']).optional()
})

const previewStartSchema = z.object({
    mode: z.enum(['auto', 'local', 'worktree']).optional(),
    basePort: z.number().int().min(1).max(65535).optional()
})

type TaskPreviewPathResult =
    | { ok: true; mode: 'local' | 'worktree'; rootPath: string }
    | { ok: false; status: 400; error: string }

type TaskWorktreeMergeStateReason =
    | 'mergeable'
    | 'no_changes'
    | 'already_merged'
    | 'task_not_in_review'
    | 'task_has_no_active_session'
    | 'target_branch_not_configured'
    | 'not_connected'
    | 'session_not_found'
    | 'session_access_denied'
    | 'not_worktree_session'
    | 'session_busy'
    | 'merge_check_failed'

type TaskWorktreeMergeState = {
    ok: true
    canMerge: boolean
    reason: TaskWorktreeMergeStateReason
    targetBranch: string | null
    sourceBranch: string | null
    hasWorkingTreeChanges: boolean | null
    committedChangedCount: number | null
    mergedAt: number | null
    mergeCommit: string | null
    error: string | null
}

type MergeGitState = {
    canMerge: boolean
    reason: 'mergeable' | 'no_changes' | 'already_merged' | 'merge_check_failed'
    sourceBranch: string | null
    hasWorkingTreeChanges: boolean | null
    committedChangedCount: number | null
    error: string | null
}

function resolveTaskPreviewPath(
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>,
    requestedMode: 'auto' | 'local' | 'worktree'
): TaskPreviewPathResult {
    const worktreePath = resolveSessionWorktreePath(session) ?? ''
    const localPath = resolveSessionLocalPath(session) ?? ''

    if (requestedMode === 'worktree') {
        if (!worktreePath) {
            return { ok: false, status: 400, error: 'Session has no worktree path for preview mode "worktree"' }
        }
        return { ok: true, mode: 'worktree', rootPath: worktreePath }
    }

    if (requestedMode === 'local') {
        if (!localPath) {
            return { ok: false, status: 400, error: 'Session has no local path available for preview mode "local"' }
        }
        return { ok: true, mode: 'local', rootPath: localPath }
    }

    if (worktreePath) {
        return { ok: true, mode: 'worktree', rootPath: worktreePath }
    }
    if (localPath) {
        return { ok: true, mode: 'local', rootPath: localPath }
    }
    return { ok: false, status: 400, error: 'Session metadata is missing preview root path' }
}

function resolveTaskPreviewFallbackPath(options: {
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>
    primary: Extract<TaskPreviewPathResult, { ok: true }>
}): Extract<TaskPreviewPathResult, { ok: true }> | null {
    if (options.primary.mode !== 'worktree') {
        return null
    }

    const metadata = options.session.metadata
    const metadataPath = typeof metadata?.path === 'string' ? metadata.path.trim() : ''
    const basePath = typeof metadata?.worktree?.basePath === 'string'
        ? metadata.worktree.basePath.trim()
        : ''
    const localPath = basePath || metadataPath

    if (!localPath || localPath === options.primary.rootPath) {
        return null
    }

    return {
        ok: true,
        mode: 'local',
        rootPath: localPath
    }
}

function normalizeBranchName(value: string | undefined | null): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function parseMergeChangedCount(value: unknown): number | null {
    if (typeof value !== 'number') {
        return null
    }
    if (!Number.isFinite(value)) {
        return null
    }
    if (value < 0) {
        return null
    }
    return value
}

function extractMergeStateError(result: RpcGitMergeWorktreeStateResponse): string {
    return pickReadableMergeError(result, 'Merge state check failed')
}

async function computeMergeGitState(options: {
    engine: SyncEngine
    sessionId: string
    targetBranch: string
    sourceBranch: string | null
    taskMergedAt: number | null
}): Promise<MergeGitState> {
    let result: RpcGitMergeWorktreeStateResponse
    try {
        result = await options.engine.gitMergeWorktreeState(options.sessionId, {
            targetBranch: options.targetBranch
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Merge state check failed')
        return {
            canMerge: false,
            reason: 'merge_check_failed',
            sourceBranch: options.sourceBranch,
            hasWorkingTreeChanges: null,
            committedChangedCount: null,
            error: message
        }
    }

    const sourceBranch = normalizeBranchName(result.sourceBranch) ?? options.sourceBranch
    const hasWorkingTreeChanges = typeof result.hasWorkingTreeChanges === 'boolean'
        ? result.hasWorkingTreeChanges
        : null
    const committedChangedCount = parseMergeChangedCount(result.committedChangedCount)

    if (!result.success) {
        return {
            canMerge: false,
            reason: 'merge_check_failed',
            sourceBranch,
            hasWorkingTreeChanges,
            committedChangedCount,
            error: extractMergeStateError(result)
        }
    }

    const mergeable = result.mergeable === true
    if (mergeable) {
        return {
            canMerge: true,
            reason: 'mergeable',
            sourceBranch,
            hasWorkingTreeChanges,
            committedChangedCount,
            error: null
        }
    }

    return {
        canMerge: false,
        reason: options.taskMergedAt ? 'already_merged' : 'no_changes',
        sourceBranch,
        hasWorkingTreeChanges,
        committedChangedCount,
        error: null
    }
}

function resolveRequestLocale(rawLocale: string | undefined): string | undefined {
    const trimmed = rawLocale?.trim()
    if (!trimmed) {
        return undefined
    }

    return trimmed.split(',')[0]?.split(';')[0]?.trim() || undefined
}

function formatErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        const message = error.message.trim()
        if (message.length > 0) {
            return message
        }
    }

    if (typeof error === 'string') {
        const message = error.trim()
        if (message.length > 0) {
            return message
        }
    }

    if (error && typeof error === 'object') {
        const maybeMessage = (error as { message?: unknown }).message
        if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
            return maybeMessage.trim()
        }
        const maybeError = (error as { error?: unknown }).error
        if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
            return maybeError.trim()
        }
    }

    return fallback
}

function pickReadableMergeError(result: {
    error?: string
    stderr?: string
    stdout?: string
}, fallback: string): string {
    const explicit = result.error?.trim()
    if (explicit && !/^command failed: git /i.test(explicit)) {
        return explicit
    }

    const stderr = result.stderr?.trim()
    if (stderr) {
        const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    const stdout = result.stdout?.trim()
    if (stdout) {
        const first = stdout.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    if (explicit) {
        return explicit
    }

    return fallback
}

function resolveMergeExecutionErrorStatus(message: string): 500 | 503 | 504 {
    const lowered = message.toLowerCase()
    if (lowered.includes('timed out') || lowered.includes('timeout')) {
        return 504
    }

    if (
        lowered.includes('rpc handler not registered')
        || lowered.includes('rpc socket disconnected')
        || lowered.includes('runner offline')
        || lowered.includes('not connected')
    ) {
        return 503
    }

    return 500
}

function isPreviewRpcUnavailable(message: string): boolean {
    const lowered = message.toLowerCase()
    return lowered.includes('rpc handler not registered') || lowered.includes('rpc socket disconnected') || lowered.includes('runner offline')
}

function resolvePreviewErrorStatus(message: string): 500 | 503 {
    return isPreviewRpcUnavailable(message) ? 503 : 500
}

function resolvePreviewAutomationErrorStatus(message: string): 500 | 503 | 504 {
    const lowered = message.toLowerCase()
    if (lowered.includes('timed out') || lowered.includes('timeout')) {
        return 504
    }

    if (
        lowered.includes('rpc handler not registered')
        || lowered.includes('rpc socket disconnected')
        || lowered.includes('runner offline')
        || lowered.includes('not connected')
    ) {
        return 503
    }

    return 500
}

function isMissingPreviewCommandError(message: string): boolean {
    const lowered = message.toLowerCase()
    return lowered.includes('no preview command found') || lowered.includes(`create ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}`)
}

function createPreviewSetupPrompt(options: {
    task: {
        id: string
        title: string
    }
    mode: 'local' | 'worktree'
    rootPath: string
    basePort?: number
    failureMessage: string
}): string {
    const preferredPortLine = typeof options.basePort === 'number'
        ? String(options.basePort)
        : 'auto'

    return [
        'HOPI already attempted preview start directly before this prompt.',
        'No runnable preview command was found.',
        '',
        `Task: ${options.task.title} (${options.task.id})`,
        `Preview mode: ${options.mode}`,
        `Project root path: ${options.rootPath}`,
        `Preferred web port base: ${preferredPortLine}`,
        `Last error: ${options.failureMessage}`,
        '',
        `Please create or update \`${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}\` in this project so future preview starts are one-click.`,
        '',
        'Requirements:',
        `1) Script path: \`${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}\` under the project root.`,
        '2) Shebang: `#!/usr/bin/env bash`, safe options: `set -euo pipefail`.',
        `3) Make it executable (\`chmod +x ${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}\`).`,
        `4) Respect ${PRODUCT_NAME} vars when present (\`${PRODUCT_ENV.PREVIEW_ROOT}\`, \`${PRODUCT_ENV.PREVIEW_WEB_PORT_BASE}\`, \`${PRODUCT_ENV.PREVIEW_HUB_PORT_BASE}\`, \`${PRODUCT_ENV.PREVIEW_MODE}\`).`,
        '5) Start the project preview/dev server(s) and keep process running.',
        `6) Emit readiness marker exactly as: \`${PRODUCT_PREVIEW_READY_MARKER}http://127.0.0.1:<port>\` once ready.`,
        '7) Keep changes minimal; avoid unrelated refactors.',
        '',
        'After editing the script, run a quick sanity check and reply with a short summary.'
    ].join('\n')
}

function createPreviewRepairPrompt(options: {
    task: {
        id: string
        title: string
    }
    mode: 'local' | 'worktree'
    rootPath: string
    basePort?: number
    failureMessage: string
    command?: string | null
    logTail?: string[]
}): string {
    const preferredPortLine = typeof options.basePort === 'number'
        ? String(options.basePort)
        : 'auto'
    const recentLogs = trimMergeCommandOutput((options.logTail ?? []).slice(-12).join('\n'), 4_000)

    return [
        'HOPI already attempted preview start directly before this prompt.',
        'The preview process still failed after launch.',
        '',
        `Task: ${options.task.title} (${options.task.id})`,
        `Preview mode: ${options.mode}`,
        `Project root path: ${options.rootPath}`,
        `Preferred web port base: ${preferredPortLine}`,
        options.command ? `Last preview command: \`${options.command}\`` : null,
        `Last error: ${options.failureMessage}`,
        recentLogs ? `Recent preview logs:\n\`\`\`\n${recentLogs}\n\`\`\`` : null,
        '',
        'Fix the real blocker so direct preview start works reliably from this session.',
        `If \`${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}\` exists, repair it when it is the blocker; otherwise fix the app/config/package scripts or ports.`,
        'Keep changes minimal; avoid unrelated refactors.',
        `If using \`${PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH}\`, keep the readiness marker exactly as \`${PRODUCT_PREVIEW_READY_MARKER}http://127.0.0.1:<port>\`.`,
        'Run a quick sanity check after repairs and reply with a short summary.'
    ].filter((line): line is string => Boolean(line)).join('\n')
}

type PreviewStartAttemptResult =
    | { ok: true; preview: Awaited<ReturnType<SyncEngine['previewStartForSession']>> }
    | { ok: false; status: 500 | 503; error: string; rawMessage: string }

async function startPreviewWithFallback(options: {
    engine: SyncEngine
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
    previewPath: Extract<TaskPreviewPathResult, { ok: true }>
    basePort?: number
}): Promise<PreviewStartAttemptResult> {
    try {
        const preview = normalizeLivePreviewStatus(await options.engine.previewStartForSession(options.resolved.session.id, {
            taskId: options.resolved.task.id,
            rootPath: options.previewPath.rootPath,
            mode: options.previewPath.mode,
            basePort: options.basePort
        }))
        return { ok: true, preview }
    } catch (sessionError) {
        const sessionMessage = formatErrorMessage(sessionError, 'Preview start failed')
        if (!isPreviewRpcUnavailable(sessionMessage)) {
            return {
                ok: false,
                status: resolvePreviewErrorStatus(sessionMessage),
                error: sessionMessage,
                rawMessage: sessionMessage
            }
        }

        if (!options.resolved.machineId) {
            return {
                ok: false,
                status: 503,
                error: `${sessionMessage}. Please restart the task session to load preview RPC handlers.`,
                rawMessage: sessionMessage
            }
        }

        try {
            const preview = normalizeLivePreviewStatus(await options.engine.previewStart(options.resolved.machineId, {
                taskId: options.resolved.task.id,
                sessionId: options.resolved.session.id,
                rootPath: options.previewPath.rootPath,
                mode: options.previewPath.mode,
                basePort: options.basePort
            }))
            return { ok: true, preview }
        } catch (machineError) {
            const machineMessage = formatErrorMessage(machineError, 'Preview start failed')
            const combinedMessage = isPreviewRpcUnavailable(machineMessage)
                ? `${machineMessage}. Please restart runner/session on this machine to load preview RPC handlers.`
                : machineMessage
            return {
                ok: false,
                status: resolvePreviewErrorStatus(machineMessage),
                error: combinedMessage,
                rawMessage: machineMessage
            }
        }
    }
}

type PreviewRepairResult =
    | { ok: true }
    | {
        ok: false
        status: 500 | 503 | 504
        error: string
    }

type PreviewStatusLookupResult =
    | { ok: true; preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> }
    | { ok: false; status: 500 | 503; error: string; rawMessage: string }

type ObservedPreviewStartResult =
    | { kind: 'ready' | 'starting'; preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> }
    | { kind: 'failed'; preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> | null; status: 500 | 503; error: string; rawMessage: string }

async function sendPreviewRepairPrompt(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    taskId: string
    prompt: string
    localIdPrefix: string
    failureFallback: string
}): Promise<PreviewRepairResult> {
    const latest = options.store.messages.getMessages(options.sessionId, 1)
    const afterSeq = latest[0]?.seq ?? 0
    const localId = `${options.localIdPrefix}${options.taskId}:${Date.now()}`

    try {
        await options.engine.sendMessage(options.sessionId, {
            text: options.prompt,
            localId,
            sentFrom: 'webapp'
        })
    } catch (error) {
        const message = formatErrorMessage(error, options.failureFallback)
        return {
            ok: false,
            status: resolvePreviewAutomationErrorStatus(message),
            error: message
        }
    }

    let assistantMessage: Awaited<ReturnType<typeof waitForAssistantCompletion>> | null = null
    try {
        assistantMessage = await waitForAssistantCompletion({
            store: options.store,
            engine: options.engine,
            sessionId: options.sessionId,
            namespace: options.namespace,
            afterSeq,
            timeoutMs: AUTO_PREVIEW_SETUP_TIMEOUT_MS,
            requireAssistantText: false
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Agent preview repair failed unexpectedly')
        return {
            ok: false,
            status: resolvePreviewAutomationErrorStatus(message),
            error: message
        }
    }

    if (!assistantMessage) {
        return {
            ok: false,
            status: 504,
            error: 'Agent preview repair timed out or session became inactive'
        }
    }

    return { ok: true }
}

async function tryAutoSetupPreviewScript(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    task: {
        id: string
        title: string
    }
    mode: 'local' | 'worktree'
    rootPath: string
    basePort?: number
    failureMessage: string
}): Promise<PreviewRepairResult> {
    return await sendPreviewRepairPrompt({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: options.sessionId,
        taskId: options.task.id,
        prompt: createPreviewSetupPrompt({
            task: options.task,
            mode: options.mode,
            rootPath: options.rootPath,
            basePort: options.basePort,
            failureMessage: options.failureMessage
        }),
        localIdPrefix: AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX,
        failureFallback: 'Failed to send preview setup prompt'
    })
}

async function tryAutoRepairPreviewFailure(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    task: {
        id: string
        title: string
    }
    mode: 'local' | 'worktree'
    rootPath: string
    basePort?: number
    failureMessage: string
    command?: string | null
    logTail?: string[]
}): Promise<PreviewRepairResult> {
    return await sendPreviewRepairPrompt({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: options.sessionId,
        taskId: options.task.id,
        prompt: createPreviewRepairPrompt({
            task: options.task,
            mode: options.mode,
            rootPath: options.rootPath,
            basePort: options.basePort,
            failureMessage: options.failureMessage,
            command: options.command,
            logTail: options.logTail
        }),
        localIdPrefix: AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX,
        failureFallback: 'Failed to send preview repair prompt'
    })
}

async function getPreviewStatusWithFallback(options: {
    engine: SyncEngine
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
}): Promise<PreviewStatusLookupResult> {
    try {
        const preview = normalizeLivePreviewStatus(await options.engine.previewStatusForSession(options.resolved.session.id))
        return { ok: true, preview }
    } catch (sessionError) {
        const sessionMessage = formatErrorMessage(sessionError, 'Preview status failed')
        if (!isPreviewRpcUnavailable(sessionMessage)) {
            return {
                ok: false,
                status: resolvePreviewErrorStatus(sessionMessage),
                error: sessionMessage,
                rawMessage: sessionMessage
            }
        }

        if (!options.resolved.machineId) {
            return {
                ok: false,
                status: 503,
                error: `${sessionMessage}. Please restart the task session to load preview RPC handlers.`,
                rawMessage: sessionMessage
            }
        }

        try {
            const preview = normalizeLivePreviewStatus(await options.engine.previewStatus(options.resolved.machineId))
            return { ok: true, preview }
        } catch (machineError) {
            const machineMessage = formatErrorMessage(machineError, 'Preview status failed')
            const combinedMessage = isPreviewRpcUnavailable(machineMessage)
                ? `${machineMessage}. Please restart runner/session on this machine to load preview RPC handlers.`
                : machineMessage
            return {
                ok: false,
                status: resolvePreviewErrorStatus(machineMessage),
                error: combinedMessage,
                rawMessage: machineMessage
            }
        }
    }
}

async function stopPreviewWithFallback(options: {
    engine: SyncEngine
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
}): Promise<PreviewStatusLookupResult> {
    try {
        const preview = await options.engine.previewStopForSession(options.resolved.session.id, { taskId: options.resolved.task.id })
        return { ok: true, preview }
    } catch (sessionError) {
        const sessionMessage = formatErrorMessage(sessionError, 'Preview stop failed')
        if (!isPreviewRpcUnavailable(sessionMessage)) {
            return {
                ok: false,
                status: resolvePreviewErrorStatus(sessionMessage),
                error: sessionMessage,
                rawMessage: sessionMessage
            }
        }

        if (!options.resolved.machineId) {
            return {
                ok: false,
                status: 503,
                error: `${sessionMessage}. Please restart the task session to load preview RPC handlers.`,
                rawMessage: sessionMessage
            }
        }

        try {
            const preview = await options.engine.previewStop(options.resolved.machineId, { taskId: options.resolved.task.id })
            return { ok: true, preview }
        } catch (machineError) {
            const machineMessage = formatErrorMessage(machineError, 'Preview stop failed')
            const combinedMessage = isPreviewRpcUnavailable(machineMessage)
                ? `${machineMessage}. Please restart runner/session on this machine to load preview RPC handlers.`
                : machineMessage
            return {
                ok: false,
                status: resolvePreviewErrorStatus(machineMessage),
                error: combinedMessage,
                rawMessage: machineMessage
            }
        }
    }
}

async function observePreviewStart(options: {
    engine: SyncEngine
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
    initialPreview: Awaited<ReturnType<SyncEngine['previewStartForSession']>>
    timeoutMs?: number
}): Promise<ObservedPreviewStartResult> {
    const timeoutMs = options.timeoutMs ?? AUTO_PREVIEW_START_OBSERVE_TIMEOUT_MS
    let preview = options.initialPreview

    const describeFailure = (currentPreview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>): {
        error: string
        rawMessage: string
    } => {
        const rawMessage = currentPreview.error?.trim()
            || (currentPreview.status === 'stopped'
                ? 'Preview stopped before reporting ready'
                : 'Preview failed before reporting ready')
        return {
            error: rawMessage,
            rawMessage
        }
    }

    if (preview.status === 'ready') {
        return { kind: 'ready', preview }
    }
    if (preview.status === 'error' || preview.status === 'stopped') {
        const failure = describeFailure(preview)
        return {
            kind: 'failed',
            preview,
            status: resolvePreviewErrorStatus(failure.rawMessage),
            error: failure.error,
            rawMessage: failure.rawMessage
        }
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        await waitWithUnrefTimer(250)
        const statusResult = await getPreviewStatusWithFallback({
            engine: options.engine,
            resolved: options.resolved
        })
        if (!statusResult.ok) {
            return {
                kind: 'failed',
                preview: null,
                status: statusResult.status,
                error: statusResult.error,
                rawMessage: statusResult.rawMessage
            }
        }

        preview = statusResult.preview
        if (preview.status === 'ready') {
            return { kind: 'ready', preview }
        }
        if (preview.status === 'error' || preview.status === 'stopped') {
            const failure = describeFailure(preview)
            return {
                kind: 'failed',
                preview,
                status: resolvePreviewErrorStatus(failure.rawMessage),
                error: failure.error,
                rawMessage: failure.rawMessage
            }
        }
    }

    return { kind: 'starting', preview }
}

type ObservedPreviewAttemptResult =
    | {
        ok: true
        preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>
        previewPath: Extract<TaskPreviewPathResult, { ok: true }>
        observedKind: 'ready' | 'starting'
    }
    | {
        ok: false
        status: 500 | 503
        error: string
        rawMessage: string
        preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> | null
        previewPath: Extract<TaskPreviewPathResult, { ok: true }>
    }

async function runObservedPreviewAttempt(options: {
    engine: SyncEngine
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
    previewPath: Extract<TaskPreviewPathResult, { ok: true }>
    basePort?: number
}): Promise<ObservedPreviewAttemptResult> {
    const startAttempt = await startPreviewWithFallback({
        engine: options.engine,
        resolved: options.resolved,
        previewPath: options.previewPath,
        basePort: options.basePort
    })
    if (!startAttempt.ok) {
        return {
            ok: false,
            status: startAttempt.status,
            error: startAttempt.error,
            rawMessage: startAttempt.rawMessage,
            preview: null,
            previewPath: options.previewPath
        }
    }

    const observed = await observePreviewStart({
        engine: options.engine,
        resolved: options.resolved,
        initialPreview: startAttempt.preview
    })
    if (observed.kind === 'failed') {
        return {
            ok: false,
            status: observed.status,
            error: observed.error,
            rawMessage: observed.rawMessage,
            preview: observed.preview,
            previewPath: options.previewPath
        }
    }

    return {
        ok: true,
        preview: observed.preview,
        previewPath: options.previewPath,
        observedKind: observed.kind
    }
}

function buildIdlePreviewStatus(options: {
    taskId: string
    sessionId: string
    previewPath?: { mode: 'local' | 'worktree'; rootPath: string } | null
}): Awaited<ReturnType<SyncEngine['previewStatusForSession']>> {
    return {
        active: false,
        status: 'idle',
        taskId: options.taskId,
        sessionId: options.sessionId,
        mode: options.previewPath?.mode,
        rootPath: options.previewPath?.rootPath,
        updatedAt: Date.now(),
        logTail: []
    }
}

type PreviewStartFlowResult = {
    status: number
    body: Record<string, unknown>
    task: StoredTaskWithPreviewRuntime
}

async function runPreviewStartFlow(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    resolved: Extract<ReturnType<typeof resolveTaskPreviewAccess>, { ok: true }>
    task: StoredTaskWithPreviewRuntime
    previewPath: Extract<TaskPreviewPathResult, { ok: true }>
    basePort?: number
    requestedAt?: number
}): Promise<PreviewStartFlowResult> {
    const previousRuntime = options.task.previewRuntime ?? null
    const requestStartedAt = Date.now()
    let previewTask = updateTaskPreviewRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: options.task,
        status: isPreviewRetryAttempt(options.task) ? 'retrying' : 'running',
        sessionId: options.resolved.session.id,
        requestedAt: options.requestedAt,
        startedAt: requestStartedAt,
        completedAt: null,
        retryCount: previousRuntime?.retryCount ?? 0,
        failureFingerprint: previousRuntime?.failureFingerprint ?? null,
        blockedReason: null,
        latestNote: buildPreviewRunningNote()
    }) ?? options.task

    const appendPreviewResult = (text: string): void => {
        appendAssistantTextMessage({
            store: options.store,
            engine: options.engine,
            sessionId: options.resolved.session.id,
            localId: `${AUTO_PREVIEW_RESULT_LOCAL_ID_PREFIX}${options.resolved.task.id}:${Date.now()}:${randomUUID()}`,
            text
        })
    }

    const appendPreviewStateResult = (messageOptions: {
        status: 'success' | 'failure'
        preview?: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> | null
        previewPath: Extract<TaskPreviewPathResult, { ok: true }>
        error?: string | null
        fallbackNote?: string | null
    }): void => {
        appendPreviewResult(buildPreviewStartResultMessage({
            status: messageOptions.status,
            mode: messageOptions.preview?.mode ?? messageOptions.previewPath.mode,
            rootPath: messageOptions.preview?.rootPath ?? messageOptions.previewPath.rootPath,
            command: messageOptions.preview?.command ?? null,
            url: messageOptions.preview?.url ?? null,
            previewStatus: messageOptions.preview?.status ?? null,
            error: messageOptions.error ?? messageOptions.preview?.error ?? null,
            logTail: messageOptions.preview?.logTail,
            fallbackNote: messageOptions.fallbackNote ?? null
        }))
    }

    let attemptedPreviewPath: Extract<TaskPreviewPathResult, { ok: true }> = options.previewPath
    let attemptResult = await runObservedPreviewAttempt({
        engine: options.engine,
        resolved: options.resolved,
        previewPath: options.previewPath,
        basePort: options.basePort
    })
    let fallbackNote: string | null = null

    if (!attemptResult.ok && isMissingPreviewCommandError(attemptResult.rawMessage)) {
        const fallbackPath = resolveTaskPreviewFallbackPath({
            session: options.resolved.session,
            primary: options.previewPath
        })
        if (fallbackPath) {
            const fallbackAttempt = await runObservedPreviewAttempt({
                engine: options.engine,
                resolved: options.resolved,
                previewPath: fallbackPath,
                basePort: options.basePort
            })
            if (fallbackAttempt.ok) {
                appendPreviewStateResult({
                    status: 'success',
                    preview: fallbackAttempt.preview,
                    previewPath: fallbackPath,
                    fallbackNote: `Fallback succeeded after ${options.previewPath.mode} preview root reported no runnable command.`
                })
                previewTask = syncPreviewRuntimeFromLivePreview({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task: previewTask,
                    preview: fallbackAttempt.preview
                })
                schedulePreviewSelfHealMonitor({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    taskId: options.resolved.task.id,
                    sessionId: options.resolved.session.id,
                    previewPath: fallbackPath,
                    basePort: options.basePort
                })
                return {
                    status: 200,
                    body: buildTaskPreviewResponse({
                        task: previewTask,
                        preview: fallbackAttempt.preview
                    }),
                    task: previewTask
                }
            }

            attemptResult = fallbackAttempt
            attemptedPreviewPath = fallbackPath
            fallbackNote = isMissingPreviewCommandError(fallbackAttempt.rawMessage)
                ? `Fallback from ${options.previewPath.mode} preview root still needs setup.`
                : `Fallback from ${options.previewPath.mode} preview root also failed after launch.`
        }
    }

    if (attemptResult.ok) {
        appendPreviewStateResult({
            status: 'success',
            preview: attemptResult.preview,
            previewPath: attemptResult.previewPath
        })
        previewTask = syncPreviewRuntimeFromLivePreview({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: previewTask,
            preview: attemptResult.preview
        })
        schedulePreviewSelfHealMonitor({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            taskId: options.resolved.task.id,
            sessionId: options.resolved.session.id,
            previewPath: attemptResult.previewPath,
            basePort: options.basePort
        })
        return {
            status: 200,
            body: buildTaskPreviewResponse({
                task: previewTask,
                preview: attemptResult.preview
            }),
            task: previewTask
        }
    }

    appendPreviewStateResult({
        status: 'failure',
        preview: attemptResult.preview,
        previewPath: attemptedPreviewPath,
        error: attemptResult.error,
        fallbackNote
    })

    if (attemptResult.status === 503) {
        const failureFingerprint = buildPreviewFailureFingerprint({
            reason: 'preview_start_failed',
            blockedReason: attemptResult.error,
            previewPath: attemptedPreviewPath,
            preview: attemptResult.preview
                ? {
                    status: attemptResult.preview.status,
                    command: attemptResult.preview.command ?? null,
                    error: attemptResult.preview.error ?? null,
                    logTail: attemptResult.preview.logTail
                }
                : null
        })
        previewTask = blockPreviewRuntime({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: previewTask,
            sessionId: options.resolved.session.id,
            blockedReason: attemptResult.error,
            failureFingerprint,
            note: buildPreviewBlockedNote(attemptResult.error, PREVIEW_SESSION_MANUAL_STEP),
            manualStep: PREVIEW_SESSION_MANUAL_STEP,
            retryCount: previewTask.previewRuntime?.retryCount
        })
        return {
            status: attemptResult.status,
            body: {
                error: attemptResult.error,
                previewRuntime: previewTask.previewRuntime
            },
            task: previewTask
        }
    }

    const repairFlag = isMissingPreviewCommandError(attemptResult.rawMessage)
        ? 'autoSetupAttempted'
        : 'autoRepairAttempted'
    const directFailureFingerprint = buildPreviewFailureFingerprint({
        reason: 'preview_start_failed',
        blockedReason: attemptResult.rawMessage,
        previewPath: attemptedPreviewPath,
        preview: attemptResult.preview
            ? {
                status: attemptResult.preview.status,
                command: attemptResult.preview.command ?? null,
                error: attemptResult.preview.error ?? null,
                logTail: attemptResult.preview.logTail
            }
            : null
    })
    if (previousRuntime?.failureFingerprint === directFailureFingerprint) {
        previewTask = blockPreviewRuntime({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: {
                ...previewTask,
                previewRuntime: previewTask.previewRuntime
                    ? {
                        ...previewTask.previewRuntime,
                        failureFingerprint: previousRuntime.failureFingerprint
                    }
                    : previousRuntime
            },
            sessionId: options.resolved.session.id,
            blockedReason: attemptResult.error,
            failureFingerprint: directFailureFingerprint,
            note: buildPreviewBlockedNote(attemptResult.error, PREVIEW_REPAIR_MANUAL_STEP),
            manualStep: PREVIEW_REPAIR_MANUAL_STEP,
            retryCount: previousRuntime.retryCount
        })
        return {
            status: attemptResult.status,
            body: {
                error: attemptResult.error,
                previewRuntime: previewTask.previewRuntime
            },
            task: previewTask
        }
    }

    const retryCount = getNextPreviewRepairAttemptRetryCount(previewTask)
    previewTask = updateTaskPreviewRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: previewTask,
        status: 'retrying',
        sessionId: options.resolved.session.id,
        retryCount,
        failureFingerprint: directFailureFingerprint,
        blockedReason: null,
        latestNote: buildPreviewRetryingNote(),
        completedAt: null
    }) ?? previewTask

    const repairAttempt = isMissingPreviewCommandError(attemptResult.rawMessage)
        ? await tryAutoSetupPreviewScript({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            sessionId: options.resolved.session.id,
            task: {
                id: options.resolved.task.id,
                title: options.resolved.task.title
            },
            mode: attemptedPreviewPath.mode,
            rootPath: attemptedPreviewPath.rootPath,
            basePort: options.basePort,
            failureMessage: attemptResult.rawMessage
        })
        : await tryAutoRepairPreviewFailure({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            sessionId: options.resolved.session.id,
            task: {
                id: options.resolved.task.id,
                title: options.resolved.task.title
            },
            mode: attemptedPreviewPath.mode,
            rootPath: attemptedPreviewPath.rootPath,
            basePort: options.basePort,
            failureMessage: attemptResult.rawMessage,
            command: attemptResult.preview?.command ?? null,
            logTail: attemptResult.preview?.logTail
        })
    if (!repairAttempt.ok) {
        appendPreviewStateResult({
            status: 'failure',
            preview: attemptResult.preview,
            previewPath: attemptedPreviewPath,
            error: repairAttempt.error,
            fallbackNote: 'Automatic preview repair prompt did not complete successfully.'
        })
        const manualStep = repairAttempt.status === 503 ? PREVIEW_SESSION_MANUAL_STEP : PREVIEW_REPAIR_MANUAL_STEP
        const failureFingerprint = buildPreviewFailureFingerprint({
            reason: 'repair_prompt_failed',
            blockedReason: repairAttempt.error,
            previewPath: attemptedPreviewPath
        })
        previewTask = blockPreviewRuntime({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: previewTask,
            sessionId: options.resolved.session.id,
            blockedReason: repairAttempt.error,
            failureFingerprint,
            note: buildPreviewBlockedNote(repairAttempt.error, manualStep),
            manualStep,
            retryCount
        })
        const body: Record<string, unknown> = {
            error: repairAttempt.error,
            previewRuntime: previewTask.previewRuntime
        }
        body[repairFlag] = true
        return {
            status: repairAttempt.status,
            body,
            task: previewTask
        }
    }

    const retryAttempt = await runObservedPreviewAttempt({
        engine: options.engine,
        resolved: options.resolved,
        previewPath: attemptedPreviewPath,
        basePort: options.basePort
    })
    if (retryAttempt.ok) {
        appendPreviewStateResult({
            status: 'success',
            preview: retryAttempt.preview,
            previewPath: retryAttempt.previewPath,
            fallbackNote: 'Preview auto-repair completed and direct retry now works.'
        })
        previewTask = syncPreviewRuntimeFromLivePreview({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: previewTask,
            preview: retryAttempt.preview
        })
        schedulePreviewSelfHealMonitor({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            taskId: options.resolved.task.id,
            sessionId: options.resolved.session.id,
            previewPath: retryAttempt.previewPath,
            basePort: options.basePort
        })
        const body: Record<string, unknown> = {
            preview: retryAttempt.preview,
            previewRuntime: previewTask.previewRuntime
        }
        body[repairFlag] = true
        return {
            status: 200,
            body,
            task: previewTask
        }
    }

    appendPreviewStateResult({
        status: 'failure',
        preview: retryAttempt.preview,
        previewPath: attemptedPreviewPath,
        error: retryAttempt.error,
        fallbackNote: 'Preview still failed after the automatic repair prompt.'
    })
    const retryFailureFingerprint = buildPreviewFailureFingerprint({
        reason: 'preview_start_failed',
        blockedReason: retryAttempt.rawMessage,
        previewPath: attemptedPreviewPath,
        preview: retryAttempt.preview
            ? {
                status: retryAttempt.preview.status,
                command: retryAttempt.preview.command ?? null,
                error: retryAttempt.preview.error ?? null,
                logTail: retryAttempt.preview.logTail
            }
            : null
    })
    previewTask = blockPreviewRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: previewTask,
        sessionId: options.resolved.session.id,
        blockedReason: retryAttempt.error,
        failureFingerprint: retryFailureFingerprint,
        note: buildPreviewBlockedNote(retryAttempt.error, PREVIEW_REPAIR_MANUAL_STEP),
        manualStep: PREVIEW_REPAIR_MANUAL_STEP,
        retryCount
    })
    const body: Record<string, unknown> = {
        error: retryAttempt.error,
        previewRuntime: previewTask.previewRuntime
    }
    body[repairFlag] = true
    return {
        status: retryAttempt.status,
        body,
        task: previewTask
    }
}

function scheduleDeferredPreviewStart(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    requestedMode: 'auto' | 'local' | 'worktree'
    basePort?: number
}): void {
    const key = buildPreviewMonitorKey(options.namespace, options.taskId)
    const existing = inFlightPreviewDeferredStartControllers.get(key)
    if (existing) {
        existing.canceled = true
    }

    const controller = { canceled: false }
    inFlightPreviewDeferredStartControllers.set(key, controller)

    void (async () => {
        try {
            const startedAt = Date.now()

            while (!controller.canceled && Date.now() - startedAt < AUTO_PREVIEW_DEFERRED_START_TIMEOUT_MS) {
                const resolved = resolveTaskPreviewAccess({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    taskId: options.taskId
                })
                if (!resolved.ok) {
                    return
                }

                let previewTask = withTaskPreviewRuntime(resolved.task)
                if (!previewTask) {
                    return
                }
                if (previewTask.previewRuntime?.status === 'canceled' || previewTask.previewRuntime?.status === 'stopped') {
                    return
                }
                if (!resolved.session.active) {
                    blockPreviewRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        sessionId: previewTask.previewRuntime?.sessionId ?? resolved.session.id,
                        blockedReason: PREVIEW_SESSION_INACTIVE_BLOCKED_REASON,
                        failureFingerprint: buildPreviewFailureFingerprint({
                            reason: 'session_inactive',
                            blockedReason: PREVIEW_SESSION_INACTIVE_BLOCKED_REASON
                        }),
                        note: buildPreviewBlockedNote(PREVIEW_SESSION_INACTIVE_BLOCKED_REASON, PREVIEW_SESSION_MANUAL_STEP),
                        manualStep: PREVIEW_SESSION_MANUAL_STEP,
                        retryCount: previewTask.previewRuntime?.retryCount
                    })
                    return
                }

                const hasPendingRequests = sessionHasPendingRequests(resolved.session)
                if (resolved.session.thinking || hasPendingRequests) {
                    await waitWithUnrefTimer(AUTO_PREVIEW_MONITOR_POLL_INTERVAL_MS)
                    continue
                }

                const previewPath = resolveTaskPreviewPath(resolved.session, options.requestedMode)
                if (!previewPath.ok) {
                    blockPreviewRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        sessionId: previewTask.previewRuntime?.sessionId ?? resolved.session.id,
                        blockedReason: previewPath.error,
                        failureFingerprint: buildPreviewFailureFingerprint({
                            reason: 'preview_path_unavailable',
                            blockedReason: previewPath.error
                        }),
                        note: buildPreviewBlockedNote(previewPath.error, PREVIEW_SESSION_MANUAL_STEP),
                        manualStep: PREVIEW_SESSION_MANUAL_STEP,
                        retryCount: previewTask.previewRuntime?.retryCount
                    })
                    return
                }

                await runPreviewStartFlow({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    resolved,
                    task: previewTask,
                    previewPath,
                    basePort: options.basePort
                })
                return
            }

            if (controller.canceled) {
                return
            }

            const resolved = resolveTaskPreviewAccess({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                taskId: options.taskId
            })
            if (!resolved.ok) {
                return
            }
            const previewTask = withTaskPreviewRuntime(resolved.task)
            if (!previewTask || previewTask.previewRuntime?.status === 'canceled' || previewTask.previewRuntime?.status === 'stopped') {
                return
            }

            blockPreviewRuntime({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: previewTask,
                sessionId: previewTask.previewRuntime?.sessionId ?? resolved.session.id,
                blockedReason: PREVIEW_WAIT_TIMEOUT_BLOCKED_REASON,
                failureFingerprint: buildPreviewFailureFingerprint({
                    reason: 'session_busy_timeout',
                    blockedReason: PREVIEW_WAIT_TIMEOUT_BLOCKED_REASON
                }),
                note: buildPreviewBlockedNote(PREVIEW_WAIT_TIMEOUT_BLOCKED_REASON, PREVIEW_WAIT_MANUAL_STEP),
                manualStep: PREVIEW_WAIT_MANUAL_STEP,
                retryCount: previewTask.previewRuntime?.retryCount
            })
        } finally {
            if (inFlightPreviewDeferredStartControllers.get(key) === controller) {
                inFlightPreviewDeferredStartControllers.delete(key)
            }
        }
    })()
}

function schedulePreviewSelfHealMonitor(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    sessionId: string
    previewPath: Extract<TaskPreviewPathResult, { ok: true }>
    basePort?: number
}): void {
    const key = buildPreviewMonitorKey(options.namespace, options.taskId)
    const existing = inFlightPreviewMonitorControllers.get(key)
    if (existing) {
        existing.canceled = true
    }

    const controller = { canceled: false }
    inFlightPreviewMonitorControllers.set(key, controller)

    void (async () => {
        try {
            const startedAt = Date.now()

            while (!controller.canceled && Date.now() - startedAt < AUTO_PREVIEW_MONITOR_TIMEOUT_MS) {
                await waitWithUnrefTimer(AUTO_PREVIEW_MONITOR_POLL_INTERVAL_MS)
                if (controller.canceled) {
                    return
                }

                const resolved = resolveTaskPreviewAccess({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    taskId: options.taskId
                })
                if (!resolved.ok) {
                    return
                }
                if (resolved.session.id !== options.sessionId) {
                    return
                }

                let previewTask = withTaskPreviewRuntime(resolved.task)
                if (!previewTask || previewTask.previewRuntime?.status === 'canceled') {
                    return
                }

                const statusResult = await getPreviewStatusWithFallback({
                    engine: options.engine,
                    resolved
                })
                if (!statusResult.ok) {
                    return
                }

                const preview = statusResult.preview
                if (preview.taskId && preview.taskId !== options.taskId) {
                    return
                }
                if (preview.status === 'ready' || preview.status === 'starting') {
                    previewTask = syncPreviewRuntimeFromLivePreview({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        preview
                    })
                    continue
                }
                if (preview.status === 'idle') {
                    return
                }
                if (preview.status !== 'error' && preview.status !== 'stopped') {
                    continue
                }

                const appendPreviewMonitorResult = (messageOptions: {
                    status: 'success' | 'failure'
                    preview?: Awaited<ReturnType<SyncEngine['previewStatusForSession']>> | null
                    error?: string | null
                    fallbackNote?: string | null
                }): void => {
                    appendAssistantTextMessage({
                        store: options.store,
                        engine: options.engine,
                        sessionId: resolved.session.id,
                        localId: `${AUTO_PREVIEW_RESULT_LOCAL_ID_PREFIX}${options.taskId}:${Date.now()}:${randomUUID()}`,
                        text: buildPreviewStartResultMessage({
                            status: messageOptions.status,
                            mode: messageOptions.preview?.mode ?? options.previewPath.mode,
                            rootPath: messageOptions.preview?.rootPath ?? options.previewPath.rootPath,
                            command: messageOptions.preview?.command ?? null,
                            url: messageOptions.preview?.url ?? null,
                            previewStatus: messageOptions.preview?.status ?? null,
                            error: messageOptions.error ?? messageOptions.preview?.error ?? null,
                            logTail: messageOptions.preview?.logTail,
                            fallbackNote: messageOptions.fallbackNote ?? null
                        })
                    })
                }

                const failureReason = preview.error ?? 'Preview crashed after earlier startup success'
                const failureFingerprint = buildPreviewFailureFingerprint({
                    reason: 'preview_start_failed',
                    blockedReason: failureReason,
                    previewPath: options.previewPath,
                    preview: {
                        status: preview.status,
                        command: preview.command ?? null,
                        error: preview.error ?? null,
                        logTail: preview.logTail
                    }
                })

                appendPreviewMonitorResult({
                    status: 'failure',
                    preview,
                    error: failureReason,
                    fallbackNote: 'Preview crashed after earlier startup success. HOPI is starting an automatic repair attempt.'
                })

                if (
                    previewTask.previewRuntime?.failureFingerprint === failureFingerprint
                    || (previewTask.previewRuntime?.retryCount ?? 0) >= AUTO_PREVIEW_MAX_REPAIR_ATTEMPTS
                ) {
                    const blockedReason = (previewTask.previewRuntime?.retryCount ?? 0) >= AUTO_PREVIEW_MAX_REPAIR_ATTEMPTS
                        ? preview.error ?? 'Preview crashed again after automatic repair attempts were exhausted.'
                        : failureReason
                    previewTask = blockPreviewRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        sessionId: resolved.session.id,
                        blockedReason,
                        failureFingerprint,
                        note: buildPreviewBlockedNote(blockedReason, PREVIEW_REPAIR_MANUAL_STEP),
                        manualStep: PREVIEW_REPAIR_MANUAL_STEP,
                        retryCount: previewTask.previewRuntime?.retryCount
                    })
                    return
                }

                const retryCount = getNextPreviewRepairAttemptRetryCount(previewTask)
                previewTask = updateTaskPreviewRuntime({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task: previewTask,
                    status: 'retrying',
                    sessionId: resolved.session.id,
                    retryCount,
                    failureFingerprint,
                    blockedReason: null,
                    latestNote: buildPreviewRetryingNote(),
                    completedAt: null
                }) ?? previewTask

                const repairAttempt = await tryAutoRepairPreviewFailure({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    sessionId: resolved.session.id,
                    task: {
                        id: options.taskId,
                        title: resolved.task.title
                    },
                    mode: options.previewPath.mode,
                    rootPath: options.previewPath.rootPath,
                    basePort: options.basePort,
                    failureMessage: failureReason,
                    command: preview.command ?? null,
                    logTail: preview.logTail
                })
                if (!repairAttempt.ok) {
                    appendPreviewMonitorResult({
                        status: 'failure',
                        preview,
                        error: repairAttempt.error,
                        fallbackNote: 'Automatic preview repair prompt did not complete successfully.'
                    })
                    const manualStep = repairAttempt.status === 503 ? PREVIEW_SESSION_MANUAL_STEP : PREVIEW_REPAIR_MANUAL_STEP
                    previewTask = blockPreviewRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        sessionId: resolved.session.id,
                        blockedReason: repairAttempt.error,
                        failureFingerprint: buildPreviewFailureFingerprint({
                            reason: 'repair_prompt_failed',
                            blockedReason: repairAttempt.error,
                            previewPath: options.previewPath
                        }),
                        note: buildPreviewBlockedNote(repairAttempt.error, manualStep),
                        manualStep,
                        retryCount
                    })
                    return
                }

                const retryAttempt = await runObservedPreviewAttempt({
                    engine: options.engine,
                    resolved,
                    previewPath: options.previewPath,
                    basePort: options.basePort
                })
                if (!retryAttempt.ok) {
                    appendPreviewMonitorResult({
                        status: 'failure',
                        preview: retryAttempt.preview,
                        error: retryAttempt.error,
                        fallbackNote: 'Preview still failed after the automatic repair prompt.'
                    })
                    previewTask = blockPreviewRuntime({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        task: previewTask,
                        sessionId: resolved.session.id,
                        blockedReason: retryAttempt.error,
                        failureFingerprint: buildPreviewFailureFingerprint({
                            reason: 'preview_start_failed',
                            blockedReason: retryAttempt.rawMessage,
                            previewPath: options.previewPath,
                            preview: retryAttempt.preview
                                ? {
                                    status: retryAttempt.preview.status,
                                    command: retryAttempt.preview.command ?? null,
                                    error: retryAttempt.preview.error ?? null,
                                    logTail: retryAttempt.preview.logTail
                                }
                                : null
                        }),
                        note: buildPreviewBlockedNote(retryAttempt.error, PREVIEW_REPAIR_MANUAL_STEP),
                        manualStep: PREVIEW_REPAIR_MANUAL_STEP,
                        retryCount
                    })
                    return
                }

                appendPreviewMonitorResult({
                    status: 'success',
                    preview: retryAttempt.preview,
                    fallbackNote: 'Preview background auto-repair completed and direct retry now works.'
                })
                previewTask = syncPreviewRuntimeFromLivePreview({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    task: previewTask,
                    preview: retryAttempt.preview
                })
            }
        } finally {
            if (inFlightPreviewMonitorControllers.get(key) === controller) {
                inFlightPreviewMonitorControllers.delete(key)
            }
        }
    })()
}

function sumAttachmentBytes(attachments: Array<z.infer<typeof taskAttachmentSchema>>): number {
    let total = 0
    for (const att of attachments) {
        total += Number.isFinite(att.size) ? att.size : 0
    }
    return total
}

function validateAttachments(attachments: Array<z.infer<typeof taskAttachmentSchema>>): { ok: true } | { ok: false; error: string } {
    const total = sumAttachmentBytes(attachments)
    if (total > MAX_TASK_ATTACHMENTS_BYTES) {
        return { ok: false, error: 'Task attachments exceed 10MB total limit' }
    }

    for (const att of attachments) {
        const estimated = estimateDataUrlBytes(att.dataUrl)
        if (att.size > 0 && estimated > 0 && Math.abs(estimated - att.size) > 1024) {
            // Best-effort check only; allow minor mismatch due to encoding/metadata
            continue
        }
    }

    return { ok: true }
}

function resolveTaskPreviewAccess(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): {
    ok: true
    task: StoredTask
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>
    machineId: string | null
} | {
    ok: false
    status: 400 | 403 | 404
    error: string
} {
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task) {
        return { ok: false, status: 404, error: 'Task not found' }
    }
    if (!task.activeSessionId) {
        return { ok: false, status: 400, error: 'Task has no active session' }
    }

    const access = options.engine.resolveSessionAccess(task.activeSessionId, options.namespace)
    if (!access.ok) {
        return {
            ok: false,
            status: access.reason === 'access-denied' ? 403 : 404,
            error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
        }
    }

    const machineId = typeof access.session.metadata?.machineId === 'string'
        ? access.session.metadata.machineId.trim()
        : ''

    return {
        ok: true,
        task,
        session: access.session,
        machineId: machineId || null
    }
}

export function createTasksRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects/:projectId/tasks', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const query = listTasksQuerySchema.safeParse(c.req.query())
        const includeArchived = query.success ? query.data.includeArchived === 'true' : false
        const tasks = options.store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { includeArchived })
        return c.json({ tasks })
    })

    app.post('/projects/:projectId/tasks', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = createTaskSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const attachments = parsed.data.attachments ?? []
        const attachmentsCheck = validateAttachments(attachments)
        if (!attachmentsCheck.ok) {
            return c.json({ error: attachmentsCheck.error }, 413)
        }
        const workflowProfile = parsed.data.workflowProfile.trim().toLowerCase()
        const defaultWorkflowPhase = parsed.data.workflowPhase
            ?? getDefaultWorkflowPhase({ workflowProfile })

        const taskId = randomUUID()
        const created = options.store.tasks.createTask({
            id: taskId,
            projectId,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            status: parsed.data.status ?? 'planned',
            priority: parsed.data.priority ?? null,
            sortKey: parsed.data.sortKey ?? Date.now(),
            workspaceId: parsed.data.workspaceId ?? null,
            agentFlavor: parsed.data.agentFlavor ?? null,
            permissionMode: parsed.data.permissionMode ?? null,
            model: parsed.data.model ?? null,
            modelMode: parsed.data.modelMode ?? null,
            workflowProfile,
            workflowPhase: defaultWorkflowPhase,
            attachments: attachments.length > 0 ? attachments : undefined,
            subTasks: parsed.data.subTasks,
            subTasksUpdatedAt: parsed.data.subTasks ? Date.now() : null,
            source: 'manual'
        })

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'task-added', taskId, projectId, namespace, data: { taskId } })

        return c.json({ task: created })
    })

    app.get('/tasks/:taskId', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ task })
    })

    app.patch('/tasks/:taskId', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const preferredLocale = resolveRequestLocale(
            c.req.header(PRODUCT_HEADERS.LOCALE)
            ?? c.req.header('accept-language')
            ?? undefined
        )
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = updateTaskSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const attachments = parsed.data.attachments
        if (attachments) {
            const attachmentsCheck = validateAttachments(attachments)
            if (!attachmentsCheck.ok) {
                return c.json({ error: attachmentsCheck.error }, 413)
            }
        }

        const statusChangingToFinished = parsed.data.status === 'finished' && existing.status !== 'finished'
        const finishedAt = statusChangingToFinished ? Date.now() : undefined
        const strategy = getWorkflowStrategy(existing)
        const finishedTransitionPatch = statusChangingToFinished
            ? strategy.getTaskPatchForTransition('task_finished', existing)
            : null

        const updated = options.store.tasks.updateTaskByNamespace(taskId, namespace, {
            title: parsed.data.title,
            description: parsed.data.description,
            status: parsed.data.status,
            source: parsed.data.source,
            priority: parsed.data.priority,
            workspaceId: parsed.data.workspaceId,
            agentFlavor: parsed.data.agentFlavor,
            permissionMode: parsed.data.permissionMode,
            model: parsed.data.model,
            modelMode: parsed.data.modelMode,
            workflowPhase: parsed.data.workflowPhase !== undefined
                ? parsed.data.workflowPhase
                : finishedTransitionPatch?.workflowPhase,
            workflowProfile: parsed.data.workflowProfile?.trim().toLowerCase(),
            sortKey: parsed.data.sortKey,
            activeSessionId: parsed.data.activeSessionId,
            attachments: attachments,
            subTasks: parsed.data.subTasks,
            subTasksUpdatedAt: parsed.data.subTasks !== undefined ? Date.now() : undefined,
            finishedAt
        })

        if (!updated) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const engine = options.getSyncEngine()
        if (statusChangingToFinished && engine) {
            void handleTaskMovedToFinished({
                store: options.store,
                engine,
                namespace,
                taskId,
                preferredLocale
            })
        }

        engine?.handleRealtimeEvent({
            type: 'task-updated',
            taskId,
            projectId: updated.projectId,
            namespace,
            data: { taskId }
        })

        return c.json({ task: updated })
    })

    app.post('/tasks/:taskId/archive', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const ok = options.store.tasks.archiveTaskByNamespace(taskId, namespace)
        if (!ok) {
            return c.json({ error: 'Failed to archive task' }, 500)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'task-updated', taskId, projectId: existing.projectId, namespace, data: { taskId, archived: true } })

        return c.json({ ok: true })
    })

    app.delete('/tasks/:taskId', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }
        if (existing.source !== 'improvements_scan') {
            return c.json({ error: 'Only pending auto-generated tasks can be rejected' }, 409)
        }

        const ok = options.store.tasks.deleteTaskByNamespace(taskId, namespace)
        if (!ok) {
            return c.json({ error: 'Failed to delete task' }, 500)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({
            type: 'task-removed',
            taskId,
            projectId: existing.projectId,
            namespace
        })

        return c.json({ ok: true })
    })

    app.post('/tasks/:taskId/attach-session', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = attachSessionSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const access = engine.resolveSessionAccess(parsed.data.sessionId, namespace)
        if (!access.ok) {
            return c.json({ error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }, access.reason === 'access-denied' ? 403 : 404)
        }

        const updated = relinkTaskToSession({
            store: options.store,
            engine,
            task,
            namespace,
            sessionId: access.sessionId
        })
        if (!updated) {
            return c.json({ error: 'Task not found' }, 404)
        }

        return c.json({ task: updated })
    })

    app.post('/tasks/:taskId/start-session', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const json = await c.req.json().catch(() => null)
        const parsed = startSessionSchema.safeParse(json ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const result = await startSessionFromTask({
            store: options.store,
            engine,
            namespace,
            taskId,
            overrides: parsed.data
        })

        if (!result.ok) {
            const status = result.error === 'Task not found'
                ? 404
                : result.error === 'Project not found' || result.error === 'Workspace not found' || result.error === 'Machine not found'
                    ? 404
                    : result.error === 'No workspace selected'
                        ? 400
                        : result.error.startsWith('Runner offline')
                            ? 503
                            : 500
            return c.json({ error: result.error }, status)
        }

        return c.json({
            task: result.task,
            sessionId: result.sessionId,
            initRecoveryAttempted: result.initRecoveryAttempted,
            initRecoveryError: result.initRecoveryError
        })
    })

    app.post('/tasks/:taskId/preview/start', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const json = await c.req.json().catch(() => null)
        const parsed = previewStartSchema.safeParse(json ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const resolved = resolveTaskPreviewAccess({
            store: options.store,
            engine,
            namespace,
            taskId
        })
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        let previewTask = withTaskPreviewRuntime(resolved.task)
        if (!previewTask) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const requestedMode = parsed.data.mode ?? 'auto'
        const previewPath = resolveTaskPreviewPath(resolved.session, requestedMode)
        if (!previewPath.ok) {
            return c.json({ error: previewPath.error }, previewPath.status)
        }

        cancelPreviewDeferredStart(namespace, taskId)
        cancelPreviewSelfHealMonitor(namespace, taskId)

        if (!resolved.session.active) {
            const blockedReason = PREVIEW_SESSION_INACTIVE_BLOCKED_REASON
            previewTask = blockPreviewRuntime({
                store: options.store,
                engine,
                namespace,
                task: previewTask,
                sessionId: previewTask.previewRuntime?.sessionId ?? resolved.session.id,
                blockedReason,
                failureFingerprint: buildPreviewFailureFingerprint({
                    reason: 'session_inactive',
                    blockedReason
                }),
                note: buildPreviewBlockedNote(blockedReason, PREVIEW_SESSION_MANUAL_STEP),
                manualStep: PREVIEW_SESSION_MANUAL_STEP,
                retryCount: previewTask.previewRuntime?.retryCount
            })
            return c.json({
                error: blockedReason,
                previewRuntime: previewTask.previewRuntime
            }, 503)
        }

        const requestStartedAt = Date.now()
        const runnableState = getSessionRunnableState(resolved.session)
        if (runnableState === 'queued' || runnableState === 'approval_pending') {
            const skippedReason: TaskPreviewKickoffSkippedReason = runnableState
            previewTask = updateTaskPreviewRuntime({
                store: options.store,
                engine,
                namespace,
                task: previewTask,
                status: skippedReason,
                sessionId: resolved.session.id,
                requestedAt: requestStartedAt,
                startedAt: null,
                completedAt: null,
                blockedReason: null,
                latestNote: skippedReason === 'approval_pending' ? buildPreviewApprovalPendingNote() : buildPreviewQueuedNote()
            }) ?? previewTask

            scheduleDeferredPreviewStart({
                store: options.store,
                engine,
                namespace,
                taskId: resolved.task.id,
                requestedMode,
                basePort: parsed.data.basePort
            })

            return c.json(buildTaskPreviewResponse({
                task: previewTask,
                preview: buildIdlePreviewStatus({
                    taskId: resolved.task.id,
                    sessionId: resolved.session.id,
                    previewPath
                }),
                skippedReason
            }))
        }

        const result = await runPreviewStartFlow({
            store: options.store,
            engine,
            namespace,
            resolved,
            task: previewTask,
            previewPath,
            basePort: parsed.data.basePort,
            requestedAt: requestStartedAt
        })
        return c.json(result.body, result.status as 200 | 500 | 503 | 504)
    })

    app.get('/tasks/:taskId/preview', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const resolved = resolveTaskPreviewAccess({
            store: options.store,
            engine,
            namespace,
            taskId
        })
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        let previewTask = withTaskPreviewRuntime(resolved.task)
        if (!previewTask) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const normalizePreview = (preview: Awaited<ReturnType<SyncEngine['previewStatusForSession']>>) => {
            if (preview.taskId && preview.taskId !== resolved.task.id) {
                return {
                    active: false,
                    status: 'idle' as const,
                    updatedAt: Date.now(),
                    logTail: []
                }
            }
            return preview
        }

        try {
            const preview = normalizePreview(await engine.previewStatusForSession(resolved.session.id))
            previewTask = syncPreviewRuntimeFromLivePreview({
                store: options.store,
                engine,
                namespace,
                task: previewTask,
                preview
            })
            return c.json(buildTaskPreviewResponse({
                task: previewTask,
                preview
            }))
        } catch (sessionError) {
            const sessionMessage = formatErrorMessage(sessionError, 'Preview status failed')
            if (!isPreviewRpcUnavailable(sessionMessage)) {
                return c.json({ error: sessionMessage }, resolvePreviewErrorStatus(sessionMessage))
            }

            if (!resolved.machineId) {
                return c.json({
                    error: `${sessionMessage}. Please restart the task session to load preview RPC handlers.`
                }, 503)
            }

            try {
                const preview = normalizePreview(await engine.previewStatus(resolved.machineId))
                previewTask = syncPreviewRuntimeFromLivePreview({
                    store: options.store,
                    engine,
                    namespace,
                    task: previewTask,
                    preview
                })
                return c.json(buildTaskPreviewResponse({
                    task: previewTask,
                    preview
                }))
            } catch (machineError) {
                const machineMessage = formatErrorMessage(machineError, 'Preview status failed')
                const combinedMessage = isPreviewRpcUnavailable(machineMessage)
                    ? `${machineMessage}. Please restart runner/session on this machine to load preview RPC handlers.`
                    : machineMessage
                return c.json({ error: combinedMessage }, resolvePreviewErrorStatus(machineMessage))
            }
        }
    })

    app.post('/tasks/:taskId/preview/stop', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const resolved = resolveTaskPreviewAccess({
            store: options.store,
            engine,
            namespace,
            taskId
        })
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        let previewTask = withTaskPreviewRuntime(resolved.task)
        if (!previewTask) {
            return c.json({ error: 'Task not found' }, 404)
        }

        cancelPreviewDeferredStart(namespace, taskId)
        cancelPreviewSelfHealMonitor(namespace, taskId)

        const currentRuntimeStatus = previewTask.previewRuntime?.status ?? null
        const previewStatusResult = await getPreviewStatusWithFallback({
            engine,
            resolved
        })
        const livePreview = previewStatusResult.ok ? previewStatusResult.preview : null
        const shouldCancelBeforeReady = (isPendingPreviewRuntimeStatus(currentRuntimeStatus) || livePreview?.status === 'starting')
            && livePreview?.status !== 'ready'

        if (shouldCancelBeforeReady) {
            let preview = livePreview ?? buildIdlePreviewStatus({
                taskId: resolved.task.id,
                sessionId: resolved.session.id
            })

            if (livePreview && livePreview.status !== 'idle' && livePreview.status !== 'error' && livePreview.status !== 'stopped') {
                const stopResult = await stopPreviewWithFallback({
                    engine,
                    resolved
                })
                if (stopResult.ok) {
                    preview = stopResult.preview
                }
            }

            previewTask = updateTaskPreviewRuntime({
                store: options.store,
                engine,
                namespace,
                task: previewTask,
                status: 'canceled',
                sessionId: resolved.session.id,
                latestNote: buildPreviewCanceledNote(),
                failureFingerprint: null,
                blockedReason: null,
                completedAt: Date.now()
            }) ?? previewTask
            return c.json({
                preview,
                previewRuntime: previewTask.previewRuntime
            })
        }

        const stopResult = await stopPreviewWithFallback({
            engine,
            resolved
        })
        if (!stopResult.ok) {
            return c.json({ error: stopResult.error }, stopResult.status)
        }

        previewTask = updateTaskPreviewRuntime({
            store: options.store,
            engine,
            namespace,
            task: previewTask,
            status: 'stopped',
            sessionId: resolved.session.id,
            latestNote: buildPreviewStoppedNote(),
            failureFingerprint: null,
            blockedReason: null
        }) ?? previewTask
        return c.json({
            preview: stopResult.preview,
            previewRuntime: previewTask.previewRuntime
        })
    })

    app.get('/tasks/:taskId/worktree/merge-state', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const project = options.store.projects.getProjectByNamespace(task.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        let targetBranch = normalizeBranchName(project.worktreeTargetBranch)
        const baseState: Omit<TaskWorktreeMergeState, 'canMerge' | 'reason' | 'error'> = {
            ok: true,
            targetBranch,
            sourceBranch: null,
            hasWorkingTreeChanges: null,
            committedChangedCount: null,
            mergedAt: task.worktreeMergedAt ?? null,
            mergeCommit: task.worktreeMergeCommit ?? null
        }

        if (!task.activeSessionId) {
            return c.json({
                ...baseState,
                canMerge: false,
                reason: 'task_has_no_active_session',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        if (isActiveMergeRuntimeStatus(task.mergeRuntime?.status)) {
            return c.json({
                ...baseState,
                canMerge: false,
                reason: 'session_busy',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({
                ...baseState,
                canMerge: false,
                reason: 'not_connected',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        const access = engine.resolveSessionAccess(task.activeSessionId, namespace)
        if (!access.ok) {
            return c.json({
                ...baseState,
                canMerge: false,
                reason: access.reason === 'access-denied' ? 'session_access_denied' : 'session_not_found',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        const session = access.session
        const sourceBranch = normalizeBranchName(session.metadata?.worktree?.branch)
        const mergeWorkflow = await loadMergeWorkflowFromSession({
            engine,
            sessionId: session.id,
            session
        })

        if (mergeWorkflow.kind === 'valid') {
            targetBranch = normalizeBranchName(mergeWorkflow.workflow.targetBranch) ?? targetBranch
        } else if (!targetBranch) {
            return c.json({
                ...baseState,
                canMerge: false,
                reason: 'merge_check_failed',
                sourceBranch,
                error: mergeWorkflow.error
            } satisfies TaskWorktreeMergeState)
        }

        const stateWithSession = {
            ...baseState,
            targetBranch,
            sourceBranch
        }

        if (!session.metadata?.worktree || !sourceBranch) {
            return c.json({
                ...stateWithSession,
                canMerge: false,
                reason: 'not_worktree_session',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        const hasPendingRequests = sessionHasPendingRequests(session)
        if (hasPendingRequests) {
            return c.json({
                ...stateWithSession,
                canMerge: false,
                reason: 'session_busy',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        if (session.thinking) {
            return c.json({
                ...stateWithSession,
                canMerge: false,
                reason: 'session_busy',
                error: null
            } satisfies TaskWorktreeMergeState)
        }

        const mergeGitState = await computeMergeGitState({
            engine,
            sessionId: session.id,
            targetBranch: targetBranch ?? '',
            sourceBranch,
            taskMergedAt: task.worktreeMergedAt ?? null
        })

        return c.json({
            ...stateWithSession,
            canMerge: mergeGitState.canMerge,
            reason: mergeGitState.reason,
            sourceBranch: mergeGitState.sourceBranch,
            hasWorkingTreeChanges: mergeGitState.hasWorkingTreeChanges,
            committedChangedCount: mergeGitState.committedChangedCount,
            error: mergeGitState.error
        } satisfies TaskWorktreeMergeState)
    })

    app.post('/tasks/:taskId/worktree/merge', async (c) => {
        try {
            const namespace = c.get('namespace')
            const taskId = c.req.param('taskId')
            const preferredLocale = resolveRequestLocale(
                c.req.header(PRODUCT_HEADERS.LOCALE)
                ?? c.req.header('accept-language')
                ?? undefined
            )
            const json = await c.req.json().catch(() => null)
            const parsed = mergeWorktreeSchema.safeParse(json ?? {})
            if (!parsed.success) {
                return c.json({ error: 'Invalid body' }, 400)
            }

            const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
            if (!task) {
                return c.json({ error: 'Task not found' }, 404)
            }

            if (isActiveMergeRuntimeStatus(task.mergeRuntime?.status)) {
                return c.json(buildMergeKickoffResponse({
                    task,
                    skippedReason: task.mergeRuntime?.status ?? 'running'
                }))
            }

            const project = options.store.projects.getProjectByNamespace(task.projectId, namespace)
            if (!project) {
                return c.json({ error: 'Project not found' }, 404)
            }

            const conflictStrategy = parsed.data.conflictStrategy

            const engine = options.getSyncEngine()
            if (!engine) {
                return c.json({ error: 'Not connected' }, 503)
            }

            let resolvedTask = task
            let sessionId: string | null = null
            let session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>> | null = null
            let autoStarted = false
            let resumed = false
            let relinked = false

            const resolution = await resolveBestUsableTaskSession({
                store: options.store,
                engine,
                task,
                namespace,
                requireWorktree: true,
                allowResume: true
            })

            if (resolution.ok) {
                resolvedTask = resolution.task
                sessionId = resolution.sessionId
                session = resolution.session
                resumed = resolution.resumed
                relinked = resolution.relinked || resolution.source !== 'task-active-session'
            } else if (resolution.reason === 'session_access_denied') {
                return c.json({ error: 'Session access denied' }, 403)
            } else {
                const started = await startSessionFromTask({
                    store: options.store,
                    engine,
                    namespace,
                    taskId,
                    kickoff: { kind: 'skip' }
                })
                if (!started.ok) {
                    return c.json({ error: started.error }, resolveTaskSessionStartErrorStatus(started.error))
                }

                resolvedTask = started.task
                autoStarted = true
                const access = engine.resolveSessionAccess(started.sessionId, namespace)
                if (!access.ok) {
                    return c.json({ error: 'Started session is not ready yet' }, 503)
                }
                sessionId = access.sessionId
                session = access.session
            }

            if (!sessionId || !session?.metadata?.worktree) {
                return c.json({ error: 'Session is not a worktree session' }, 400)
            }

            const mergeWorkflowLoad = await loadMergeWorkflowFromSession({
                engine,
                sessionId,
                session
            })
            if (mergeWorkflowLoad.kind !== 'valid') {
                const blockedReason = mergeWorkflowLoad.error
                const blockedTask = updateTaskMergeRuntime({
                    store: options.store,
                    engine,
                    namespace,
                    task: resolvedTask,
                    status: 'blocked',
                    sessionId,
                    retryCount: getNextMergeAttemptRetryCount(resolvedTask),
                    failureFingerprint: buildMergeFailureFingerprint({
                        reason: mergeWorkflowLoad.kind === 'missing' ? 'contract_missing' : 'contract_invalid',
                        blockedReason
                    }),
                    latestNote: mergeWorkflowLoad.kind === 'missing'
                        ? buildMissingMergeWorkflowContractNote(mergeWorkflowLoad.manifestPath)
                        : buildInvalidMergeWorkflowContractNote(mergeWorkflowLoad.manifestPath, blockedReason),
                    blockedReason
                }) ?? resolvedTask
                return c.json({ error: blockedReason, mergeRuntime: blockedTask.mergeRuntime }, 400)
            }

            const mergeWorkflow = mergeWorkflowLoad.workflow
            const targetBranch = normalizeBranchName(parsed.data.targetBranch)
                ?? normalizeBranchName(mergeWorkflow.targetBranch)
                ?? normalizeBranchName(project.worktreeTargetBranch)
                ?? ''
            if (!targetBranch) {
                return c.json({ error: 'Target branch not configured' }, 400)
            }

            const sourceBranch = normalizeBranchName(session.metadata.worktree.branch)
            const retryCount = getNextMergeAttemptRetryCount(resolvedTask)
            const runningRuntimeStatus = isMergeRetryAttempt(resolvedTask) ? 'retrying' : 'running'
            const mergeState = await computeMergeGitState({
                engine,
                sessionId,
                targetBranch,
                sourceBranch,
                taskMergedAt: resolvedTask.worktreeMergedAt ?? null
            })
            if (!mergeState.canMerge) {
                if (mergeState.reason === 'merge_check_failed') {
                    const message = mergeState.error ?? 'Merge state check failed'
                    const blockedState = buildMergeBlockedRuntimeState({
                        task: resolvedTask,
                        note: buildMergeStateCheckBlockedNote(message),
                        blockedReason: message,
                        failureFingerprint: buildMergeFailureFingerprint({
                            reason: 'merge_check_failed',
                            blockedReason: message,
                            mergeState
                        }),
                        manualStep: MERGE_STATE_CHECK_MANUAL_STEP
                    })
                    updateTaskMergeRuntime({
                        store: options.store,
                        engine,
                        namespace,
                        task: resolvedTask,
                        status: 'blocked',
                        sessionId,
                        retryCount,
                        failureFingerprint: blockedState.failureFingerprint,
                        latestNote: blockedState.latestNote,
                        blockedReason: blockedState.blockedReason
                    })
                    return c.json({ error: message }, resolveMergeExecutionErrorStatus(message))
                }

                const finishedTask = updateTaskMergeRuntime({
                    store: options.store,
                    engine,
                    namespace,
                    task: resolvedTask,
                    status: 'succeeded',
                    sessionId,
                    latestNote: mergeState.reason === 'already_merged'
                        ? 'Target branch already contains this task.'
                        : 'No committed changes are waiting to merge.',
                    completedAt: Date.now()
                }) ?? resolvedTask

                return c.json(buildMergeKickoffResponse({
                    task: finishedTask,
                    skippedReason: mergeState.reason === 'already_merged' ? 'already_merged' : 'no_changes'
                }))
            }

            const mergeHandoffNote = buildMergeHandoffNote({
                autoStarted,
                resumed,
                relinked
            })
            const runnableState = getSessionRunnableState(session)
            const shouldDeferMergeKickoff = runnableState === 'queued' || runnableState === 'approval_pending'

            if (shouldDeferMergeKickoff) {
                const runtimeStatus: MergeKickoffRuntimeStatus = runnableState
                const runtimeNote = runtimeStatus === 'approval_pending'
                    ? buildApprovalPendingActionRuntimeNote({
                        actionLabel: 'Merge',
                        continuation: 'HOPI will attempt the platform merge when the session is free'
                    })
                    : buildQueuedActionRuntimeNote({
                        actionLabel: 'Merge',
                        continuation: 'HOPI will attempt the platform merge when the session is free'
                    })
                const runtimeTask = updateTaskMergeRuntime({
                    store: options.store,
                    engine,
                    namespace,
                    task: resolvedTask,
                    status: runtimeStatus,
                    sessionId,
                    retryCount,
                    latestNote: runtimeNote,
                    startedAt: null,
                    completedAt: null
                }) ?? resolvedTask

                scheduleConversationMergeMonitor({
                    store: options.store,
                    engine,
                    namespace,
                    taskId: runtimeTask.id,
                    sessionId,
                    targetBranch,
                    workflow: mergeWorkflow,
                    deferredPlatformMerge: {
                        conflictStrategy,
                        handoffNote: mergeHandoffNote
                    },
                    preferredLocale
                })

                return c.json(buildMergeKickoffResponse({
                    task: runtimeTask,
                    skippedReason: runtimeStatus
                }))
            }

            const runningTask = updateTaskMergeRuntime({
                store: options.store,
                engine,
                namespace,
                task: resolvedTask,
                status: runningRuntimeStatus,
                sessionId,
                retryCount,
                latestNote: 'Attempting platform merge for the linked worktree.',
                startedAt: Date.now(),
                completedAt: null
            }) ?? resolvedTask

            const mergeAttempt = await attemptPlatformMerge({
                engine,
                sessionId,
                session,
                task: runningTask,
                targetBranch,
                sourceBranch,
                workflow: mergeWorkflow,
                conflictStrategy,
                handoffNote: mergeHandoffNote,
                nextRepairAttempt: 1
            })

            if (mergeAttempt.kind === 'success') {
                appendAssistantTextMessage({
                    store: options.store,
                    engine,
                    sessionId,
                    text: mergeAttempt.transcriptText,
                    localId: `${AUTO_DIRECT_MERGE_RESULT_LOCAL_ID_PREFIX}${runningTask.id}:${Date.now()}`
                })
                const mergedTask = await persistSuccessfulTaskMerge({
                    store: options.store,
                    engine,
                    namespace,
                    task: runningTask,
                    sessionId,
                    sessionMetadataWorktreeBaseCommit: session.metadata?.worktree?.baseCommit,
                    mergeResult: {
                        success: true,
                        commitHash: mergeAttempt.targetHead ?? undefined
                    },
                    markFinishedOnMerge: runningTask.status === 'in_review',
                    preferredLocale
                }) ?? runningTask

                return c.json(buildMergeKickoffResponse({
                    task: mergedTask,
                    skippedReason: null
                }))
            }

            if (mergeAttempt.kind === 'blocked') {
                const blockedState = buildMergeBlockedRuntimeState({
                    task: runningTask,
                    note: mergeAttempt.note,
                    blockedReason: mergeAttempt.blockedReason,
                    failureFingerprint: mergeAttempt.failureFingerprint,
                    manualStep: mergeAttempt.blockedReason === `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`
                        ? `Create ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}, then retry merge.`
                        : MERGE_REPAIR_MANUAL_STEP
                })
                updateTaskMergeRuntime({
                    store: options.store,
                    engine,
                    namespace,
                    task: runningTask,
                    status: 'blocked',
                    sessionId,
                    retryCount,
                    failureFingerprint: blockedState.failureFingerprint,
                    latestNote: blockedState.latestNote,
                    blockedReason: blockedState.blockedReason
                })
                return c.json({ error: mergeAttempt.blockedReason }, resolveMergeExecutionErrorStatus(mergeAttempt.blockedReason))
            }

            appendAssistantTextMessage({
                store: options.store,
                engine,
                sessionId,
                text: mergeAttempt.transcriptText,
                localId: `${AUTO_DIRECT_MERGE_RESULT_LOCAL_ID_PREFIX}${runningTask.id}:${Date.now()}`
            })

            const promptLocalId = `${AUTO_CONVERSATION_MERGE_LOCAL_ID_PREFIX}${runningTask.id}:${Date.now()}`
            try {
                await engine.sendMessage(sessionId, {
                    text: mergeAttempt.promptText,
                    localId: promptLocalId,
                    sentFrom: 'webapp'
                })
            } catch (error) {
                const message = formatErrorMessage(error, 'Failed to send merge conflict resolution request')
                updateTaskMergeRuntime({
                    store: options.store,
                    engine,
                    namespace,
                    task: runningTask,
                    status: 'blocked',
                    sessionId,
                    retryCount,
                    latestNote: `Platform merge found conflicts, but conflict-resolution handoff failed: ${message}. Retry merge after the linked session is ready.`,
                    blockedReason: message
                })
                return c.json({ error: message }, resolveMergeExecutionErrorStatus(message))
            }

            const runtimeTask = updateTaskMergeRuntime({
                store: options.store,
                engine,
                namespace,
                task: runningTask,
                status: isMergeRetryAttempt(runningTask) ? 'retrying' : 'running',
                sessionId,
                retryCount,
                failureFingerprint: mergeAttempt.failureFingerprint,
                latestNote: mergeAttempt.repairKind === 'verify'
                    ? buildMergeVerifyRepairAttemptNote(1)
                    : 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                startedAt: runningTask.mergeRuntime?.startedAt ?? Date.now(),
                completedAt: null
            }) ?? runningTask

            scheduleConversationMergeMonitor({
                store: options.store,
                engine,
                namespace,
                taskId: runtimeTask.id,
                sessionId,
                promptLocalId,
                targetBranch,
                workflow: mergeWorkflow,
                repairAttempt: 1,
                conflictStrategy,
                handoffNote: mergeHandoffNote,
                preferredLocale
            })

            return c.json(buildMergeKickoffResponse({
                task: runtimeTask,
                skippedReason: 'running'
            }))
        } catch (error) {
            const message = formatErrorMessage(error, 'Merge failed unexpectedly')
            console.error('[Tasks] Unexpected merge error:', error)
            return c.json({ error: message }, 500)
        }
    })

    app.post('/tasks/:taskId/worktree/merge/cancel', async (c) => {
        try {
            const namespace = c.get('namespace')
            const taskId = c.req.param('taskId')
            const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
            if (!task) {
                return c.json({ error: 'Task not found' }, 404)
            }

            if (!isActiveMergeRuntimeStatus(task.mergeRuntime?.status)) {
                return c.json({ ok: true, canceled: false, mergeRuntime: task.mergeRuntime })
            }

            const engine = options.getSyncEngine()
            if (engine && task.activeSessionId) {
                const access = engine.resolveSessionAccess(task.activeSessionId, namespace)
                if (access.ok) {
                    try {
                        await engine.abortSession(access.sessionId)
                    } catch {
                    }
                }
            }

            const updatedTask = options.store.tasks.updateTaskByNamespace(task.id, namespace, {
                mergeRuntime: buildTaskMergeRuntime({
                    task,
                    status: 'canceled',
                    sessionId: task.mergeRuntime?.sessionId ?? task.activeSessionId ?? null,
                    latestNote: 'Merge canceled from the task action.',
                    blockedReason: null,
                    completedAt: Date.now()
                })
            })
            if (!updatedTask) {
                return c.json({ error: 'Task not found' }, 404)
            }

            if (engine) {
                emitTaskUpdatedEvent({
                    engine,
                    namespace,
                    taskId: updatedTask.id,
                    projectId: updatedTask.projectId,
                    data: {
                        activeSessionId: updatedTask.activeSessionId,
                        mergeRuntime: updatedTask.mergeRuntime
                    }
                })
            }

            return c.json({ ok: true, canceled: true, mergeRuntime: updatedTask.mergeRuntime })
        } catch (error) {
            const message = formatErrorMessage(error, 'Merge cancel failed unexpectedly')
            console.error('[Tasks] Unexpected merge cancel error:', error)
            return c.json({ error: message }, 500)
        }
    })

    return app
}
