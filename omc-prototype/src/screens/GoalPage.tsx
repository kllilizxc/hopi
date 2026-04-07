import { Link } from '@tanstack/react-router'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import StrategyPanel from '@/components/StrategyPanel'
import { GoalStatusBadge, MetaBadge, StreamStatusBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import {
    goalGlyph,
    goalPresentation,
    streamPresentation
} from '@/prototype/presenter'
import { countUnresolvedThreads, getPrimaryRelatedThread, getRelatedThreads } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'

export default function GoalPage(props: { goalId: string }) {
    const { state, dataSource, threads } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()
    const detail = dataSource.getGoal(props.goalId, state.window)

    if (!detail) {
        return <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500 h-full">当前时间切片里没有这个目标。</div>
    }

    const goalView = goalPresentation(detail.goal, state.checkpoint)
    const relatedThreads = getRelatedThreads(threads, { goalId: detail.goal.id })
    const unresolvedCount = countUnresolvedThreads(relatedThreads)
    const primaryThread = getPrimaryRelatedThread(threads, { goalId: detail.goal.id })

    return (
        <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
            <section className="flex flex-col gap-6 p-8 bg-white border border-zinc-200 rounded-xl shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-50 pointer-events-none"></div>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
                    <div className="flex items-start gap-4 max-w-3xl">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100 flex-shrink-0">
                            <Glyph name={goalGlyph(detail.goal.id)} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold text-zinc-900 tracking-tight leading-tight">{goalView.title}</h2>
                            <p className="text-base text-zinc-600 leading-relaxed">{goalView.summary}</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 relative z-10 pt-4 border-t border-zinc-100">
                    <GoalStatusBadge status={detail.goal.status} />
                    <MetaBadge tone="neutral">置信 {detail.goal.confidence}%</MetaBadge>
                    {relatedThreads.length > 0 ? (
                        <MetaBadge tone="neutral">
                            {unresolvedCount > 0 ? `${unresolvedCount} 条待处理线程` : `${relatedThreads.length} 条相关线程`}
                        </MetaBadge>
                    ) : null}
                    {primaryThread ? (
                        <button
                            type="button"
                            className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors ml-auto md:ml-0"
                            onClick={() => operatorSurface.openThread(primaryThread.id)}
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
                goal={detail.goal}
                strategy={detail.strategy}
                checkpointId={state.checkpoint}
            />

            <section className="flex flex-col gap-5">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                    <h2 className="text-xl font-semibold text-zinc-900">执行流</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {detail.streams.map((stream) => {
                        const view = streamPresentation(stream, state.checkpoint)

                        return (
                            <article key={stream.id} className="flex flex-col p-5 bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 gap-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-100 text-zinc-600 flex-shrink-0">
                                            <Glyph name="stream" />
                                        </div>
                                        <h3 className="text-base font-semibold text-zinc-900 truncate">{view.title}</h3>
                                    </div>
                                    <StreamStatusBadge status={stream.status} />
                                </div>
                                <p className="text-sm text-zinc-600 leading-relaxed line-clamp-3 flex-1">{view.summary}</p>
                                <div className="flex items-center justify-end pt-3 border-t border-zinc-100 mt-auto">
                                    <Link
                                        to="/goals/$goalId/execution/$streamId"
                                        params={{ goalId: detail.goal.id, streamId: stream.id }}
                                        className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:underline"
                                    >
                                        查看执行明细 →
                                    </Link>
                                </div>
                            </article>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}
