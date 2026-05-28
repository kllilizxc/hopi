import { Navigate, Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import PlanBoard from '@/components/PlanBoard'
import ProgramsIndexPage from '@/routes/programs/index'
import PlanPage from '@/routes/programs/plan'
import AttemptPage from '@/routes/programs/attempt'
import ReviewPage from '@/routes/programs/review'
import { useOmcApi } from '@/api/client'
import { useOmcEvents } from '@/hooks/useOmcEvents'

function RootLayout() {
    useOmcEvents()

    return (
        <div className="omc-shell">
            <header className="omc-shell__header">
                <div>
                    <p className="omc-shell__eyebrow">One-Man-Company</p>
                    <h1>OMC</h1>
                </div>
                <nav className="omc-shell__nav">
                    <Link to="/programs/manage">Programs</Link>
                </nav>
            </header>
            <main className="omc-shell__main">
                <Outlet />
            </main>
        </div>
    )
}

function ProgramBoardPage() {
    const api = useOmcApi()
    const params = RouteProgramBoard.useParams()
    const programQuery = useQuery({
        queryKey: ['omc', 'program', params.programId],
        queryFn: () => api.getProgram(params.programId)
    })
    const planningRunQuery = useQuery({
        queryKey: ['omc', 'planning-run', params.programId],
        queryFn: () => api.getGuidedPlanningState(params.programId),
        refetchInterval: (query) => {
            const run = query.state.data?.run
            return run?.status === 'queued' || run?.status === 'running' ? 2_000 : false
        }
    })
    const guidedPlanningActive = planningRunQuery.data?.run?.status === 'queued'
        || planningRunQuery.data?.run?.status === 'running'
    const planningIndexQuery = useQuery({
        queryKey: ['omc', 'planning-index', params.programId],
        queryFn: () => api.getPlanningIndex(params.programId),
        refetchInterval: guidedPlanningActive ? 2_500 : false
    })
    const runtimesQuery = useQuery({
        queryKey: ['omc', 'plan-runtimes', params.programId],
        queryFn: () => api.getPlanRuntimes(params.programId)
    })

    if (programQuery.isLoading || planningRunQuery.isLoading || planningIndexQuery.isLoading || runtimesQuery.isLoading) {
        return <div className="omc-empty">Loading board…</div>
    }

    if (
        programQuery.error
        || planningRunQuery.error
        || planningIndexQuery.error
        || runtimesQuery.error
        || !programQuery.data
        || !planningRunQuery.data
        || !planningIndexQuery.data
        || !runtimesQuery.data
    ) {
        return <div className="omc-empty">Could not load the planning-index board.</div>
    }

    const runtimes = Object.fromEntries(runtimesQuery.data.runtimes.map((runtime) => [runtime.planKey, runtime]))
    const planning = planningRunQuery.data.planning

    return (
        <div className="omc-board-page">
            <section className="omc-board-page__hero">
                <p className="omc-phase__eyebrow">{planningIndexQuery.data.program.repoRoot}</p>
                <h2>{programQuery.data.program.name}</h2>
                <p>Phase-grouped plan board. One card equals one PLAN.md, with Ralph loop runtime badges layered on top.</p>
            </section>

            <PlanBoard
                programId={params.programId}
                program={programQuery.data.program}
                planning={planning}
                planningRun={planningRunQuery.data.run}
                phases={planningIndexQuery.data.phases}
                runtimes={runtimes}
            />
        </div>
    )
}

const rootRoute = createRootRoute({
    component: RootLayout
})

const RouteIndex = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/programs" />
})

const RoutePrograms = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs',
    component: ProgramsIndexPage
})

const RouteProgramsManage = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/manage',
    component: () => <ProgramsIndexPage autoRedirect={false} />
})

const RouteProgramBoard = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/$programId',
    component: ProgramBoardPage
})

const RoutePlan = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/$programId/plans/$planKey',
    component: PlanPage
})

const RouteReview = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/$programId/plans/$planKey/review',
    component: ReviewPage
})

const RouteAttempt = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/$programId/attempts/$attemptId',
    component: AttemptPage
})

const routeTree = rootRoute.addChildren([
    RouteIndex,
    RoutePrograms,
    RouteProgramsManage,
    RouteProgramBoard,
    RoutePlan,
    RouteReview,
    RouteAttempt
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
