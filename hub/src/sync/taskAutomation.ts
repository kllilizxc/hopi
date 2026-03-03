import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { DecryptedMessage, SyncEvent } from '@hapi/protocol/types'
import type { Store } from '../store'
import type { SyncEngine } from './syncEngine'

const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'
const AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX = 'auto:merge_conflict_resolve:'
const DISABLE_BACKSCAN_ENV = 'HAPI_TASK_AUTOMATION_DISABLE_BACKSCAN'

type TaskAutomationOptions = {
    disableBackscan?: boolean
}

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) return false
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
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

function isInternalAutomationLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX)
}

function isMergeConflictAutoResolveLocalId(localId: unknown): boolean {
    if (typeof localId !== 'string') return false
    return localId.startsWith(AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX)
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

function isNonEmptyText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0
}

function hasAssistantTextInOutputPayload(payload: unknown): boolean {
    if (isNonEmptyText(payload)) {
        return true
    }

    if (!payload || typeof payload !== 'object') {
        return false
    }

    const record = payload as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : null

    if (type === 'text') {
        return isNonEmptyText(record.text)
    }

    if (type === 'summary') {
        return isNonEmptyText(record.summary)
    }

    if (type === 'assistant') {
        const message = record.message
        if (!message || typeof message !== 'object') {
            return false
        }

        const content = (message as { content?: unknown }).content
        if (isNonEmptyText(content)) {
            return true
        }

        if (Array.isArray(content)) {
            return content.some((item) => {
                if (!item || typeof item !== 'object') {
                    return false
                }
                const part = item as Record<string, unknown>
                const partType = typeof part.type === 'string' ? part.type : null
                if (partType !== null && partType !== 'text') {
                    return false
                }
                return isNonEmptyText(part.text)
            })
        }
    }

    return false
}

function hasAssistantTextInCodexPayload(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
        return false
    }

    const record = payload as Record<string, unknown>
    if (record.type !== 'message') {
        return false
    }

    return isNonEmptyText(record.message)
}

function isAssistantReplyMessage(message: DecryptedMessage): boolean {
    if (isReadyEventMessage(message)) return false
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return false
    if (record.role !== 'assistant' && record.role !== 'agent') return false

    const content = record.content
    if (isNonEmptyText(content)) {
        return true
    }

    if (!content || typeof content !== 'object') {
        return false
    }

    if (!('type' in content)) {
        return false
    }

    const type = (content as { type?: unknown }).type
    if (type === 'event') {
        return false
    }

    if (type === 'text') {
        return isNonEmptyText((content as { text?: unknown }).text)
    }

    if (type === 'output') {
        return hasAssistantTextInOutputPayload((content as { data?: unknown }).data)
    }

    if (type === 'codex') {
        return hasAssistantTextInCodexPayload((content as { data?: unknown }).data)
    }

    return false
}

function isAutomationPromptMessage(message: DecryptedMessage): boolean {
    if (!isTaskProgressPromptMessage(message)) return false
    return getMessageSentFrom(message) !== 'cli'
}

