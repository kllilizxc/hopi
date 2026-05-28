import { memo, type ReactNode, useCallback } from 'react'
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

export const TaskSessionChat = memo(function TaskSessionChat(props: {
    api: ApiClient | null
    projectId: string
    taskId: string
    sessionId: string
    onBack: () => void
    onViewFiles?: () => void
    onViewDiffs?: () => void
    onViewTerminal?: () => void
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
        resolveSessionId: async (currentSessionId) => {
            if (!props.api || !session || session.active) {
                return currentSessionId
            }
            let resumedSessionId = currentSessionId
            try {
                resumedSessionId = await props.api.resumeSession(currentSessionId)
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

            if (resumedSessionId !== currentSessionId) {
                try {
                    const linked = await props.api.attachTaskSession(props.taskId, resumedSessionId)
                    queryClient.setQueryData(queryKeys.task(linked.task.id), linked)
                    void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(props.projectId) })
                } catch {
                }
            }

            return resumedSessionId
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (props.api) {
                    if (session && resolvedSessionId !== session.id) {
                        seedMessageWindowFromSession(session.id, resolvedSessionId)
                        queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                            session: { ...session, id: resolvedSessionId, active: true }
                        })
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

    if (!session) {
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
            api={props.api!}
            session={session}
            messages={messages}
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
            onViewFiles={props.onViewFiles}
            onViewDiffs={props.onViewDiffs}
            onViewTerminal={props.onViewTerminal}
            headerExtra={props.headerExtra}
        />
    )
})
