import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import type { DecryptedMessage, SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../store'
import { buildTaskInitRuntime, buildTaskPreviewRuntime } from '../utils/taskActionRuntime'
import { loadProjectActionContractFromSession } from './actionContract'
import { applyGoalActionPacketFromSession } from './goals/goalActionPacket'
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
const BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS = 2
const BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS = 2
const BOOTSTRAP_PREVIEW_POLL_INTERVAL_MS = 1_000
const BOOTSTRAP_PREVIEW_TIMEOUT_MS = 120_000

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
        return { namespace, projectId, taskId }
    }

    if (!namespace) {
        return null
    }

    const candidates = store.tasks.listTasksByActiveSessionIdAndNamespace(sessionId, namespace)
    if (candidates.length === 0) {
        return null
    }

    if (typeof projectId === 'string') {
        const projectMatches = candidates.filter((task) => task.projectId === projectId)
        if (projectMatches.length === 1) {
            return { namespace, projectId: projectMatches[0].projectId, taskId: projectMatches[0].id }
        }
    }

    const inProgress = candidates.filter((task) => task.status === 'in_progress')
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

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {
    }

    handleEvent(event: SyncEvent): void {
        if (event.type.startsWith('task-') || event.type.startsWith('project-') || event.type.startsWith('workspace-')) {
            return
        }

        if (event.type === 'session-added' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (session) {
                this.lastThinkingBySessionId.set(event.sessionId, Boolean(session.thinking))
            }
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.lastThinkingBySessionId.delete(event.sessionId)
            this.autoCommitInFlightBySessionId.delete(event.sessionId)
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

        const currentThinking = Boolean(session.thinking)

        const hasPendingRequests = Boolean(session.agentState?.requests && Object.keys(session.agentState.requests).length > 0)
        // When the agent starts thinking again (e.g. after approvals / mode changes),
        // the task should reflect "running" even if the agentState clears in a later tick.
        if (currentThinking) {
            this.tryMoveToInProgressWhenThinking(sessionId)
            this.lastThinkingBySessionId.set(sessionId, currentThinking)
            return
        }

        if (hasPendingRequests) {
            this.tryMoveToInReviewForPermissionRequest(sessionId)
        }

        this.lastThinkingBySessionId.set(sessionId, currentThinking)
    }

    private handleMessageReceived(sessionId: string, message: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        if (isTaskProgressPromptMessage(message)) {
            const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
            if (!current) return
            if (current.archivedAt) return
            if (current.goalId && current.status === 'in_review' && isTaskKickoffLocalId(message.localId)) return

            const strategy = getWorkflowStrategy(current)
            const transitionPatch = strategy.getTaskPatchForTransition('task_prompted', current) ?? { status: 'in_progress' }
            const shouldApplyTransition = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
                || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
            const shouldResetMergeState = current.worktreeMergedAt !== null
                || current.worktreeMergeCommit !== null
                || current.finishedAt !== null
                || current.mergedDiffSnapshot !== null

            if (shouldApplyTransition || shouldResetMergeState) {
                const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                    status: transitionPatch.status ?? 'in_progress',
                    workflowPhase: transitionPatch.workflowPhase,
                    worktreeMergedAt: null,
                    worktreeMergeCommit: null,
                    mergedDiffSnapshot: null,
                    finishedAt: null
                })
                if (updated) {
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: updated.id,
                        projectId: updated.projectId,
                        namespace: linked.namespace,
                        data: { taskId: updated.id }
                    })
                }
            }
            return
        }

        if (getMessageRole(message) === 'assistant' && isReadyEventMessage(message)) {
            const details = getReadyEventDetails(message)
            if (details?.hasAssistantReply === false) {
                return
            }
            const goalActionResult = this.tryApplyGoalActionPacketFromReady(sessionId)
            if (goalActionResult === 'applied') {
                this.maybeRequestAutoMergeAcceptedTask(sessionId)
                this.maybeAutoCommitWorktreeFromReady(sessionId, message)
                return
            }
            if (goalActionResult === 'goal_task') {
                if (isMergeRuntimeReadyEvent(message)) {
                    this.maybeRequestAutoMergeAcceptedTask(sessionId)
                }
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

    private tryApplyGoalActionPacketFromReady(sessionId: string): 'applied' | 'goal_task' | 'not_goal_task' {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return 'not_goal_task'

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current || current.archivedAt || !current.goalId) {
            return 'not_goal_task'
        }
        if (current.status !== 'in_progress' && current.status !== 'in_review') {
            return 'goal_task'
        }

        return applyGoalActionPacketFromSession({
            store: this.store,
            engine: this.engine,
            namespace: linked.namespace,
            projectId: linked.projectId,
            taskId: linked.taskId,
            sessionId
        }) ? 'applied' : 'goal_task'
    }

    private maybeRequestAutoMergeAcceptedTask(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        requestAutoMergeAcceptedTask({
            store: this.store,
            engine: this.engine,
            namespace: linked.namespace,
            taskId: linked.taskId
        })
    }

    private maybeAutoCommitWorktreeFromReady(sessionId: string, readyMessage: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const task = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!task) return
        if (task.archivedAt) return
        if (task.status === 'finished') return

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

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_progress') return

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
        const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', current) ?? { status: 'in_review' }
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
        if (!shouldApply) return

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'in_review',
            workflowPhase: transitionPatch.workflowPhase
        })
        if (updated) {
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: linked.namespace,
                data: { taskId: updated.id }
            })
        }
    }

    private async tryMoveProjectInitTaskToReviewFromReady(
        sessionId: string,
        readyMessage: DecryptedMessage,
        linked: LinkedTask
    ): Promise<void> {
        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_progress') return
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

        const refreshed = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!refreshed) return
        if (refreshed.archivedAt) return
        if (refreshed.status !== 'in_progress') return
        if (refreshed.source !== 'project_init') return

        if (contractLoad.kind !== 'valid') {
            const blockedReason = contractLoad.kind === 'missing'
                ? `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`
                : `Invalid ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}: ${contractLoad.error}`
            const currentRetryCount = refreshed.initRuntime?.retryCount ?? 0
            const nextRetryCount = currentRetryCount + 1

            if (contractLoad.kind === 'invalid' && nextRetryCount <= BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS) {
                const latestNote = `Bootstrap contract still invalid after ready; asked the agent to continue repairing it (${nextRetryCount}/${BOOTSTRAP_CONTRACT_REPAIR_MAX_ATTEMPTS}).`
                const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                    status: 'in_progress',
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

                this.engine.handleRealtimeEvent({
                    type: 'task-updated',
                    taskId: updated.id,
                    projectId: updated.projectId,
                    namespace: linked.namespace,
                    data: { taskId: updated.id }
                })

                try {
                    await this.engine.sendMessage(sessionId, {
                        text: buildBootstrapContractRepairPrompt(contractLoad.error, nextRetryCount),
                        localId: `${AUTO_BOOTSTRAP_REPAIR_LOCAL_ID_PREFIX}${updated.id}:${Date.now()}`,
                        sentFrom: 'webapp'
                    })
                    return
                } catch (error) {
                    const sendError = error instanceof Error ? error.message : String(error)
                    const blocked = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                        status: 'blocked',
                        initRuntime: buildTaskInitRuntime({
                            current: updated.initRuntime,
                            activeSessionId: updated.activeSessionId,
                            status: 'blocked',
                            sessionId,
                            retryCount: nextRetryCount,
                            latestNote: `Bootstrap contract repair prompt could not be sent: ${sendError}`,
                            blockedReason: sendError
                        })
                    })
                    if (!blocked) {
                        return
                    }
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: blocked.id,
                        projectId: blocked.projectId,
                        namespace: linked.namespace,
                        data: { taskId: blocked.id }
                    })
                    this.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: linked.namespace,
                        data: {
                            title: 'Bootstrap repair failed',
                            body: `${blocked.title}: ${sendError}`,
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

            const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                status: 'blocked',
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
            if (!updated) {
                return
            }

            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: linked.namespace,
                data: { taskId: updated.id }
            })
            this.engine.handleRealtimeEvent({
                type: 'toast',
                namespace: linked.namespace,
                data: {
                    title: 'Bootstrap contract is not ready',
                    body: `${updated.title}: ${blockedReason}`,
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
                const latestTask = this.store.tasks.getTaskByNamespace(options.linked.taskId, options.linked.namespace)
                if (!latestTask || latestTask.archivedAt || latestTask.status !== 'in_progress' || latestTask.source !== 'project_init') {
                    return
                }

                const currentRetryCount = latestTask.previewRuntime?.retryCount ?? 0
                const nextRetryCount = currentRetryCount + 1

                try {
                    await this.engine.previewStopForSession(options.sessionId, { taskId: options.linked.taskId })
                } catch {
                }

                if (nextRetryCount <= BOOTSTRAP_PREVIEW_REPAIR_MAX_ATTEMPTS) {
                    const updated = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                        status: 'in_progress',
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

                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: updated.id,
                        projectId: updated.projectId,
                        namespace: options.linked.namespace,
                        data: { taskId: updated.id }
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
                            localId: `${AUTO_BOOTSTRAP_PREVIEW_REPAIR_LOCAL_ID_PREFIX}${updated.id}:${Date.now()}`,
                            sentFrom: 'webapp'
                        })
                    } catch (error) {
                        const sendError = error instanceof Error ? error.message : String(error)
                        const blocked = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                            status: 'blocked',
                            initRuntime: buildTaskInitRuntime({
                                current: updated.initRuntime,
                                activeSessionId: updated.activeSessionId,
                                status: 'blocked',
                                sessionId: options.sessionId,
                                retryCount: nextRetryCount,
                                latestNote: `Bootstrap preview repair prompt could not be sent: ${sendError}`,
                                blockedReason: sendError
                            }),
                            previewRuntime: buildTaskPreviewRuntime({
                                current: updated.previewRuntime,
                                activeSessionId: updated.activeSessionId,
                                status: 'blocked',
                                sessionId: options.sessionId,
                                retryCount: nextRetryCount,
                                latestNote: `Bootstrap preview repair prompt could not be sent: ${sendError}`,
                                blockedReason: sendError
                            })
                        })
                        if (!blocked) {
                            return
                        }
                        this.engine.handleRealtimeEvent({
                            type: 'task-updated',
                            taskId: blocked.id,
                            projectId: blocked.projectId,
                            namespace: options.linked.namespace,
                            data: { taskId: blocked.id }
                        })
                    }
                    return
                }

                const blocked = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                    status: 'blocked',
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

                this.engine.handleRealtimeEvent({
                    type: 'task-updated',
                    taskId: blocked.id,
                    projectId: blocked.projectId,
                    namespace: options.linked.namespace,
                    data: { taskId: blocked.id }
                })
                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: options.linked.namespace,
                    data: {
                        title: 'Bootstrap preview failed',
                        body: `${blocked.title}: ${failure.error}`,
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

            const runningTask = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                status: 'in_progress',
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

            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: runningTask.id,
                projectId: runningTask.projectId,
                namespace: options.linked.namespace,
                data: { taskId: runningTask.id }
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

            const latestTask = this.store.tasks.getTaskByNamespace(options.linked.taskId, options.linked.namespace)
            if (!latestTask || latestTask.archivedAt || latestTask.status !== 'in_progress' || latestTask.source !== 'project_init') {
                return
            }

            const strategy = getWorkflowStrategy(latestTask)
            const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', latestTask) ?? { status: 'in_review' }
            const updated = this.store.tasks.updateTaskByNamespace(options.linked.taskId, options.linked.namespace, {
                status: transitionPatch.status ?? 'in_review',
                workflowPhase: transitionPatch.workflowPhase,
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

            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: options.linked.namespace,
                data: { taskId: updated.id }
            })
        } finally {
            this.bootstrapPreviewInFlightByTaskKey.delete(previewTaskKey)
        }
    }

    private tryMoveToInReviewForPermissionRequest(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_progress') return

        const strategy = getWorkflowStrategy(current)
        const transitionPatch = strategy.getTaskPatchForTransition('assistant_ready', current) ?? { status: 'in_review' }
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
        if (!shouldApply) return

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'in_review',
            workflowPhase: transitionPatch.workflowPhase
        })
        if (updated) {
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: linked.namespace,
                data: { taskId: updated.id }
            })
        }
    }

    private tryMoveToInProgressWhenThinking(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_review') return
        if (current.goalId) return

        const strategy = getWorkflowStrategy(current)
        const transitionPatch = strategy.getTaskPatchForTransition('thinking_resumed', current) ?? { status: 'in_progress' }
        const shouldApply = (transitionPatch.status !== undefined && transitionPatch.status !== current.status)
            || (transitionPatch.workflowPhase !== undefined && transitionPatch.workflowPhase !== current.workflowPhase)
        if (!shouldApply) return

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: transitionPatch.status ?? 'in_progress',
            workflowPhase: transitionPatch.workflowPhase
        })
        if (updated) {
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: linked.namespace,
                data: { taskId: updated.id }
            })
        }
    }

    private tryBlockTaskFromInterruptionEvent(sessionId: string, errorMessage: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status === 'finished') return

        const details = getTaskInterruptionDetails(errorMessage)
        if (!details) return

        const blockedReason = details.message ?? 'Agent session reported an error'
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

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: 'blocked',
            initRuntime
        })
        if (!updated) {
            return
        }

        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: updated.id,
            projectId: updated.projectId,
            namespace: linked.namespace,
            data: { taskId: updated.id }
        })
        this.engine.handleRealtimeEvent({
            type: 'toast',
            namespace: linked.namespace,
            data: {
                title: 'Task blocked',
                body: `${updated.title}: ${blockedReason}`,
                sessionId,
                url: ''
            }
        })
    }
}