function isTaskProgressPromptMessage(message: DecryptedMessage): boolean {
    if (getMessageRole(message) !== 'user') return false
    if (isInternalAutomationLocalId(message.localId)) return false
    if (isMergeConflictAutoResolveLocalId(message.localId)) return false
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
    private readonly lastActiveBySessionId: Map<string, boolean> = new Map()
    private readonly lastThinkingBySessionId: Map<string, boolean> = new Map()
    private readonly autoCommitInFlightBySessionId: Set<string> = new Set()
    private readonly disableBackscan: boolean

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine,
        options?: TaskAutomationOptions
    ) {
        this.disableBackscan = options?.disableBackscan ?? isTruthyEnv(process.env[DISABLE_BACKSCAN_ENV])
    }

    handleEvent(event: SyncEvent): void {
        if (event.type.startsWith('task-') || event.type.startsWith('project-') || event.type.startsWith('workspace-')) {
            return
        }

        if (event.type === 'session-added' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (session) {
                this.lastActiveBySessionId.set(event.sessionId, Boolean(session.active))
                this.lastThinkingBySessionId.set(event.sessionId, Boolean(session.thinking))
            }
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.lastActiveBySessionId.delete(event.sessionId)
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

        const previousActive = this.lastActiveBySessionId.get(sessionId)
        const currentActive = Boolean(session.active)
        this.lastActiveBySessionId.set(sessionId, currentActive)

        const previous = this.lastThinkingBySessionId.get(sessionId)
        const current = Boolean(session.thinking)
        this.lastThinkingBySessionId.set(sessionId, current)

        const thinkingStopped = previous === true && current === false
        const becameActiveWhileIdle = previousActive !== true && currentActive === true && current === false

        if (!this.disableBackscan && (thinkingStopped || becameActiveWhileIdle)) {
            this.tryFlipToInReview(sessionId)
        }
    }

    private handleMessageReceived(sessionId: string, message: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        if (isTaskProgressPromptMessage(message)) {
            const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
            if (!current) return
            if (current.archivedAt) return
            const shouldMoveToInProgress = current.status !== 'in_progress'
            const shouldResetMergeState = current.worktreeMergedAt !== null
                || current.worktreeMergeCommit !== null
                || current.finishedAt !== null

            if (shouldMoveToInProgress || shouldResetMergeState) {
                const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                    status: 'in_progress',
                    worktreeMergedAt: null,
                    worktreeMergeCommit: null,
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
            const handled = this.tryFlipToInReviewFromReady(sessionId, message)
            if (!handled && !this.disableBackscan) {
                this.tryFlipToInReview(sessionId)
            }
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
            if (details?.forLocalKey) {
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
            }

            if (this.disableBackscan) return false

            const scan = this.scanForLatestPromptAndReady(sessionId, isAutomationPromptMessage)
            if (!scan) return false
            if (scan.readySeq !== readyMessage.seq) return false
            return true
        })()

        if (!shouldCommit) return

        const taskIdPrefix = task.id.slice(0, 8)
        const title = task.title.trim() || 'Task'
        const commitMessage = `HAPI: task ${taskIdPrefix} — ${title}`.slice(0, 180)

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

    private hasAssistantReplyBetween(
        sessionId: string,
        promptSeq: number,
        readySeq: number
    ): boolean {
        if (readySeq <= promptSeq) {
            return false
        }

        const PAGE_SIZE = 200
        const MAX_SCAN_MESSAGES = 50_000

        let beforeSeq: number | undefined = readySeq
        let scanned = 0

        while (scanned < MAX_SCAN_MESSAGES) {
            const page = this.store.messages.getMessages(sessionId, PAGE_SIZE, beforeSeq)
            if (page.length === 0) {
                break
            }

            scanned += page.length

            for (let i = page.length - 1; i >= 0; i -= 1) {
                const msg = page[i]

                if (msg.seq <= promptSeq) {
                    return false
                }
                if (msg.seq >= readySeq) {
                    continue
                }
                if (isAssistantReplyMessage(msg)) {
                    return true
                }
            }

            beforeSeq = page[0]?.seq
        }

        return false
    }

    private tryFlipToInReviewFromReady(sessionId: string, readyMessage: DecryptedMessage): boolean {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return true

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return true
        if (current.archivedAt) return true
        if (current.status !== 'in_progress') return true

        const details = getReadyEventDetails(readyMessage)
        if (!details) return false

        // Correlation missing: fall back.
        if (!details.forLocalKey) {
            if (this.disableBackscan) return true
            return false
        }

        const storedPrompt = this.store.messages.getMessageByLocalId(sessionId, details.forLocalKey)
        if (!storedPrompt) {
            if (this.disableBackscan) return true
            return false
        }

        const prompt: DecryptedMessage = {
            id: storedPrompt.id,
            seq: storedPrompt.seq,
            localId: storedPrompt.localId,
            content: storedPrompt.content,
            createdAt: storedPrompt.createdAt
        }

        // Ignore internal improvements-scan prompts when deriving task progress.
        if (!isTaskProgressPromptMessage(prompt)) {
            return true
        }

        if (this.disableBackscan) {
            if (details.hasAssistantReply !== true) {
                return true
            }
        } else if (!this.hasAssistantReplyBetween(sessionId, prompt.seq, readyMessage.seq)) {
            return true
        }

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: 'in_review'
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

        return true
    }

    private tryFlipToInReview(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, this.store, sessionId)
        if (!linked) return

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_progress') return

        const scanResult = this.scanForLatestPromptAndReady(sessionId, isTaskProgressPromptMessage)
        if (!scanResult) return
        if (!scanResult.hasAssistantReply) return

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: 'in_review'
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

    private scanForLatestPromptAndReady(
        sessionId: string,
        isPromptMessage: (message: DecryptedMessage) => boolean
    ): {
        promptSeq: number
        readySeq: number
        hasAssistantReply: boolean
    } | null {
        /**
         * Problem: store.messages.getMessages() hard-caps at 200 messages.
         * Long turns (streaming output / many tool calls) can push the prompt outside the last 200 messages,
         * causing lastPromptIndex to be -1 and blocking the flip.
         *
         * Strategy: page backwards from the end until we find the latest ready + the latest tracked prompt.
         * While paging between ready → prompt, track whether any assistant reply happened.
         */

        const PAGE_SIZE = 200
        // Guardrail: avoid unbounded scans in huge sessions.
        // 50k messages ~= "very long / very chatty" agent turns (streaming output, tool spam).
        const MAX_SCAN_MESSAGES = 50_000

        let beforeSeq: number | undefined
        let scanned = 0

        let promptSeq: number | null = null
        let readySeq: number | null = null
        let hasAssistantReply = false

        while (scanned < MAX_SCAN_MESSAGES && (promptSeq === null || readySeq === null)) {
            const page = this.store.messages.getMessages(sessionId, PAGE_SIZE, beforeSeq)
            if (page.length === 0) {
                break
            }

            scanned += page.length

            for (let i = page.length - 1; i >= 0; i -= 1) {
                const msg = page[i]

                if (readySeq === null && isReadyEventMessage(msg)) {
                    readySeq = msg.seq
                    continue
                }

                if (promptSeq === null && isPromptMessage(msg)) {
                    promptSeq = msg.seq
                    break
                }

                if (readySeq !== null && promptSeq === null && isAssistantReplyMessage(msg)) {
                    hasAssistantReply = true
                }
            }

            beforeSeq = page[0]?.seq
        }

        if (promptSeq === null || readySeq === null) return null
        if (readySeq <= promptSeq) return null

        return { promptSeq, readySeq, hasAssistantReply }
    }
}
