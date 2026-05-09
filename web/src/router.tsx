import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionList } from '@/components/SessionList'
import { NewSession } from '@/components/NewSession'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { IconButton } from '@/components/ui/icon-button'
import { BackIcon, PlusIcon, SettingsIcon } from '@/assets/icons'
import ProjectsPage, {
    ProjectOverviewPage,
    ProjectSettingsPage,
    ProjectsIndexPage,
    TaskWorkbenchRoute,
} from '@/routes/projects'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsPage from '@/routes/settings'

function SessionsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { sessions, isLoading, error, refetch } = useSessions(api)

    const handleRefresh = useCallback(() => {
        void refetch()
    }, [refetch])

    const projectCount = new Set(sessions.map(s => s.metadata?.worktree?.basePath ?? s.metadata?.path ?? 'Other')).size
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'

    return (
        <div className="relative flex h-full min-h-0 overflow-hidden">
            <div
                className={`absolute inset-0 z-10 min-w-0 w-full flex flex-col bg-[var(--app-bg)] transition-transform duration-200 ease-out lg:static lg:z-auto lg:flex-1 lg:w-auto lg:translate-x-0 lg:border-r lg:border-[var(--app-divider)] lg:pointer-events-auto ${
                    isSessionsIndex
                        ? 'translate-x-0'
                        : '-translate-x-full pointer-events-none'
                }`}
            >
                <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                    <div className="mx-auto w-full max-w-content flex items-center justify-between px-3 py-2">
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('sessions.count', { n: sessions.length, m: projectCount })}
                        </div>
                        <div className="flex items-center gap-2">
                            <IconButton
                                type="button"
                                variant="subtle"
                                onClick={() => navigate({ to: '/settings' })}
                                title={t('settings.title')}
                                className="text-[var(--app-hint)]"
                            >
                                <SettingsIcon className="h-5 w-5" />
                            </IconButton>
                            <IconButton
                                type="button"
                                variant="accent"
                                onClick={() => navigate({ to: '/sessions/new' })}
                                className="session-list-new-button"
                                title={t('sessions.new')}
                            >
                                <PlusIcon className="h-5 w-5" />
                            </IconButton>
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto desktop-scrollbar-left">
                    {error ? (
                        <div className="mx-auto w-full max-w-content px-3 py-2">
                            <div className="text-sm text-red-600">{error}</div>
                        </div>
                    ) : null}
                    <SessionList
                        sessions={sessions}
                        selectedSessionId={selectedSessionId}
                        onSelect={(sessionId) => navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId },
                        })}
                        onNewSession={() => navigate({ to: '/sessions/new' })}
                        onRefresh={handleRefresh}
                        isLoading={isLoading}
                        renderHeader={false}
                        api={api}
                    />
                </div>
            </div>

            <div
                className={`absolute inset-0 z-20 min-w-0 flex flex-1 flex-col bg-[var(--app-bg)] transition-transform duration-200 ease-out lg:static lg:z-auto lg:flex-none lg:w-full lg:max-w-content lg:translate-x-0 lg:pointer-events-auto ${
                    isSessionsIndex
                        ? 'translate-x-full pointer-events-none'
                        : 'translate-x-0'
                }`}
            >
                <div className="flex-1 min-h-0">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

function SessionsIndexPage() {
    return null
}

function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const {
        session,
        refetch: refetchSession,
    } = useSession(api, sessionId)
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
    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Resume failed'
                addToast({
                    title: 'Resume failed',
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (api) {
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
                                queryFn: () => api.getSession(resolvedSessionId),
                            }),
                            fetchLatestMessages(api, resolvedSessionId),
                        ])
                    } catch {
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resolvedSessionId },
                    replace: true
                })
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    if (!session) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
        />
    )
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({ to: '/sessions', replace: true })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
            })
        })
    }, [navigate, queryClient])

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <IconButton
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={goBack}
                        aria-label={t('projects.actions.back')}
                        title={t('projects.actions.back')}
                    >
                        <BackIcon />
                    </IconButton>
                )}
                <div className="flex-1 font-semibold">Create Session</div>
            </div>

            {machinesError ? (
                <div className="p-3 text-sm text-red-600">
                    {machinesError}
                </div>
            ) : null}

            <NewSession
                api={api}
                machines={machines}
                isLoading={machinesLoading}
                onCancel={handleCancel}
                onSuccess={handleSuccess}
            />
        </div>
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/projects" replace />,
})

const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects',
    component: ProjectsPage,
})

const projectsIndexRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: '/',
    component: ProjectsIndexPage,
})

const projectDetailRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: '$projectId',
    component: () => <Outlet />,
})

const projectDetailIndexRoute = createRoute({
    getParentRoute: () => projectDetailRoute,
    path: '/',
    component: ProjectOverviewPage,
})

const projectPlanningRoute = createRoute({
    getParentRoute: () => projectDetailRoute,
    path: 'planning',
    component: () => null,
})

const projectTaskRoute = createRoute({
    getParentRoute: () => projectDetailRoute,
    path: 'tasks/$taskId',
    component: TaskWorkbenchRoute,
})

const projectSettingsRoute = createRoute({
    getParentRoute: () => projectDetailRoute,
    path: 'settings',
    component: ProjectSettingsPage,
})

const projectTaskIndexRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: '/',
    component: () => null,
})

const projectTaskPanelRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: 'task',
    component: () => null,
})

const projectTaskChatRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: 'chat',
    component: () => null,
})

const projectTaskTerminalRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: 'terminal',
    component: () => null,
})

const projectTaskDiffsRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: 'diffs',
    component: () => null,
})

const projectTaskFilesRoute = createRoute({
    getParentRoute: () => projectTaskRoute,
    path: 'files',
    component: () => null,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        return tab ? { tab } : {}
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        return result
    },
    component: FilePage,
})

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    component: NewSessionPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    projectsRoute.addChildren([
        projectsIndexRoute,
        projectDetailRoute.addChildren([
            projectDetailIndexRoute,
            projectPlanningRoute,
            projectSettingsRoute,
            projectTaskRoute.addChildren([
                projectTaskIndexRoute,
                projectTaskPanelRoute,
                projectTaskChatRoute,
                projectTaskTerminalRoute,
                projectTaskDiffsRoute,
                projectTaskFilesRoute,
            ]),
        ])
    ]),
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
