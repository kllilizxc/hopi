import { Link } from '@tanstack/react-router'
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
    const { state, dataSource, threads, actions } = usePrototypeStore()
    const detail = dataSource.getGoal(props.goalId, state.window)

    if (!detail) {
        return <div className="prototype-empty">当前时间切片里没有这个目标。</div>
    }

    const goalView = goalPresentation(detail.goal, state.checkpoint)
    const relatedThreads = getRelatedThreads(threads, { goalId: detail.goal.id })
    const unresolvedCount = countUnresolvedThreads(relatedThreads)
    const primaryThread = getPrimaryRelatedThread(threads, { goalId: detail.goal.id })

    return (
        <div className="prototype-goal-page">
            <section className="prototype-execution-hero prototype-panel">
                <div className="prototype-execution-hero__top">
                    <div className="prototype-execution-hero__heading">
                        <div className="prototype-icon-pill prototype-icon-pill--large">
                            <Glyph name={goalGlyph(detail.goal.id)} />
                        </div>
                        <div>
                            <h2>{goalView.title}</h2>
                        </div>
                    </div>
                </div>

                <div className="prototype-badge-row">
                    <GoalStatusBadge status={detail.goal.status} />
                    <MetaBadge tone={detail.goal.needsApproval ? 'accent' : 'neutral'}>
                        {detail.goal.needsApproval ? '需要拍板' : '可静默推进'}
                    </MetaBadge>
                    <MetaBadge tone="neutral">置信 {detail.goal.confidence}%</MetaBadge>
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

            <StrategyPanel
                goal={detail.goal}
                strategy={detail.strategy}
                checkpointId={state.checkpoint}
            />

            <section className="prototype-panel">
                <div className="prototype-section-head">
                    <h2>执行流</h2>
                </div>

                <div className="prototype-stream-list">
                    {detail.streams.map((stream) => {
                        const view = streamPresentation(stream, state.checkpoint)

                        return (
                            <article key={stream.id} className="prototype-stream-card prototype-card">
                                <div className="prototype-stream-card__topline">
                                    <div className="prototype-stream-card__title">
                                        <div className="prototype-icon-pill">
                                            <Glyph name="stream" />
                                        </div>
                                        <div>
                                            <h3>{view.title}</h3>
                                        </div>
                                    </div>
                                    <StreamStatusBadge status={stream.status} />
                                </div>
                                <div className="prototype-inline-actions">
                                    <Link to="/goals/$goalId/execution/$streamId" params={{ goalId: detail.goal.id, streamId: stream.id }}>
                                        查看执行明细
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
