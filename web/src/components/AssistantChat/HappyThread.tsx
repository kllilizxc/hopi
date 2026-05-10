import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { CommandLiveOutput } from '@/components/CommandLiveOutput'
import { ScrollShadow } from '@/components/ui/scroll-shadow'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import type { TaskActionPreviewStatusSummary as PreviewStatusSummary, TaskActionStatusSummary as InitStatusSummary } from '@/lib/task-action-runtime'
import { useTranslation } from '@/lib/use-translation'

function NewMessagesIndicator(props: { count: number; onClick: () => void }) {
    const { t } = useTranslation()
    if (props.count === 0) {
        return null
    }

    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-sm font-medium shadow-lg animate-bounce-in z-10"
        >
            {t('misc.newMessage', { n: props.count })} &#8595;
        </button>
    )
}

export const MESSAGE_STREAM_CLASS_NAME = 'flex flex-col gap-4 sm:gap-5'

function MessageSkeleton() {
    const { t } = useTranslation()
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('misc.loadingMessages')}</span>
            <div className="space-y-4 sm:space-y-5 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

type MergeStatusSummary = InitStatusSummary

export type { InitStatusSummary, PreviewStatusSummary }

function StatusCard(props: {
    summary: InitStatusSummary | PreviewStatusSummary
}) {
    const url = 'url' in props.summary ? props.summary.url : null
    const tone = props.summary.tone

    return (
        <div className="py-1">
            <div
                className={`mx-auto max-w-[92%] rounded-md px-3 py-2 text-xs ${
                    tone === 'success'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : tone === 'error'
                            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                            : 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
                }`}
            >
                <div className="flex items-center justify-center gap-2 text-center font-medium">
                    {props.summary.busy ? (
                        <Spinner size="sm" label={null} className="text-current" />
                    ) : null}
                    <span>{props.summary.title}</span>
                </div>
                {props.summary.detail ? (
                    <div className="mt-1 text-center opacity-80">
                        {props.summary.detail}
                    </div>
                ) : null}
                {url ? (
                    <div className="mt-2 text-center">
                        <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all underline underline-offset-2"
                        >
                            {url}
                        </a>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export function HappyThread(props: {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    pendingCount: number
    rawMessagesCount: number
    normalizedMessagesCount: number
    messagesVersion: number
    forceScrollToken: number
    showContinueAction?: boolean
    continueActionDisabled?: boolean
    onContinueAction?: () => void
    initStatus?: InitStatusSummary | null
    showMergeAction?: boolean
    mergeActionDisabled?: boolean
    mergeActionLabel?: string
    onMergeAction?: () => void
    mergeStatus?: MergeStatusSummary | null
    showPreviewAction?: boolean
    previewActionDisabled?: boolean
    previewActionLabel?: string
    onPreviewAction?: () => void
    previewStatus?: PreviewStatusSummary | null
    showPreviewLogs?: boolean
    previewLogTail?: string[]
    previewCommand?: string | null
}) {
    const { t } = useTranslation()
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const topSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const pendingScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
    const prevLoadingMoreRef = useRef(false)
    const loadStartedRef = useRef(false)
    const isLoadingMoreRef = useRef(props.isLoadingMoreMessages)
    const hasMoreMessagesRef = useRef(props.hasMoreMessages)
    const isLoadingMessagesRef = useRef(props.isLoadingMessages)
    const onLoadMoreRef = useRef(props.onLoadMore)
    const handleLoadMoreRef = useRef<() => void>(() => {})
    const atBottomRef = useRef(true)
    const onAtBottomChangeRef = useRef(props.onAtBottomChange)
    const onFlushPendingRef = useRef(props.onFlushPending)
    const forceScrollTokenRef = useRef(props.forceScrollToken)
    const onRefreshRef = useRef(props.onRefresh)
    const onRetryMessageRef = useRef(props.onRetryMessage)

    // Smart scroll state: autoScroll enabled when user is near bottom
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const autoScrollEnabledRef = useRef(autoScrollEnabled)
    const userIsScrollingRef = useRef(false)
    const scrollTimeoutRef = useRef<number | null>(null)
    const setAutoScroll = useCallback((enabled: boolean) => {
        autoScrollEnabledRef.current = enabled
        setAutoScrollEnabled(enabled)
    }, [])

    // Keep refs in sync with state
    useEffect(() => {
        autoScrollEnabledRef.current = autoScrollEnabled
    }, [autoScrollEnabled])
    useEffect(() => {
        onAtBottomChangeRef.current = props.onAtBottomChange
    }, [props.onAtBottomChange])
    useEffect(() => {
        onRefreshRef.current = props.onRefresh
    }, [props.onRefresh])
    useEffect(() => {
        onRetryMessageRef.current = props.onRetryMessage
    }, [props.onRetryMessage])
    useEffect(() => {
        onFlushPendingRef.current = props.onFlushPending
    }, [props.onFlushPending])
    useEffect(() => {
        hasMoreMessagesRef.current = props.hasMoreMessages
    }, [props.hasMoreMessages])
    useEffect(() => {
        isLoadingMessagesRef.current = props.isLoadingMessages
    }, [props.isLoadingMessages])
    useEffect(() => {
        onLoadMoreRef.current = props.onLoadMore
    }, [props.onLoadMore])

    // Track scroll position to toggle autoScroll (stable listener using refs)
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const THRESHOLD_PX = 120
        let rafId: number | null = null
        const isNearBottom = () => (
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < THRESHOLD_PX
        )

        const handleScroll = () => {
            if (rafId !== null) return

            // Mark that user is actively scrolling
            userIsScrollingRef.current = true
            if (scrollTimeoutRef.current !== null) {
                clearTimeout(scrollTimeoutRef.current)
            }
            scrollTimeoutRef.current = window.setTimeout(() => {
                userIsScrollingRef.current = false
                scrollTimeoutRef.current = null

                if (isNearBottom() && !autoScrollEnabledRef.current) {
                    setAutoScroll(true)
                }
            }, 150)

            rafId = requestAnimationFrame(() => {
                rafId = null
                const nearBottom = isNearBottom()

                // Only enable auto-scroll if user scrolled to near bottom
                // Disable auto-scroll immediately if user scrolls away
                // Don't re-enable auto-scroll while user is actively scrolling
                if (nearBottom) {
                    if (!autoScrollEnabledRef.current && !userIsScrollingRef.current) {
                        setAutoScroll(true)
                    }
                } else if (autoScrollEnabledRef.current) {
                    setAutoScroll(false)
                }

                if (nearBottom !== atBottomRef.current) {
                    atBottomRef.current = nearBottom
                    onAtBottomChangeRef.current(nearBottom)
                    if (nearBottom) {
                        onFlushPendingRef.current()
                    }
                }
            })
        }

        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            viewport.removeEventListener('scroll', handleScroll)
            if (rafId !== null) {
                cancelAnimationFrame(rafId)
            }
            if (scrollTimeoutRef.current !== null) {
                clearTimeout(scrollTimeoutRef.current)
            }
        }
    }, []) // Stable: no dependencies, reads from refs

    // Scroll to bottom handler for the indicator button
    const scrollToBottom = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
        }
        setAutoScroll(true)
        if (!atBottomRef.current) {
            atBottomRef.current = true
            onAtBottomChangeRef.current(true)
        }
        onFlushPendingRef.current()
    }, [setAutoScroll])

    // Reset state when session changes
    useEffect(() => {
        setAutoScroll(true)
        atBottomRef.current = true
        onAtBottomChangeRef.current(true)
        forceScrollTokenRef.current = props.forceScrollToken
    }, [props.sessionId, setAutoScroll])

    useEffect(() => {
        if (forceScrollTokenRef.current === props.forceScrollToken) {
            return
        }
        forceScrollTokenRef.current = props.forceScrollToken
        scrollToBottom()
    }, [props.forceScrollToken, scrollToBottom])

    const handleLoadMore = useCallback(() => {
        if (isLoadingMessagesRef.current || !hasMoreMessagesRef.current || isLoadingMoreRef.current || loadLockRef.current) {
            return
        }
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        pendingScrollRef.current = {
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight
        }
        loadLockRef.current = true
        loadStartedRef.current = false
        let loadPromise: Promise<unknown>
        try {
            loadPromise = onLoadMoreRef.current()
        } catch (error) {
            pendingScrollRef.current = null
            loadLockRef.current = false
            throw error
        }
        void loadPromise.catch((error) => {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
        }).finally(() => {
            if (!loadStartedRef.current && !isLoadingMoreRef.current && pendingScrollRef.current) {
                pendingScrollRef.current = null
                loadLockRef.current = false
            }
        })
    }, [])

    useEffect(() => {
        handleLoadMoreRef.current = handleLoadMore
    }, [handleLoadMore])

    useEffect(() => {
        const sentinel = topSentinelRef.current
        const viewport = viewportRef.current
        if (!sentinel || !viewport || !props.hasMoreMessages || props.isLoadingMessages) {
            return
        }
        if (typeof IntersectionObserver === 'undefined') {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        handleLoadMoreRef.current()
                    }
                }
            },
            {
                root: viewport,
                rootMargin: '200px 0px 0px 0px'
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [props.hasMoreMessages, props.isLoadingMessages])

    useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }

        const pending = pendingScrollRef.current
        if (!pending) {
            if (autoScrollEnabledRef.current) {
                viewport.scrollTop = viewport.scrollHeight
            }
            return
        }

        const delta = viewport.scrollHeight - pending.scrollHeight
        viewport.scrollTop = pending.scrollTop + delta
        pendingScrollRef.current = null
        loadLockRef.current = false
    }, [props.messagesVersion])

    useEffect(() => {
        isLoadingMoreRef.current = props.isLoadingMoreMessages
        if (props.isLoadingMoreMessages) {
            loadStartedRef.current = true
        }
        if (prevLoadingMoreRef.current && !props.isLoadingMoreMessages && pendingScrollRef.current) {
            pendingScrollRef.current = null
            loadLockRef.current = false
        }
        prevLoadingMoreRef.current = props.isLoadingMoreMessages
    }, [props.isLoadingMoreMessages])

    const showSkeleton = props.isLoadingMessages && props.rawMessagesCount === 0 && props.pendingCount === 0
    const previewLogTail = props.previewLogTail ?? []
    const previewLogsText = useMemo(() => previewLogTail.join('\n'), [previewLogTail])
    const showContinueAction = Boolean(props.showContinueAction && props.onContinueAction)
    const showMergeAction = Boolean(props.showMergeAction && props.onMergeAction)
    const showPreviewAction = Boolean(props.showPreviewAction && props.onPreviewAction)
    const showActionRow = showContinueAction || showMergeAction || showPreviewAction
    const hasRetryMessage = Boolean(props.onRetryMessage)
    const handleRefresh = useCallback(() => {
        onRefreshRef.current()
    }, [])
    const handleRetryMessage = useCallback((localId: string) => {
        onRetryMessageRef.current?.(localId)
    }, [])
    const chatContextValue = useMemo(() => ({
        api: props.api,
        sessionId: props.sessionId,
        metadata: props.metadata,
        disabled: props.disabled,
        onRefresh: handleRefresh,
        onRetryMessage: hasRetryMessage ? handleRetryMessage : undefined
    }), [
        props.api,
        props.sessionId,
        props.metadata,
        props.disabled,
        handleRefresh,
        hasRetryMessage,
        handleRetryMessage
    ])

    return (
        <HappyChatProvider value={chatContextValue}>
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col relative">
                <ThreadPrimitive.Viewport asChild autoScroll={autoScrollEnabled}>
                    <ScrollShadow
                        ref={viewportRef}
                        className="min-h-0 flex-1"
                        viewportClassName="h-full overflow-y-auto overflow-x-hidden"
                        viewportStyle={{ WebkitOverflowScrolling: 'touch' }}
                    >
                        <div className="mx-auto w-full max-w-content min-w-0 p-3">
                            <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />
                            {showSkeleton ? (
                                <MessageSkeleton />
                            ) : (
                                <>
                                    {props.messagesWarning ? (
                                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                            {props.messagesWarning}
                                        </div>
                                    ) : null}

                                    {props.hasMoreMessages && !props.isLoadingMessages ? (
                                        <div className="py-1 mb-2">
                                            <div className="mx-auto w-fit">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleLoadMore}
                                                    disabled={props.isLoadingMoreMessages || props.isLoadingMessages}
                                                    aria-busy={props.isLoadingMoreMessages}
                                                    className="gap-1.5 text-xs opacity-80 hover:opacity-100"
                                                >
                                                    {props.isLoadingMoreMessages ? (
                                                        <>
                                                            <Spinner size="sm" label={null} className="text-current" />
                                                            {t('misc.loading')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span aria-hidden="true">↑</span>
                                                            {t('misc.loadOlder')}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    {import.meta.env.DEV && props.normalizedMessagesCount === 0 && props.rawMessagesCount > 0 ? (
                                        <div className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs">
                                            Message normalization returned 0 items for {props.rawMessagesCount} messages (see `web/src/chat/normalize.ts`).
                                        </div>
                                    ) : null}
                                </>
                            )}
                            <div className={MESSAGE_STREAM_CLASS_NAME}>
                                <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
                            </div>
                            {showActionRow ? (
                                <div className="py-2">
                                    <div className="mx-auto flex w-fit max-w-[92%] items-center gap-2">
                                        {showContinueAction ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={props.onContinueAction}
                                                disabled={props.continueActionDisabled}
                                            >
                                                {t('misc.continue')}
                                            </Button>
                                        ) : null}
                                        {showMergeAction ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={props.onMergeAction}
                                                disabled={props.mergeActionDisabled}
                                            >
                                                {props.mergeActionLabel ?? 'Merge'}
                                            </Button>
                                        ) : null}
                                        {showPreviewAction ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={props.onPreviewAction}
                                                disabled={props.previewActionDisabled}
                                            >
                                                {props.previewActionLabel ?? 'Preview'}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            {props.initStatus ? (
                                <StatusCard summary={props.initStatus} />
                            ) : null}
                            {props.mergeStatus ? (
                                <StatusCard summary={props.mergeStatus} />
                            ) : null}
                            {props.previewStatus ? (
                                <StatusCard summary={props.previewStatus} />
                            ) : null}
                            {props.showPreviewLogs && (previewLogsText.length > 0 || props.previewCommand) ? (
                                <div className="py-2">
                                    <div className="mx-auto w-full max-w-[92%] rounded-md bg-[var(--app-secondary-bg)] p-2">
                                        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-[var(--app-hint)]">
                                            <span>{t('projects.task.preview.logs')}</span>
                                            {props.previewCommand ? (
                                                <span className="max-w-[65%] truncate font-mono" title={props.previewCommand}>
                                                    {props.previewCommand}
                                                </span>
                                            ) : null}
                                        </div>
                                        <CommandLiveOutput
                                            text={previewLogsText}
                                            emptyText={t('misc.loading')}
                                            maxHeightClassName="max-h-52"
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </ScrollShadow>
                </ThreadPrimitive.Viewport>
                <NewMessagesIndicator count={props.pendingCount} onClick={scrollToBottom} />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
