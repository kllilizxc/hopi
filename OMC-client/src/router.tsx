import { Navigate, Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import PlanBoard from '@/components/PlanBoard'
import ProgramsIndexPage from '@/routes/programs/index'
import PlanPage from '@/routes/programs/plan'
import AttemptPage from '@/routes/programs/attempt'
import { useOmcApi } from '@/api/client'

function RootLayout() {
    return (
        <div className="omc-shell">
            <header className="omc-shell__header">
                <div>
                    <p className="omc-shell__eyebrow">One-Man-Company</p>
                    <h1>OMC</h1>
                </div>
                <nav className="omc-shell__nav">
                    <Link to="/programs">Programs</Link>
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
    const planningIndexQuery = useQuery({
        queryKey: ['omc', 'planning-index', params.programId],
        queryFn: () => api.getPlanningIndex(params.programId)
    })
    const runtimesQuery = useQuery({
        queryKey: ['omc', 'plan-runtimes', params.programId],
        queryFn: () => api.getPlanRuntimes(params.programId)
    })

    if (planningIndexQuery.isLoading || runtimesQuery.isLoading) {
        return <div className="omc-empty">Loading board…</div>
    }

    if (planningIndexQuery.error || runtimesQuery.error || !planningIndexQuery.data || !runtimesQuery.data) {
        return <div className="omc-empty">Could not load the planning-index board.</div>
    }

    const runtimes = Object.fromEntries(runtimesQuery.data.runtimes.map((runtime) => [runtime.planKey, runtime]))

    return (
        <div className="omc-board-page">
            <section className="omc-board-page__hero">
                <p className="omc-phase__eyebrow">{planningIndexQuery.data.program.repoRoot}</p>
                <h2>{planningIndexQuery.data.program.name}</h2>
                <p>Phase-grouped plan board. One card equals one PLAN.md, with Ralph loop runtime badges layered on top.</p>
            </section>

            <PlanBoard
                programId={params.programId}
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

const RouteAttempt = createRoute({
    getParentRoute: () => rootRoute,
    path: '/programs/$programId/attempts/$attemptId',
    component: AttemptPage
})

const routeTree = rootRoute.addChildren([
    RouteIndex,
    RoutePrograms,
    RouteProgramBoard,
    RoutePlan,
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
