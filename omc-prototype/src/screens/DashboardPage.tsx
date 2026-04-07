import DemoAttachPanel from '@/components/DemoAttachPanel'
import {
    DailyDigestPanel,
    GoalPortfolioPanel,
    StreamsOverviewPanel
} from '@/components/DashboardPanels'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import SeedPlanningPanel from '@/components/SeedPlanningPanel'
import { MetaBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import { goalTitle, labelCheckpoint } from '@/prototype/presenter'
import { countActionableTopics } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'

export default function DashboardPage() {
    const { state, dataSource, live } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()

    if (!state.attachedProgramId) {
        return <DemoAttachPanel />
    }

    const portfolio = dataSource.getPortfolio(state.window)
    const checkpoint = labelCheckpoint(portfolio.checkpoint.id)
    const unresolvedThreadCount = countActionableTopics(Object.values(state.decisionTopics))
    const topGoal = portfolio.goals[0]
    const topGoalLabel = topGoal ? goalTitle(topGoal.id) : '当前目标'
    const isSeedOnly = Boolean(live?.planning?.hasPlanning && !live.planning.hasPlans)
    const planningSessionId = live?.planningRun?.sessionId ?? null
    const summaryLine = isSeedOnly
        ? '项目刚接入。先给出产品意图和第一刀，系统再开始生成第一批计划。'
        : unresolvedThreadCount > 0
            ? `主线在 ${topGoalLabel}，收件箱里还有 ${unresolvedThreadCount} 条线程等你处理。`
            : `主线在 ${topGoalLabel}，其余动作都在静默推进。`

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
            <section className="flex flex-col gap-4 p-8 bg-white border border-zinc-200 rounded-xl shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-50 pointer-events-none"></div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-start gap-4">
                        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-zinc-900 text-white shadow-sm flex-shrink-0">
                            <Glyph name="repo" />
                        </div>
                        <div className="flex flex-col">
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">{portfolio.program.name}</p>
                            <h2 className="text-2xl font-bold text-zinc-900">目标经营盘</h2>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <MetaBadge tone="neutral">{checkpoint.label}</MetaBadge>
                        <MetaBadge tone="neutral">{portfolio.checkpoint.stamp}</MetaBadge>
                        <MetaBadge tone={unresolvedThreadCount > 0 ? 'neutral' : 'success'}>
                            {unresolvedThreadCount > 0 ? `${unresolvedThreadCount} 条待处理线程` : '低打扰运行'}
                        </MetaBadge>
                        {planningSessionId ? (
                            <button
                                type="button"
                                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors ml-auto md:ml-0"
                                onClick={() => {
                                    operatorSurface.openSessionLog({
                                        sessionId: planningSessionId,
                                        source: 'planning-run',
                                        title: portfolio.program.name,
                                        subtitle: 'guided planning',
                                    })
                                }}
                            >
                                查看规划日志
                            </button>
                        ) : null}
                    </div>
                </div>
                <p className="text-base text-zinc-700 max-w-3xl relative z-10 font-medium leading-relaxed">{checkpoint.synopsis}</p>
                <p className="text-sm text-zinc-500 max-w-3xl relative z-10 leading-relaxed">{summaryLine}</p>
            </section>

            {isSeedOnly ? (
                <SeedPlanningPanel
                    programId={state.attachedProgramId}
                    programName={portfolio.program.name}
                    planning={live?.planning ?? null}
                    planningRun={live?.planningRun ?? null}
                />
            ) : (
                <div className="flex flex-col gap-8">
                    <GoalPortfolioPanel goals={portfolio.goals} checkpointId={portfolio.checkpoint.id} />

                    <DailyDigestPanel
                        window={portfolio.digest.window}
                        headline="今日摘要"
                        summary={checkpoint.synopsis}
                    />

                    <StreamsOverviewPanel
                        goals={portfolio.goals}
                        streams={portfolio.streams}
                        checkpointId={portfolio.checkpoint.id}
                    />
                </div>
            )}
        </div>
    )
}
