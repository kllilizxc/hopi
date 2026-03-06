import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { DecryptedMessage, SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../store'
import type { SyncEngine } from './syncEngine'
import { getWorkflowStrategy } from './workflowStrategy'

const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'
const AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX = 'auto:merge_conflict_resolve:'
const AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX = 'auto:preview_setup:'
const AUTO_WORKFLOW_LOCAL_ID_PREFIX = 'auto:workflow:'

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

function isPreviewSetupLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_PREVIEW_SETUP_LOCAL_ID_PREFIX)
}

function isWorkflowAutomationLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_WORKFLOW_LOCAL_ID_PREFIX)
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

type ReadyEventDetails = {
    forLocalKey: string | null
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

    return { forLocalKey }
}

function isAutomationPromptMessage(message: DecryptedMessage): boolean {
    if (!isTaskProgressPromptMessage(message)) return false
    return getMessageSentFrom(message) !== 'cli'
}

function isTaskProgressPromptMessage(message: DecryptedMessage): boolean {
    if (getMessageRole(message) !== 'user') return false
    if (isInternalAutomationLocalId(message.localId)) return false
    if (isMergeConflictAutoResolveLocalId(message.localId)) return false
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
            this.tryMoveToInReviewFromReady(sessionId, message)
            this.maybeAutoCommitWorktreeFromReady(sessionId, message)
            return
        }
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
}
