import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata, DecryptedMessage, ModelMode, PermissionMode, Session } from '@/types/api'
import type { AgentEvent, ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { useTask } from '@/hooks/queries/useTask'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { SessionHeader } from '@/components/SessionHeader'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'

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

type MergeThreadEvent = {
    id: string
    text: string
    tone?: 'info' | 'success' | 'error'
}

function formatMergeSkippedReason(reason: string): string {
    if (reason === 'already_merged') {
        return '已经合并过了'
    }
    if (reason === 'no_changes') {
        return '没有可合并的变更'
    }
    return reason
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }
    return String(error)
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function waitForTaskMerged(api: ApiClient, taskId: string): Promise<boolean> {
    const maxChecks = 6
    const checkDelayMs = 2_000

    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        try {
            const latest = await api.getTask(taskId)
            if (latest.task.worktreeMergedAt) {
                return true
            }
        } catch {
        }

        if (attempt < maxChecks - 1) {
            await wait(checkDelayMs)
        }
    }

    return false
}

function getReadyEvent(event: AgentEvent): { forLocalKey: string | null; hasAssistantReply: boolean | null } | null {
    if (event.type !== 'ready') {
        return null
    }
    return {
        forLocalKey: typeof event.forLocalKey === 'string' ? event.forLocalKey : null,
        hasAssistantReply: typeof event.hasAssistantReply === 'boolean' ? event.hasAssistantReply : null
    }
}

function isInterruptedEvent(event: AgentEvent): boolean {
    if (event.type === 'api-error') {
        const retryAttempt = typeof event.retryAttempt === 'number' ? event.retryAttempt : null
        const maxRetries = typeof event.maxRetries === 'number' ? event.maxRetries : null
        return retryAttempt !== null && maxRetries !== null && maxRetries > 0 && retryAttempt >= maxRetries
    }

    if (event.type !== 'message' || typeof event.message !== 'string') {
        return false
    }

    const message = event.message.toLowerCase()
    return message.includes('aborted by user')
        || message.includes('process exited unexpectedly')
        || message.includes('prompt failed')
        || message.includes('task failed')
}

