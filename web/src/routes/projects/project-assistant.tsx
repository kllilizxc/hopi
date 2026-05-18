import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { SessionChat } from '@/components/SessionChat'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useGoals } from '@/hooks/queries/useGoals'
import { useSelectedProjectGoal } from '@/routes/projects/selected-goal-storage'

export function ProjectAssistantPanel(props: {
    projectId: string
    goalId: string | null
    onBack?: () => void
    showBack?: boolean
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const assistantGoalId = props.goalId

    const assistantQuery = useQuery({
        queryKey: assistantGoalId
            ? queryKeys.projectAssistant(props.projectId, assistantGoalId)
            : ['project-controller', props.projectId, 'none'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            if (!assistantGoalId) throw new Error(t('projects.goals.empty'))
            return await api.ensureProjectControllerSession(props.projectId, { goalId: assistantGoalId })
        },
        enabled: Boolean(api && props.projectId && assistantGoalId),
        staleTime: 30_000,
        retry: false
    })

    const sessionId = assistantQuery.data?.sessionId ?? null
    const { session, refetch: refetchSession } = useSession(api, sessionId)
    const effectiveSession = session ?? assistantQuery.data?.session ?? null
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
    } = useMessages(api, sessionId)

    useEffect(() => {
        if (!assistantQuery.data?.session) return
        queryClient.setQueryData(queryKeys.session(assistantQuery.data.session.id), {
            session: assistantQuery.data.session
        })
    }, [assistantQuery.data?.session, queryClient])

    const {
        sendMessage,
        retryMessage,
        isSending
    } = useSendMessage(api, sessionId, {
        resolveSessionId: async (currentSessionId) => {
            if (!api || (effectiveSession && effectiveSession.active)) {
                return currentSessionId
            }
            if (!assistantGoalId) {
                throw new Error(t('projects.goals.empty'))
            }
            const ensured = await api.ensureProjectControllerSession(props.projectId, { goalId: assistantGoalId })
            if (!ensured.sessionId) {
                throw new Error(t('projects.controller.unavailable'))
            }
            if (ensured.sessionId !== currentSessionId) {
                seedMessageWindowFromSession(currentSessionId, ensured.sessionId)
                if (ensured.session) {
                    queryClient.setQueryData(queryKeys.session(ensured.sessionId), { session: ensured.session })
                }
                void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssistant(props.projectId, assistantGoalId) })
            }
            return ensured.sessionId
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (!api) return
                try {
                    await Promise.all([
                        queryClient.prefetchQuery({
                            queryKey: queryKeys.session(resolvedSessionId),
                            queryFn: () => api.getSession(resolvedSessionId),
                        }),
                        fetchLatestMessages(api, resolvedSessionId)
                    ])
                } catch {
                }
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api' || reason === 'no-session') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
        }
    })

    const agentType = effectiveSession?.metadata?.flavor ?? 'codex'
    const { getSuggestions: getSlashSuggestions } = useSlashCommands(api, sessionId, agentType)
    const { getSuggestions: getSkillSuggestions } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return getSkillSuggestions(query)
        }
        return getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refresh = useCallback(() => {
        void assistantQuery.refetch()
        void refetchSession()
        void refetchMessages()
    }, [assistantQuery, refetchMessages, refetchSession])

    const noopBack = useCallback(() => {}, [])
    const handleBack = props.onBack ?? noopBack

    const errorMessage = useMemo(() => {
        if (assistantQuery.error instanceof Error) return assistantQuery.error.message
        return assistantQuery.error ? t('projects.controller.openFailed') : null
    }, [assistantQuery.error, t])

    if (errorMessage) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <div className="max-w-sm rounded-md bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-text)]">
                    <div className="font-medium">{t('projects.controller.openFailed')}</div>
                    <div className="mt-2 text-[var(--app-hint)]">{errorMessage}</div>
                </div>
            </div>
        )
    }

    if (!api) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoadingState label={t('projects.controller.opening')} className="text-sm" />
            </div>
        )
    }

    if (!assistantGoalId) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <div className="max-w-sm rounded-md bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-text)]">
                    {t('projects.goals.empty')}
                </div>
            </div>
        )
    }

    if (!effectiveSession) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoadingState label={t('projects.controller.opening')} className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={effectiveSession}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending || assistantQuery.isFetching}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={handleBack}
            showHeader={false}
            showBack={props.showBack ?? Boolean(props.onBack)}
            onRefresh={refresh}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
        />
    )
}

export function ProjectAssistantPage() {
    const { projectId } = useParams({ from: '/projects/$projectId/assistant' })
    const search = useSearch({ from: '/projects/$projectId/assistant' })
    const { api } = useAppContext()
    const navigate = useNavigate()
    const { t } = useTranslation()
    const { goals, isLoading: isGoalsLoading } = useGoals(api, projectId)
    const { selectedGoalId } = useSelectedProjectGoal(projectId, goals)
    const searchGoalId = search.goalId && goals.some((goal) => goal.id === search.goalId) ? search.goalId : null
    const assistantGoalId = searchGoalId ?? selectedGoalId

    const handleBack = useCallback(() => {
        void navigate({ to: '/projects/$projectId', params: { projectId } })
    }, [navigate, projectId])

    if (isGoalsLoading) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoadingState label={t('projects.controller.opening')} className="text-sm" />
            </div>
        )
    }

    return (
        <ProjectAssistantPanel
            projectId={projectId}
            goalId={assistantGoalId}
            onBack={handleBack}
            showBack
        />
    )
}
