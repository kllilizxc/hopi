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
        <div className="prototype-dashboard">
            <section className="prototype-dashboard-hero prototype-panel">
                <div className="prototype-dashboard-hero__topline">
                    <div className="prototype-dashboard-hero__copy">
                        <div className="prototype-icon-pill prototype-icon-pill--large">
                            <Glyph name="repo" />
                        </div>
                        <div>
                            <p className="prototype-eyebrow">{portfolio.program.name}</p>
                            <h2>目标经营盘</h2>
                        </div>
                    </div>
                    <div className="prototype-dashboard-hero__meta">
                        <MetaBadge tone="neutral">{checkpoint.label}</MetaBadge>
                        <MetaBadge tone="neutral">{portfolio.checkpoint.stamp}</MetaBadge>
                        <MetaBadge tone={unresolvedThreadCount > 0 ? 'neutral' : 'success'}>
                            {unresolvedThreadCount > 0 ? `${unresolvedThreadCount} 条待处理线程` : '低打扰运行'}
                        </MetaBadge>
                        {planningSessionId ? (
                            <button
                                type="button"
                                className="prototype-button--ghost"
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
                <p className="prototype-dashboard-hero__lede">{checkpoint.synopsis}</p>
                <p className="prototype-dashboard-hero__summary">{summaryLine}</p>
            </section>

            {isSeedOnly ? (
                <SeedPlanningPanel
                    programId={state.attachedProgramId}
                    programName={portfolio.program.name}
                    planning={live?.planning ?? null}
                    planningRun={live?.planningRun ?? null}
                />
            ) : (
                <>
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
                </>
            )}
        </div>
    )
}
