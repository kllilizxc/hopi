import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata, DecryptedMessage, ModelMode, PermissionMode, Session, Task, TaskPreviewStatus } from '@/types/api'
import type { AgentEvent, ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { useTaskPreview } from '@/hooks/mutations/useTaskPreview'
import { useTask } from '@/hooks/queries/useTask'
import { useTaskPreviewState } from '@/hooks/queries/useTaskPreviewState'
import { useTaskWorktreeMergeState } from '@/hooks/queries/useTaskWorktreeMergeState'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import {
    buildInitStatusSummary,
    buildMergeRuntimeSummary,
    buildPreviewStatusSummary,
    buildRecoveredBlockedMergeSummary,
    isActiveMergeRuntimeStatus,
    isActivePreviewRuntimeStatus,
    isRetryableMergeRuntimeStatus,
    isRetryablePreviewRuntimeStatus,
    shouldShowMergeActionButton,
    shouldTreatBlockedMergeAsRecoveredSuccess,
    shouldShowInitRuntimeInSession,
    type TaskActionPreviewStatusSummary as PreviewStatusSummary,
    type TaskActionStatusSummary
} from '@/lib/task-action-runtime'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { SessionHeader } from '@/components/SessionHeader'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useSSE } from '@/hooks/useSSE'
import { useVoiceOptional } from '@/lib/voice-context'
import { useAppContext } from '@/lib/app-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'

function getMessageSentFrom(meta: unknown): string | null {
    if (!meta || typeof meta !== 'object') return null
    const sentFrom = (meta as { sentFrom?: unknown }).sentFrom
    return typeof sentFrom === 'string' ? sentFrom : null
}

function shouldTreatSessionAsRunningFallback(session: Session, normalized: NormalizedMessage[]): boolean {
    if (!session.active) return false
    if (session.thinking) return true

    const hasPendingRequests = Boolean(session.agentState?.requests && Object.keys(session.agentState.requests).length > 0)
    if (hasPendingRequests) {
        return false
    }

    const metadata = session.metadata
    const isRunnerSession = metadata?.startedBy === 'runner'
        || metadata?.startedFromRunner === true
        || typeof metadata?.taskId === 'string'

    if (!isRunnerSession) {
        return false
    }

    let lastPromptAt: number | null = null
    let lastReadyAt: number | null = null
    let lastInterruptedAt: number | null = null

    for (const msg of normalized) {
        if (msg.role === 'user') {
            const sentFrom = getMessageSentFrom(msg.meta)
            if (sentFrom !== 'cli') {
                if (lastPromptAt === null || msg.createdAt > lastPromptAt) {
                    lastPromptAt = msg.createdAt
                }
            }
            continue
        }

        if (msg.role !== 'event' || lastPromptAt === null || msg.createdAt < lastPromptAt) {
            continue
        }

        if (msg.content.type === 'ready') {
            if (lastReadyAt === null || msg.createdAt > lastReadyAt) {
                lastReadyAt = msg.createdAt
            }
            continue
        }

        if (isInterruptedEvent(msg.content)) {
            if (lastInterruptedAt === null || msg.createdAt > lastInterruptedAt) {
                lastInterruptedAt = msg.createdAt
            }
        }
    }

    if (lastPromptAt === null) {
        return false
    }

    if (lastReadyAt !== null && lastReadyAt > lastPromptAt) {
        return false
    }

    if (lastInterruptedAt !== null && lastInterruptedAt > lastPromptAt) {
        return false
    }

    const MAX_FALLBACK_MS = 15 * 60 * 1000
    const ageMs = Date.now() - lastPromptAt
    return ageMs >= 0 && ageMs < MAX_FALLBACK_MS
}

const CONTINUE_PROMPT_TEXT = '继续'
export const SESSION_CHAT_SURFACE_CLASS_NAME = 'relative z-10 flex min-h-0 flex-1 flex-col bg-[var(--app-bg)] app-shadow-chat-surface'

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }
    return String(error)
}

function isInterruptedEvent(event: AgentEvent): boolean {
    // Check for explicit error event type
    if (event.type === 'error') {
        return true
    }

    // Check for API errors that have exhausted retries
    if (event.type === 'api-error') {
        const retryAttempt = typeof event.retryAttempt === 'number' ? event.retryAttempt : null
        const maxRetries = typeof event.maxRetries === 'number' ? event.maxRetries : null
        return retryAttempt !== null && maxRetries !== null && maxRetries > 0 && retryAttempt >= maxRetries
    }

    // Fallback: check for error messages in legacy 'message' type events
    if (event.type !== 'message' || typeof event.message !== 'string') {
        return false
    }

    const message = event.message.toLowerCase()
    return message.includes('aborted by user')
        || message.includes('process exited unexpectedly')
        || message.includes('prompt failed')
        || message.includes('task failed')
}

