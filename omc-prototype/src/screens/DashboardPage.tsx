import { useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import DemoAttachPanel from '@/components/DemoAttachPanel'
import {
    DailyDigestPanel,
    GoalPortfolioPanel
} from '@/components/DashboardPanels'
import ExecutionBoard from '@/components/ExecutionBoard'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import SeedPlanningPanel from '@/components/SeedPlanningPanel'
import StrategyPanel from '@/components/StrategyPanel'
import { MetaBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import { goalGlyph, goalPresentation, goalTitle, labelCheckpoint } from '@/prototype/presenter'
import { countActionableTopics, countUnresolvedThreads, getPrimaryRelatedThread, getRelatedThreads } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'

export default function DashboardPage() {
    const { state, dataSource, live, actions } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()
    const search = useSearch({ from: '/' })

    if (!state.attachedProgramId) {
        return <DemoAttachPanel />
    }

    const portfolio = dataSource.getPortfolio(state.window)
    const checkpoint = labelCheckpoint(portfolio.checkpoint.id)
    const unresolvedThreadCount = countActionableTopics(Object.values(state.decisionTopics))
    const topGoal = portfolio.goals[0]
    const topGoalLabel = topGoal ? goalTitle(topGoal.id) : '当前目标'
    const selectedGoalId = portfolio.goals.some((goal) => goal.id === search.goal)
        ? search.goal ?? null
        : topGoal?.id ?? null
    const selectedGoalDetail = selectedGoalId ? dataSource.getGoal(selectedGoalId, state.window) : null
    const isSeedOnly = Boolean(live?.planning?.hasPlanning && !live.planning.hasPlans)
    const planningSessionId = live?.planningRun?.sessionId ?? null
    const summaryLine = isSeedOnly
        ? '项目刚接入。先给出产品意图和第一刀，系统再开始生成第一批计划。'
        : unresolvedThreadCount > 0
            ? `主线在 ${topGoalLabel}，收件箱里还有 ${unresolvedThreadCount} 条线程等你处理。`
            : `主线在 ${topGoalLabel}，其余动作都在静默推进。`
    const allThreads = Object.values(state.threadsById ?? {})
    const goalThreads = selectedGoalDetail ? getRelatedThreads(allThreads, { goalId: selectedGoalDetail.goal.id }) : []
    const unresolvedGoalThreads = countUnresolvedThreads(goalThreads)
    const primaryGoalThread = selectedGoalDetail ? getPrimaryRelatedThread(allThreads, { goalId: selectedGoalDetail.goal.id }) : null
    const goalView = selectedGoalDetail ? goalPresentation(selectedGoalDetail.goal, state.checkpoint) : null

    useEffect(() => {
        if (!selectedGoalId) {
            return
        }

        if (state.traceSelection) {
            const tracePlan = portfolio.planCards.find((card) => card.id === state.traceSelection?.planId)
            if (tracePlan && tracePlan.goalId !== selectedGoalId) {
                actions.clearPlanTrace()
            }
        }

        const activeThread = state.activeThreadId ? state.threadsById?.[state.activeThreadId] ?? null : null
        if (activeThread?.goalId && activeThread.goalId !== selectedGoalId) {
            actions.clearActiveThread()
        }
    }, [actions, portfolio.planCards, selectedGoalId, state.activeThreadId, state.threadsById, state.traceSelection])

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
                    <GoalPortfolioPanel
                        goals={portfolio.goals}
                        checkpointId={portfolio.checkpoint.id}
                        selectedGoalId={selectedGoalId}
                    />

                    {selectedGoalDetail && goalView ? (
                        <>
                            <section className="flex flex-col gap-6 p-8 bg-white border border-zinc-200 rounded-xl shadow-sm relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-50 pointer-events-none"></div>

                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
                                    <div className="flex items-start gap-4 max-w-3xl">
                                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100 flex-shrink-0">
                                            <Glyph name={goalGlyph(selectedGoalDetail.goal.id)} />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <h2 className="text-2xl font-bold text-zinc-900 tracking-tight leading-tight">{goalView.title}</h2>
                                            <p className="text-base text-zinc-600 leading-relaxed">{goalView.summary}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-3 relative z-10 pt-4 border-t border-zinc-100">
                                    <MetaBadge tone="neutral">{selectedGoalDetail.goal.status}</MetaBadge>
                                    <MetaBadge tone="neutral">置信 {selectedGoalDetail.goal.confidence}%</MetaBadge>
                                    {goalThreads.length > 0 ? (
                                        <MetaBadge tone="neutral">
                                            {unresolvedGoalThreads > 0 ? `${unresolvedGoalThreads} 条待处理线程` : `${goalThreads.length} 条相关线程`}
                                        </MetaBadge>
                                    ) : null}
                                    {primaryGoalThread ? (
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors ml-auto md:ml-0"
                                            onClick={() => operatorSurface.openThread(primaryGoalThread.id)}
                                        >
                                            打开线程
                                        </button>
                                    ) : null}
                                </div>

                                <div className="flex flex-col gap-1.5 mt-2 bg-zinc-50 p-4 rounded-lg border border-zinc-100 relative z-10">
                                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">成功信号</span>
                                    <p className="text-sm font-medium text-zinc-800 leading-relaxed">{goalView.successSignal}</p>
                                </div>
                            </section>

                            <StrategyPanel
                                goal={selectedGoalDetail.goal}
                                strategy={selectedGoalDetail.strategy}
                                checkpointId={state.checkpoint}
                            />

                            <DailyDigestPanel
                                window={selectedGoalDetail.digest.window}
                                headline="今日摘要"
                                summary={selectedGoalDetail.digest.summary}
                            />

                            <section className="flex flex-col gap-5">
                                <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                                    <h2 className="text-xl font-semibold text-zinc-900">执行看板</h2>
                                </div>
                                <div className="min-h-[520px] rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
                                    <ExecutionBoard phases={selectedGoalDetail.phases} planCards={selectedGoalDetail.planCards} />
                                </div>
                            </section>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    )
}
