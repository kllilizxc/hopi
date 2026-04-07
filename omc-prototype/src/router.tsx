import {
    Link,
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation
} from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import DashboardPage from '@/screens/DashboardPage'
import GoalPage from '@/screens/GoalPage'
import ExecutionDetailPage from '@/screens/ExecutionDetailPage'
import LiveWorkspaceBar from '@/components/LiveWorkspaceBar'
import MessagePanel from '@/components/MessagePanel'
import { OperatorSurfaceProvider } from '@/components/operator/OperatorSurfaceContext'
import { Glyph } from '@/components/Visuals'
import { prototypeCheckpoints } from '@/prototype/scenario'
import {
    goalTitle,
    labelCheckpoint,
    labelTimeWindow
} from '@/prototype/presenter'
import { usePrototypeStore } from '@/prototype/store'
import type { PrototypePortfolioView, SessionLogSelection } from '@/prototype/types'

function RootLayout() {
    const { clock, actions, dataSource, live, state, threads } = usePrototypeStore()
    const [messagePanelOpen, setMessagePanelOpen] = useState(false)
    const [sessionLogSelection, setSessionLogSelection] = useState<SessionLogSelection | null>(null)
    const portfolio = state.attachedProgramId ? dataSource.getPortfolio(clock.window) : null
    const checkpoint = labelCheckpoint(clock.checkpoint)
    const isLive = Boolean(live)
    const location = useLocation()
    const breadcrumbs = buildBreadcrumbs(location.pathname, portfolio)
    const backTarget = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2]?.to : undefined
    const activeInboxCount = useMemo(
        () => threads.filter((thread) => !thread.passive && (thread.lifecycle === 'pending' || thread.lifecycle === 'waiting' || thread.lifecycle === 'in-progress')).length,
        [threads],
    )
    const operatorSurface = useMemo(() => ({
        openInbox() {
            setSessionLogSelection(null)
            actions.clearPlanTrace()
            setMessagePanelOpen(true)
        },
        openThread(threadId: string) {
            setSessionLogSelection(null)
            actions.clearPlanTrace()
            actions.setActiveThread(threadId)
            setMessagePanelOpen(true)
        },
        openTrace(input: { planId: string; streamId: string }) {
            setSessionLogSelection(null)
            actions.openPlanTrace(input)
            setMessagePanelOpen(true)
        },
        openSessionLog(input: SessionLogSelection) {
            setSessionLogSelection(input)
            setMessagePanelOpen(true)
        },
        clearSessionLog() {
            setSessionLogSelection(null)
        },
        closePanel() {
            setMessagePanelOpen(false)
        },
        isOpen: messagePanelOpen,
        activeTrace: state.traceSelection,
        activeSessionLog: sessionLogSelection,
    }), [actions, messagePanelOpen, sessionLogSelection, state.traceSelection])

    return (
        <OperatorSurfaceProvider value={operatorSurface}>
            <div className="grid grid-rows-[auto_1fr] h-screen w-full bg-zinc-50 text-zinc-900 overflow-hidden">
                <header className="border-b border-zinc-200 bg-white">
                    {isLive ? (
                        <LiveWorkspaceBar
                            programName={portfolio?.program.name ?? 'OMC Workspace'}
                            repoRoot={portfolio?.program.repoRoot ?? '真实 OMC runtime'}
                            checkpointLabel={portfolio ? checkpoint.label : '未连接'}
                            checkpointSynopsis={portfolio ? checkpoint.synopsis : '输入 access token 后接入真实 OMC runtime'}
                            activeInboxCount={activeInboxCount}
                            programs={live?.programs ?? []}
                            selectedProgramId={live?.selectedProgramId ?? ''}
                            onProgramChange={(programId) => actions.selectProgram?.(programId)}
                            onOpenInbox={operatorSurface.openInbox}
                        />
                    ) : (
                        <div className="flex items-center justify-between px-6 py-4">
                            <div className="flex flex-col">
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">One-Man-Company 2.0</p>
                                <h1 className="text-xl font-bold">OMC 控制台</h1>
                            </div>

                            <div className="flex flex-col items-center">
                                <span className="text-xs text-zinc-500">时间切片</span>
                                <strong className="text-sm font-medium">{portfolio ? checkpoint.label : '未连接'}</strong>
                                <small className="text-xs text-zinc-400">{portfolio ? checkpoint.synopsis : '输入 access token 后接入真实 OMC runtime'}</small>
                            </div>

                            <div className="flex items-center gap-3">
                                <button type="button" className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors" onClick={() => actions.previousCheckpoint()}>
                                    上一步
                                </button>
                                <button type="button" className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors" onClick={() => actions.nextCheckpoint()}>
                                    下一步
                                </button>
                                <button type="button" className="px-3 py-1.5 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 rounded-md shadow-sm transition-colors" onClick={() => actions.setAutoplay(!clock.autoplay)}>
                                    {clock.autoplay ? '暂停自动播放' : '自动播放'}
                                </button>
                            </div>
                        </div>
                    )}
                </header>

                {portfolio ? (
                    <>
                        {!isLive ? (
                            <section className="flex items-center justify-between px-6 py-3 border-b border-zinc-200 bg-white shadow-sm z-10 relative">
                                <div className="flex items-center gap-2">
                                    {prototypeCheckpoints.map((checkpointItem) => (
                                        <button
                                            key={checkpointItem.id}
                                            type="button"
                                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${checkpointItem.id === clock.checkpoint ? 'bg-blue-50 text-blue-700' : 'text-zinc-600 hover:bg-zinc-100'}`}
                                            onClick={() => actions.setClockCheckpoint(checkpointItem.id)}
                                        >
                                            {labelCheckpoint(checkpointItem.id).label}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-sm font-medium text-zinc-500 bg-zinc-100 px-2.5 py-1 rounded-md">{labelTimeWindow(clock.window)}</span>
                                <button
                                    type="button"
                                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 rounded-md shadow-sm transition-colors"
                                    onClick={operatorSurface.openInbox}
                                >
                                    <Glyph name="digest" />
                                    <span>消息</span>
                                    {activeInboxCount > 0 ? <strong className="flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[10px]">{activeInboxCount}</strong> : null}
                                </button>
                            </section>
                        ) : null}

                        <div className="flex items-center gap-4 px-6 py-3 border-b border-zinc-200 bg-zinc-50/50">
                            {backTarget ? (
                                <Link className="flex items-center justify-center w-8 h-8 rounded-full bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors shadow-sm" to={backTarget} aria-label="返回上一层" title="返回上一层">
                                    <Glyph name="back" />
                                </Link>
                            ) : null}

                            <nav className="flex items-center gap-2 text-sm text-zinc-500" aria-label="页面路径">
                                {breadcrumbs.map((crumb, index) => (
                                    <span key={`${crumb.label}-${crumb.to ?? 'current'}`} className="flex items-center gap-2">
                                        {index > 0 ? <span className="text-zinc-300">/</span> : null}
                                        {crumb.to ? (
                                            <Link to={crumb.to} className="hover:text-zinc-900 transition-colors">
                                                {crumb.label}
                                            </Link>
                                        ) : (
                                            <strong className="font-semibold text-zinc-900">{crumb.label}</strong>
                                        )}
                                    </span>
                                ))}
                            </nav>
                        </div>

                    </>
                ) : null}

                <main className="flex flex-1 overflow-hidden relative">
                    <div className="flex-1 overflow-y-auto p-6 bg-zinc-50 relative min-w-0">
                        <Outlet />
                    </div>
                    {portfolio ? (
                        <>
                            <MessagePanel className="hidden lg:flex w-full max-w-[500px] flex-shrink-0 border-l border-zinc-200 bg-white" />
                            <div
                                className={`fixed inset-0 z-50 bg-black/20 backdrop-blur-sm transition-opacity lg:hidden ${messagePanelOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                                onClick={operatorSurface.closePanel}
                            >
                                <div
                                    className={`absolute right-0 top-0 bottom-0 w-full sm:w-[400px] bg-white shadow-2xl transform transition-transform duration-300 ${messagePanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <MessagePanel
                                        className="flex h-full w-full"
                                        onClose={operatorSurface.closePanel}
                                    />
                                </div>
                            </div>
                        </>
                    ) : null}
                </main>
            </div>
        </OperatorSurfaceProvider>
    )
}

function buildBreadcrumbs(
    pathname: string,
    portfolio: PrototypePortfolioView | null
): Array<{ label: string; to?: string }> {
    if (!portfolio) {
        return []
    }

    const segments = pathname.split('/').filter(Boolean)
    const goalId = segments[1]
    const streamId = segments[3]

    const goal = portfolio.goals.find((item) => item.id === goalId)
    const stream = portfolio.streams.find((item) => item.id === streamId)

    const crumbs: Array<{ label: string; to?: string }> = [
        { label: '总览', to: '/' }
    ]

    if (!goal) {
        return crumbs
    }

    crumbs.push({
        label: goalTitle(goal.id),
        to: `/goals/${goal.id}`
    })

    if (!stream) {
        return crumbs
    }

    if (segments[2] === 'execution') {
        crumbs.push({ label: '执行明细' })
    }

    return crumbs
}

function GoalRoutePage() {
    const { goalId } = RouteGoal.useParams()
    return <GoalPage goalId={goalId} />
}

function ExecutionRoutePage() {
    const { goalId, streamId } = RouteExecution.useParams()
    return <ExecutionDetailPage goalId={goalId} streamId={streamId} />
}

const rootRoute = createRootRoute({
    component: RootLayout
})

const RouteIndex = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: DashboardPage
})

const RouteGoalsLegacy = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goals',
    component: () => <Navigate to="/" />
})

const RouteGoal = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goals/$goalId',
    component: GoalRoutePage
})

const RouteExecution = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goals/$goalId/execution/$streamId',
    component: ExecutionRoutePage
})

const routeTree = rootRoute.addChildren([
    RouteIndex,
    RouteGoalsLegacy,
    RouteGoal,
    RouteExecution
])

export function createAppRouter(basepath = '/') {
    return createRouter({
        routeTree,
        basepath
    })
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof createAppRouter>
    }
}
