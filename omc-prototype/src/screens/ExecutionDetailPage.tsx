import ExecutionBoard from '@/components/ExecutionBoard'
import { MetaBadge, StreamStatusBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import { streamPresentation } from '@/prototype/presenter'
import { countUnresolvedThreads, getPrimaryRelatedThread, getRelatedThreads } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'

export default function ExecutionDetailPage(props: { goalId: string; streamId: string }) {
    const { dataSource, state, threads, actions } = usePrototypeStore()
    const detail = dataSource.getExecutionDrilldown({
        goalId: props.goalId,
        streamId: props.streamId
    })

    if (!detail) {
        return <div className="prototype-empty">当前时间切片里没有这块执行明细。</div>
    }

    const view = streamPresentation(detail.stream, state.checkpoint)
    const relatedThreads = getRelatedThreads(threads, { goalId: props.goalId, streamId: props.streamId })
    const unresolvedCount = countUnresolvedThreads(relatedThreads)
    const primaryThread = getPrimaryRelatedThread(threads, { goalId: props.goalId, streamId: props.streamId })

    return (
        <div className="prototype-drilldown-page">
            <section className="prototype-execution-header prototype-panel">
                <div className="prototype-execution-header__row">
                    <div className="prototype-execution-header__title">
                        <div className="prototype-icon-pill prototype-icon-pill--large">
                            <Glyph name="kanban" />
                        </div>
                        <h2>{view.title}</h2>
                    </div>
                    <div className="prototype-execution-header__actions">
                        <span className="prototype-execution-inline-label">完成度 {detail.stream.progress}%</span>
                    </div>
                </div>
                <div className="prototype-badge-row">
                    <StreamStatusBadge status={detail.stream.status} />
                    {relatedThreads.length > 0 ? (
                        <MetaBadge tone={unresolvedCount > 0 ? 'accent' : 'neutral'}>
                            {unresolvedCount > 0 ? `${unresolvedCount} 条待处理线程` : `${relatedThreads.length} 条相关线程`}
                        </MetaBadge>
                    ) : null}
                    {primaryThread ? (
                        <button
                            type="button"
                            className="prototype-button--ghost"
                            onClick={() => actions.setActiveThread(primaryThread.id)}
                        >
                            打开线程
                        </button>
                    ) : null}
                </div>
            </section>

            <ExecutionBoard phases={detail.phases} planCards={detail.planCards} />
        </div>
    )
}
