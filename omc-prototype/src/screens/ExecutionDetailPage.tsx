import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import ExecutionBoard from '@/components/ExecutionBoard'
import { MetaBadge, StreamStatusBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import { streamPresentation } from '@/prototype/presenter'
import { countUnresolvedThreads, getPrimaryRelatedThread, getRelatedThreads } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'

export default function ExecutionDetailPage(props: { goalId: string; streamId: string }) {
    const { dataSource, state, threads } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()
    const detail = dataSource.getExecutionDrilldown({
        goalId: props.goalId,
        streamId: props.streamId
    })

    if (!detail) {
        return <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500 h-full">当前时间切片里没有这块执行明细。</div>
    }

    const view = streamPresentation(detail.stream, state.checkpoint)
    const relatedThreads = getRelatedThreads(threads, { goalId: props.goalId, streamId: props.streamId })
    const unresolvedCount = countUnresolvedThreads(relatedThreads)
    const primaryThread = getPrimaryRelatedThread(threads, { goalId: props.goalId, streamId: props.streamId })

    return (
        <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto h-auto">
            <section className="flex flex-col gap-5 p-8 bg-white border border-zinc-200 rounded-xl shadow-sm relative overflow-hidden flex-shrink-0">
                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-50/50 to-transparent opacity-50 pointer-events-none"></div>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
                    <div className="flex items-start gap-4 max-w-4xl">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100 flex-shrink-0">
                            <Glyph name="kanban" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold text-zinc-900 tracking-tight leading-tight">{view.title}</h2>
                            <p className="text-base text-zinc-600 leading-relaxed">{view.summary}</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-end md:justify-start">
                        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 font-semibold text-sm border border-indigo-200 rounded-lg whitespace-nowrap shadow-sm">完成度 {detail.stream.progress}%</span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 relative z-10 pt-4 border-t border-zinc-100">
                    <StreamStatusBadge status={detail.stream.status} />
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

                <div className="flex flex-col gap-1.5 mt-2 bg-indigo-50/50 p-4 rounded-lg border border-indigo-100 relative z-10">
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">为什么现在看这条流</span>
                    <p className="text-sm font-medium text-zinc-800 leading-relaxed">{view.whyNow}</p>
                </div>
            </section>

            <div className="flex-1 overflow-hidden min-h-0 bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
                <ExecutionBoard phases={detail.phases} planCards={detail.planCards} />
            </div>
        </div>
    )
}