function shouldShowContinueAction(session: Session, normalized: NormalizedMessage[]): boolean {
    let latestPrompt: NormalizedMessage | null = null

    for (const msg of normalized) {
        if (msg.role !== 'user') {
            continue
        }
        if (getMessageSentFrom(msg.meta) === 'cli') {
            continue
        }
        latestPrompt = msg
    }

    if (!latestPrompt) {
        return false
    }

    let readyForPrompt: { forLocalKey: string | null; hasAssistantReply: boolean | null } | null = null
    let fallbackReady: { forLocalKey: string | null; hasAssistantReply: boolean | null } | null = null
    let hasFailureSignal = false

    for (const msg of normalized) {
        if (msg.createdAt < latestPrompt.createdAt || msg.role !== 'event') {
            continue
        }

        const ready = getReadyEvent(msg.content)
        if (ready) {
            if (latestPrompt.localId && ready.forLocalKey === latestPrompt.localId) {
                readyForPrompt = ready
            } else if (!latestPrompt.localId && !ready.forLocalKey) {
                fallbackReady = ready
            }
            continue
        }

        if (isInterruptedEvent(msg.content)) {
            hasFailureSignal = true
        }
    }

    const resolvedReady = readyForPrompt ?? fallbackReady
    if (resolvedReady) {
        return resolvedReady.hasAssistantReply === false
    }

    if (session.thinking) {
        return false
    }

    return hasFailureSignal
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
}) {
    const { haptic } = usePlatform()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const sessionInactive = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [ignoreRunningFallback, setIgnoreRunningFallback] = useState(false)
    const [isMergeFinalizing, setIsMergeFinalizing] = useState(false)
    const [mergeEvents, setMergeEvents] = useState<MergeThreadEvent[]>([])
    const mergeEventSeqRef = useRef(0)
    const agentFlavor = props.session.metadata?.flavor ?? null

    const taskRouteMatch = matchRoute({ to: '/projects/$projectId/tasks/$taskId', fuzzy: true })
    const taskParamsFromRoute = taskRouteMatch
        ? { projectId: taskRouteMatch.projectId, taskId: taskRouteMatch.taskId }
        : null
    const taskParamsFromMetadata = props.session.metadata?.projectId && props.session.metadata?.taskId
        ? { projectId: props.session.metadata.projectId, taskId: props.session.metadata.taskId }
        : null
    const taskLink = taskParamsFromRoute ?? taskParamsFromMetadata
    const taskId = taskLink?.taskId ?? null
    const { task } = useTask(props.api, taskId)
    const { mergeTaskWorktree, isPending: isMergePending } = useMergeTaskWorktree(props.api)
    const isTaskMerged = Boolean(task?.worktreeMergedAt)
    const shouldShowMergeAction = Boolean(taskId && task?.status === 'in_review' && !isTaskMerged)
    const isMergeBusy = isMergePending || isMergeFinalizing

    const appendMergeEvent = useCallback((text: string, tone: MergeThreadEvent['tone'] = 'info') => {
        mergeEventSeqRef.current += 1
        setMergeEvents((prev) => [...prev, { id: `merge-event-${mergeEventSeqRef.current}`, text, tone }])
    }, [])

    useEffect(() => {
        mergeEventSeqRef.current = 0
        setMergeEvents([])
    }, [props.session.id, taskId])

    const handleMergeAction = useCallback(async () => {
        if (!taskId || isMergeBusy) {
            return
        }

        appendMergeEvent('正在 Merge 到目标分支...', 'info')

        try {
            const res = await mergeTaskWorktree({ taskId })
            if (res.skippedReason) {
                appendMergeEvent(`Merge 跳过：${formatMergeSkippedReason(res.skippedReason)}`, 'info')
                return
            }

            const commitSuffix = res.commitHash ? ` (${res.commitHash})` : ''
            if (res.autoResolved) {
                appendMergeEvent(`Merge 成功（已自动解决冲突）${commitSuffix}`, 'success')
                return
            }

            appendMergeEvent(`Merge 成功${commitSuffix}`, 'success')
        } catch (error) {
            setIsMergeFinalizing(true)
            let mergedAfterFailure = false
            try {
                mergedAfterFailure = await waitForTaskMerged(props.api, taskId)
            } finally {
                setIsMergeFinalizing(false)
            }

            if (mergedAfterFailure) {
                appendMergeEvent('Merge 成功（接口报错，但任务状态已更新）', 'success')
                return
            }

            appendMergeEvent(`Merge 失败：${toErrorMessage(error)}`, 'error')
        }
    }, [appendMergeEvent, isMergeBusy, mergeTaskWorktree, props.api, taskId])

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

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

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
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages])

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
    const showContinueAction = useMemo(
        () => shouldShowContinueAction(props.session, normalizedMessages),
        [props.session, normalizedMessages]
    )

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

    return (
        <div className="flex h-full flex-col">
            <SessionHeader
                session={props.session}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                onViewDiffs={props.onViewDiffs ? handleViewDiffs : undefined}
                onSessionDeleted={props.onBack}
            />

            {sessionInactive ? (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Sending will resume it automatically.
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
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
                        continueActionDisabled={props.isSending || effectiveIsRunning}
                        onContinueAction={handleContinue}
                        showMergeAction={shouldShowMergeAction}
                        mergeActionDisabled={effectiveIsRunning || isMergeBusy}
                        mergeActionLabel={isMergeBusy ? 'Merging...' : 'Merge'}
                        onMergeAction={() => {
                            void handleMergeAction()
                        }}
                        mergeEvents={mergeEvents}
                    />

                    <HappyComposer
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
                        onTerminal={props.session.active ? handleViewTerminal : undefined}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
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