export function SessionChat(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    messagesVersion: number
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string, attachments?: AttachmentMetadata[]) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    onViewFiles?: () => void
    onViewDiffs?: () => void
    onViewTerminal?: () => void
    headerExtra?: ReactNode
    hideHeader?: boolean
    hideInactiveNotice?: boolean
    rootClassName?: string
    surfaceClassName?: string
    threadContentClassName?: string
    composerOuterClassName?: string
    composerContentClassName?: string
    composerStatusBarVisible?: boolean
    showTerminalControl?: boolean
}) {
    const { token, baseUrl } = useAppContext()
    const { haptic } = usePlatform()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const sessionInactive = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [ignoreRunningFallback, setIgnoreRunningFallback] = useState(false)
    const [mergeActionError, setMergeActionError] = useState<string | null>(null)
    const [previewActionError, setPreviewActionError] = useState<string | null>(null)
    const agentFlavor = props.session.metadata?.flavor ?? null
    const hasPendingRequests = Boolean(props.session.agentState?.requests && Object.keys(props.session.agentState.requests).length > 0)

    const taskRouteMatch = matchRoute({ to: '/projects/$projectId/tasks/$taskId', fuzzy: true })
    const taskParamsFromRoute = taskRouteMatch
        ? { projectId: taskRouteMatch.projectId, taskId: taskRouteMatch.taskId }
        : null
    const taskParamsFromMetadata = props.session.metadata?.projectId && props.session.metadata?.taskId
        ? { projectId: props.session.metadata.projectId, taskId: props.session.metadata.taskId }
        : null
    const taskLink = taskParamsFromRoute ?? taskParamsFromMetadata
    const taskId = taskLink?.taskId ?? null
    const taskProjectId = taskLink?.projectId ?? null
    const composerDraftScope = taskLink
        ? `task:${taskLink.projectId}:${taskLink.taskId}`
        : `session:${props.session.id}`
    const { task } = useTask(props.api, taskId)
    const shouldShowInitStatus = Boolean(
        task
        && !task.archivedAt
        && !task.finishedAt
        && shouldShowInitRuntimeInSession(task, props.session.id)
    )
    const initStatusSummary = useMemo(() => {
        if (!shouldShowInitStatus) {
            return null
        }
        return buildInitStatusSummary(task)
    }, [shouldShowInitStatus, task])
    const mergeRuntime = task?.mergeRuntime ?? null
    const mergeRuntimeStatus = mergeRuntime?.status
    const hasActiveMergeRuntime = isActiveMergeRuntimeStatus(mergeRuntimeStatus)
    const {
        mergeTaskWorktree,
        cancelTaskWorktreeMerge,
        isMerging,
        isCanceling
    } = useMergeTaskWorktree(props.api)
    const {
        startTaskPreview,
        stopTaskPreview,
        isStartingPreview,
        isStoppingPreview,
        isUpdatingPreview,
    } = useTaskPreview(props.api)
    const shouldShowPreviewRuntime = Boolean(
        taskId
        && task
        && task.activeSessionId === props.session.id
        && !task.archivedAt
        && !task.finishedAt
    )
    const shouldQueryPreviewState = shouldShowPreviewRuntime && !sessionInactive
    const {
        preview: previewState,
        previewRuntime,
    } = useTaskPreviewState(props.api, task, {
        enabled: shouldQueryPreviewState,
        sessionId: props.session.id,
        sessionActive: !sessionInactive
    })
    const shouldQueryMergeState = Boolean(
        taskId
        && task
        && task.status === 'in_review'
        && !task.archivedAt
        && !task.finishedAt
        && !task.worktreeMergedAt
        && !hasActiveMergeRuntime
    )
    const {
        state: mergeState,
        isLoading: isMergeStateLoading,
        refetch: refetchMergeState
    } = useTaskWorktreeMergeState(
        props.api,
        taskId,
        { enabled: shouldQueryMergeState }
    )
    const isMergeBusy = isMerging || isCanceling

    useEffect(() => {
        setMergeActionError(null)
        setPreviewActionError(null)
    }, [props.session.id, taskId])

    useEffect(() => {
        if (mergeRuntime?.updatedAt || task?.worktreeMergedAt) {
            setMergeActionError(null)
        }
    }, [mergeRuntime?.updatedAt, task?.worktreeMergedAt])

    useEffect(() => {
        if (previewRuntime?.updatedAt || previewState?.updatedAt) {
            setPreviewActionError(null)
        }
    }, [previewRuntime?.updatedAt, previewState?.updatedAt])

    useEffect(() => {
        if (!shouldQueryMergeState) {
            return
        }
        void refetchMergeState()
    }, [
        hasPendingRequests,
        props.session.id,
        props.session.thinking,
        refetchMergeState,
        shouldQueryMergeState,
        task?.activeSessionId,
        task?.worktreeMergedAt
    ])

    const handleMergeAction = useCallback(async () => {
        if (!taskId || isMergeBusy) {
            return
        }

        setMergeActionError(null)

        if (hasActiveMergeRuntime) {
            try {
                await cancelTaskWorktreeMerge(taskId)
            } catch (error) {
                setMergeActionError(`取消 Merge 失败：${toErrorMessage(error)}`)
            }
            return
        }

        if (!mergeState?.canMerge) {
            return
        }

        try {
            await mergeTaskWorktree({ taskId })
        } catch (error) {
            setMergeActionError(`发起 Merge 失败：${toErrorMessage(error)}`)
        }
    }, [cancelTaskWorktreeMerge, hasActiveMergeRuntime, isMergeBusy, mergeState?.canMerge, mergeTaskWorktree, taskId])

    const previewRuntimeStatus = previewRuntime?.status ?? null
    const hasReadyPreview = previewRuntimeStatus === 'ready' || previewState?.status === 'ready'
    const hasCancelablePreview = hasReadyPreview
        || isActivePreviewRuntimeStatus(previewRuntimeStatus)
        || previewState?.status === 'starting'
    const shouldShowPreviewAction = shouldShowPreviewRuntime && !sessionInactive
    const previewActionLabel = isStartingPreview
        ? (isRetryablePreviewRuntimeStatus(previewRuntimeStatus) ? 'Retrying Preview...' : 'Starting Preview...')
        : isStoppingPreview
            ? (hasReadyPreview ? 'Stopping Preview...' : 'Canceling Preview...')
            : hasReadyPreview
                ? 'Stop Preview'
                : hasCancelablePreview
                    ? 'Cancel Preview'
                    : isRetryablePreviewRuntimeStatus(previewRuntimeStatus)
                        ? 'Retry Preview'
                        : 'Preview'
    const previewActionDisabled = !shouldShowPreviewAction || isUpdatingPreview
    const previewStatusSummary = useMemo<PreviewStatusSummary | null>(() => {
        const runtimeSummary = buildPreviewStatusSummary(previewRuntime, previewState)
        if (!previewActionError) {
            return runtimeSummary
        }
        if (!runtimeSummary) {
            return {
                title: 'Preview 请求失败',
                detail: previewActionError,
                tone: 'error'
            }
        }

        return {
            ...runtimeSummary,
            tone: 'error',
            detail: [runtimeSummary.detail, previewActionError].filter(Boolean).join(' ')
        }
    }, [previewActionError, previewRuntime, previewState])
    const showPreviewLogs = Boolean(
        shouldQueryPreviewState
        && (
            (previewState?.logTail?.length ?? 0) > 0
            || (previewState?.command && (previewStatusSummary?.busy || previewStatusSummary?.tone === 'error'))
        )
    )

    const handlePreviewAction = useCallback(async () => {
        if (!taskId || previewActionDisabled) {
            return
        }

        setPreviewActionError(null)
        try {
            if (hasCancelablePreview) {
                await stopTaskPreview(taskId)
                return
            }

            await startTaskPreview({
                taskId,
                payload: { mode: 'auto' }
            })
        } catch (error) {
            setPreviewActionError(toErrorMessage(error))
        }
    }, [hasCancelablePreview, previewActionDisabled, startTaskPreview, stopTaskPreview, taskId])

    const handleMergeActionClick = useCallback(() => {
        void handleMergeAction()
    }, [handleMergeAction])

    const handlePreviewActionClick = useCallback(() => {
        void handlePreviewAction()
    }, [handlePreviewAction])

    const { abortSession, switchSession, setPermissionMode, setModelMode } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor
    )

    // Voice assistant integration
    const voice = useVoiceOptional()

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => props.onSend(message),
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    const voiceSessionRef = useRef(props.session)
    const voiceMessagesRef = useRef(props.messages)

    useEffect(() => {
        voiceSessionRef.current = props.session
    }, [props.session])

    useEffect(() => {
        voiceMessagesRef.current = props.messages
    }, [props.messages])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? voiceSessionRef.current : null),
            (sessionId) => (sessionId === props.session.id ? voiceMessagesRef.current : [])
        )
    }, [props.session.id])

    // Track and report new messages to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    // Report ready event when thinking stops
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    // Report permission requests to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
        setIgnoreRunningFallback(false)
    }, [props.session.id])

    useEffect(() => {
        if (!props.session.thinking) {
            return
        }
        setIgnoreRunningFallback(false)
    }, [props.session.thinking])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        // Only clean up cache entries that are no longer in the message list
        // This prevents unnecessary cache churn
        if (cache.size > seen.size * 2) {
            for (const id of cache.keys()) {
                if (!seen.has(id)) {
                    cache.delete(id)
                }
            }
        }
        return normalized
    }, [props.messages, props.session.id])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // Check if the last event message indicates an error/interruption
    const hasErrorInLastMessages = useMemo(() => {
        for (let i = normalizedMessages.length - 1; i >= 0; i--) {
            const msg = normalizedMessages[i]
            if (msg.role === 'event' && isInterruptedEvent(msg.content)) {
                return true
            }
            // Stop checking after we see an assistant or user message
            if (msg.role === 'user' || msg.role === 'agent') {
                break
            }
        }
        return false
    }, [normalizedMessages])


    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelModeChange = useCallback(async (mode: ModelMode) => {
        try {
            await setModelMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model mode:', e)
        }
    }, [setModelMode, props.onRefresh, haptic])

    // Abort handler
    const handleAbort = useCallback(async () => {
        setIgnoreRunningFallback(true)
        try {
            await abortSession()
            props.onRefresh()
        } catch (error) {
            setIgnoreRunningFallback(false)
            throw error
        }
    }, [abortSession, props.onRefresh])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        if (props.onViewFiles) {
            props.onViewFiles()
            return
        }
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id },
        })
    }, [navigate, props.onViewFiles, props.session.id])

    const handleViewTerminal = useCallback(() => {
        if (props.onViewTerminal) {
            props.onViewTerminal()
            return
        }
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id },
        })
    }, [navigate, props.onViewTerminal, props.session.id])

    const handleViewDiffs = useCallback(() => {
        if (props.onViewDiffs) {
            props.onViewDiffs()
            return
        }
        // Legacy sessions UI no longer used; send users to project UI instead.
        navigate({ to: '/projects' })
    }, [navigate, props.onViewDiffs])

    const handleSend = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        setIgnoreRunningFallback(false)
        props.onSend(text, attachments)
        setForceScrollToken((token) => token + 1)
    }, [props.onSend])

    const handleContinue = useCallback(() => {
        handleSend(CONTINUE_PROMPT_TEXT)
    }, [handleSend])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active])

    const effectiveIsRunning = props.session.thinking
        || (!ignoreRunningFallback && shouldTreatSessionAsRunningFallback(props.session, normalizedMessages))

    const showContinueAction = Boolean(
        taskId
        && task
        && task.status === 'in_review'
        && !task.archivedAt
        && !task.finishedAt
        && !hasPendingRequests
        && !effectiveIsRunning
    )
    const canStartMerge = Boolean(
        shouldQueryMergeState
        && !isMergeStateLoading
        && mergeState?.canMerge
        && !hasPendingRequests
    )
    const hasRecoveredBlockedMerge = shouldTreatBlockedMergeAsRecoveredSuccess(mergeRuntime, mergeState)
    const shouldShowMergeAction = !hasRecoveredBlockedMerge && shouldShowMergeActionButton({
        task,
        hasActiveMergeRuntime,
        mergeRuntimeStatus,
        canStartMerge
    })
    const mergeActionLabel = hasActiveMergeRuntime
        ? (isCanceling ? 'Stopping Merge...' : 'Cancel Merge')
        : isRetryableMergeRuntimeStatus(mergeRuntimeStatus)
            ? (isMerging ? 'Retrying Merge...' : 'Retry Merge')
            : (isMerging ? 'Starting Merge...' : 'Merge')
    const mergeActionDisabled = hasActiveMergeRuntime
        ? isMergeBusy
        : effectiveIsRunning || isMergeBusy || hasPendingRequests || !canStartMerge
    const mergeStatus = useMemo<TaskActionStatusSummary | null>(() => {
        const runtimeSummary = hasRecoveredBlockedMerge
            ? buildRecoveredBlockedMergeSummary(mergeRuntime, mergeState)
            : buildMergeRuntimeSummary(task, mergeRuntime)
        if (!mergeActionError) {
            return runtimeSummary
        }
        if (!runtimeSummary) {
            return {
                title: 'Merge 请求失败',
                detail: mergeActionError,
                tone: 'error'
            }
        }

        return {
            ...runtimeSummary,
            tone: 'error',
            detail: [runtimeSummary.detail, mergeActionError].filter(Boolean).join(' ')
        }
    }, [hasRecoveredBlockedMerge, mergeActionError, mergeRuntime, mergeState, task])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter,
        allowSendWhenInactive: true,
        isRunning: effectiveIsRunning
    })

    const { subscriptionId: sessionSubscriptionId } = useSSE({
        enabled: Boolean(token && baseUrl && props.session.id),
        token,
        baseUrl,
        subscription: {
            all: false,
            sessionId: props.session.id,
            projectId: taskProjectId ?? undefined,
            include: taskProjectId ? ['messages', 'sessions', 'tasks'] : ['messages', 'sessions']
        },
        onConnect: undefined,
        onDisconnect: undefined,
        onEvent: () => {}
    })

    useVisibilityReporter({
        api: props.api,
        subscriptionId: sessionSubscriptionId,
        enabled: Boolean(token && baseUrl)
    })

    return (
        <div className={props.rootClassName ?? 'flex h-full flex-col'}>
            {props.hideHeader ? (
                props.headerExtra ? (
                    <div className="px-3 pt-3">
                        {props.headerExtra}
                    </div>
                ) : null
            ) : (
                <SessionHeader
                    session={props.session}
                    onBack={props.onBack}
                    onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                    onViewDiffs={props.onViewDiffs ? handleViewDiffs : undefined}
                    onSessionDeleted={props.onBack}
                    extra={props.headerExtra}
                />
            )}

            {sessionInactive && !props.hideInactiveNotice ? (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Sending will resume it automatically.
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className={props.surfaceClassName ?? SESSION_CHAT_SURFACE_CLASS_NAME}>
                    <HappyThread
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={props.onAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                        showContinueAction={showContinueAction}
                        continueActionDisabled={props.isSending || effectiveIsRunning || hasPendingRequests}
                        onContinueAction={handleContinue}
                        initStatus={initStatusSummary}
                        showMergeAction={shouldShowMergeAction}
                        mergeActionDisabled={mergeActionDisabled}
                        mergeActionLabel={mergeActionLabel}
                        onMergeAction={handleMergeActionClick}
                        mergeStatus={mergeStatus}
                        showPreviewAction={shouldShowPreviewAction}
                        previewActionDisabled={previewActionDisabled}
                        previewActionLabel={previewActionLabel}
                        onPreviewAction={handlePreviewActionClick}
                        previewStatus={previewStatusSummary}
                        showPreviewLogs={showPreviewLogs}
                        previewLogTail={previewState?.logTail ?? []}
                        previewCommand={previewState?.command ?? null}
                        contentClassName={props.threadContentClassName}
                    />

                    <HappyComposer
                        draftScope={composerDraftScope}
                        disabled={props.isSending}
                        permissionMode={props.session.permissionMode}
                        modelMode={props.session.modelMode}
                        agentFlavor={agentFlavor}
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={effectiveIsRunning}
                        agentState={props.session.agentState}
                        contextSize={reduced.latestUsage?.contextSize}
                        controlledByUser={props.session.agentState?.controlledByUser === true}
                        onPermissionModeChange={handlePermissionModeChange}
                        onModelModeChange={handleModelModeChange}
                        onSwitchToRemote={handleSwitchToRemote}
                        onTerminal={props.showTerminalControl === false ? undefined : props.session.active ? handleViewTerminal : undefined}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                        outerClassName={props.composerOuterClassName}
                        contentClassName={props.composerContentClassName}
                        statusBarVisible={props.composerStatusBarVisible}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
