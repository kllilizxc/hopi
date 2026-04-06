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
            <div className="prototype-shell">
                <header className="prototype-shell__header">
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
                        <div className="prototype-header-strip">
                            <div className="prototype-header-strip__brand">
                                <p className="prototype-eyebrow">One-Man-Company 2.0</p>
                                <h1>OMC 控制台</h1>
                            </div>

                            <div className="prototype-header-strip__clock">
                                <span>时间切片</span>
                                <strong>{portfolio ? checkpoint.label : '未连接'}</strong>
                                <small>{portfolio ? checkpoint.synopsis : '输入 access token 后接入真实 OMC runtime'}</small>
                            </div>

                            <div className="prototype-header-strip__actions">
                                <button type="button" className="prototype-button--ghost" onClick={() => actions.previousCheckpoint()}>
                                    上一步
                                </button>
                                <button type="button" className="prototype-button--ghost" onClick={() => actions.nextCheckpoint()}>
                                    下一步
                                </button>
                                <button type="button" onClick={() => actions.setAutoplay(!clock.autoplay)}>
                                    {clock.autoplay ? '暂停自动播放' : '自动播放'}
                                </button>
                            </div>
                        </div>
                    )}
                </header>

                {portfolio ? (
                    <>
                        {!isLive ? (
                            <section className="prototype-topbar">
                                <div className="prototype-topbar__checkpoint">
                                    {prototypeCheckpoints.map((checkpointItem) => (
                                        <button
                                            key={checkpointItem.id}
                                            type="button"
                                            className={checkpointItem.id === clock.checkpoint ? 'is-active' : undefined}
                                            onClick={() => actions.setClockCheckpoint(checkpointItem.id)}
                                        >
                                            {labelCheckpoint(checkpointItem.id).label}
                                        </button>
                                    ))}
                                </div>
                                <span className="prototype-topbar__window">{labelTimeWindow(clock.window)}</span>
                                <button
                                    type="button"
                                    className="prototype-message-toggle"
                                    onClick={operatorSurface.openInbox}
                                >
                                    <Glyph name="digest" />
                                    <span>消息</span>
                                    {activeInboxCount > 0 ? <strong>{activeInboxCount}</strong> : null}
                                </button>
                            </section>
                        ) : null}

                        <div className="prototype-nav-row">
                            {backTarget ? (
                                <Link className="prototype-back-button" to={backTarget} aria-label="返回上一层" title="返回上一层">
                                    <Glyph name="back" />
                                </Link>
                            ) : null}

                            <nav className="prototype-breadcrumbs" aria-label="页面路径">
                                {breadcrumbs.map((crumb, index) => (
                                    <span key={`${crumb.label}-${crumb.to ?? 'current'}`}>
                                        {index > 0 ? <span className="prototype-breadcrumbs__sep">/</span> : null}
                                        {crumb.to ? (
                                            <Link to={crumb.to}>
                                                {crumb.label}
                                            </Link>
                                        ) : (
                                            <strong>{crumb.label}</strong>
                                        )}
                                    </span>
                                ))}
                            </nav>
                        </div>

                    </>
                ) : null}

                <main className={portfolio ? 'prototype-shell__main prototype-shell__main--with-sidebar' : 'prototype-shell__main'}>
                    <div className="prototype-shell__content">
                        <Outlet />
                    </div>
                    {portfolio ? (
                        <>
                            <MessagePanel className="prototype-message-rail" />
                            <div
                                className={`prototype-message-overlay${messagePanelOpen ? ' is-open' : ''}`}
                                onClick={operatorSurface.closePanel}
                            >
                                <div onClick={(event) => event.stopPropagation()}>
                                    <MessagePanel
                                        className="prototype-message-drawer"
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
