import { memo, type ReactNode, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { SessionChat } from '@/components/SessionChat'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'

function isProjectAssistantIntroMessage(message: { localId?: string | null }): boolean {
    return message.localId === 'auto:assistant:normal:intro'
        || message.localId?.startsWith('auto:assistant:kickoff:') === true
        || message.localId?.startsWith('auto:assistant:activation:') === true
}

function hasAgentResumeMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
    if (!metadata) return false
    return typeof metadata.claudeSessionId === 'string'
        || typeof metadata.codexSessionId === 'string'
        || typeof metadata.geminiSessionId === 'string'
        || typeof metadata.opencodeSessionId === 'string'
        || metadata.startedFromRunner === true
        || (typeof metadata.host === 'string' && metadata.host !== 'hopi')
}

export const ProjectAssistantSessionChat = memo(function ProjectAssistantSessionChat(props: {
    api: ApiClient | null
    projectId: string
    sessionId: string
    onBack: () => void
    onSessionResolved?: (sessionId: string) => void
    headerExtra?: ReactNode
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { addToast } = useToast()

    const {
        session,
        refetch: refetchSession
    } = useSession(props.api, props.sessionId)

    const {
        messages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(props.api, props.sessionId)

    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(props.api, props.sessionId, {
        resolveSessionId: async (currentSessionId, message) => {
            if (!props.api || !session || session.active) {
                return currentSessionId
            }
            if (session.metadata?.hopiAssistant === true && !hasAgentResumeMetadata(session.metadata)) {
                const response = await props.api.activateProjectAssistantSession(props.projectId, currentSessionId, {
                    text: message.text,
                    localId: message.localId,
                    attachments: message.attachments,
                })
                return { sessionId: response.session.id, notify: true, handled: true }
            }
            try {
                return { sessionId: await props.api.resumeSession(currentSessionId), notify: true }
            } catch (error) {
                const resumeFailedMessage = t('projects.sessions.resumeFailed')
                const message = error instanceof Error ? error.message : resumeFailedMessage
                addToast({
                    title: resumeFailedMessage,
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            props.onSessionResolved?.(resolvedSessionId)
            void (async () => {
                if (!props.api) return
                if (session && resolvedSessionId !== session.id) {
                    seedMessageWindowFromSession(session.id, resolvedSessionId)
                    queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                        session: { ...session, id: resolvedSessionId, active: true }
                    })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssistantRoot(props.projectId) })
                }
                try {
                    await Promise.all([
                        queryClient.prefetchQuery({
                            queryKey: queryKeys.session(resolvedSessionId),
                            queryFn: () => props.api!.getSession(resolvedSessionId),
                        }),
                        fetchLatestMessages(props.api, resolvedSessionId),
                    ])
                } catch {
                }
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: props.sessionId,
                    url: ''
                })
            }
        }
    })

    const agentType = session?.metadata?.flavor ?? 'claude'
    const { getSuggestions: getSlashSuggestions } = useSlashCommands(props.api, props.sessionId, agentType)
    const { getSuggestions: getSkillSuggestions } = useSkills(props.api, props.sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return getSkillSuggestions(query)
        }
        return getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refreshSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    const visibleMessages = useMemo(
        () => messages.filter((message) => !isProjectAssistantIntroMessage(message)),
        [messages]
    )

    if (!session || !props.api) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-sm text-[var(--app-hint)]">
                    {t('loading.session')}
                </div>
            </div>
        )
    }

    return (
        <SessionChat
            api={props.api}
            session={session}
            messages={visibleMessages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={props.onBack}
            onRefresh={refreshSession}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            headerExtra={props.headerExtra}
            hideHeader
            hideInactiveNotice
            rootClassName="flex h-full min-h-0 flex-col"
            surfaceClassName="relative z-10 flex min-h-0 flex-1 flex-col bg-transparent"
            threadContentClassName="mx-auto w-full max-w-4xl min-w-0 px-4 pb-4 pt-6 sm:px-6 lg:px-8 xl:px-10"
            composerOuterClassName="bg-transparent px-4 pb-4 pt-2 sm:px-6 lg:px-8 xl:px-10"
            composerContentClassName="mx-auto w-full max-w-4xl"
            composerStatusBarVisible={false}
            showTerminalControl={false}
        />
    )
})
