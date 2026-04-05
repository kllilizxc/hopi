import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
    goalGlyph,
    goalPresentation,
    goalTitle,
    labelTimeWindow,
    streamGlyph,
    streamPresentation
} from '@/prototype/presenter'
import { getPrimaryRelatedThread, getRelatedThreads, countUnresolvedThreads } from '@/prototype/threadSelectors'
import { usePrototypeStore } from '@/prototype/store'
import type {
    PrototypeCheckpointId,
    PrototypeGoal,
    PrototypeStream,
    PrototypeTimeWindow
} from '@/prototype/types'
import { GoalStatusBadge, MetaBadge, StreamStatusBadge } from './StatusBadge'
import { Glyph, SparkBar } from './Visuals'

export function GoalPortfolioPanel(props: {
    goals: PrototypeGoal[]
    checkpointId: PrototypeCheckpointId
}) {
    const { threads, actions } = usePrototypeStore()

    return (
        <section className="prototype-panel prototype-panel--portfolio">
            <div className="prototype-section-head">
                <h2>目标</h2>
            </div>

            <div className="prototype-goal-grid">
                {props.goals.map((goal) => {
                    const view = goalPresentation(goal, props.checkpointId)
                    const relatedThreads = getRelatedThreads(threads, { goalId: goal.id })
                    const unresolvedCount = countUnresolvedThreads(relatedThreads)
                    const primaryThread = getPrimaryRelatedThread(threads, { goalId: goal.id })

                    return (
                        <article key={goal.id} className="prototype-goal-card prototype-card">
                            <Link
                                to="/goals/$goalId"
                                params={{ goalId: goal.id }}
                                className="prototype-goal-card__link"
                            >
                                <div className="prototype-goal-card__head">
                                    <div className="prototype-goal-card__title">
                                        <div className="prototype-icon-pill">
                                            <Glyph name={goalGlyph(goal.id)} />
                                        </div>
                                        <div className="prototype-goal-card__title-copy">
                                            <h3>{view.title}</h3>
                                        </div>
                                    </div>
                                    <GoalStatusBadge status={goal.status} />
                                </div>
                            </Link>

                            <div className="prototype-goal-card__footer">
                                <span>{view.progressLabel}</span>
                                <div className="prototype-inline-actions prototype-inline-actions--compact">
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
                            </div>
                        </article>
                    )
                })}
            </div>
        </section>
    )
}

export function DailyDigestPanel(props: {
    window: PrototypeTimeWindow
    headline: string
    summary: string
}) {
    const { actions, clock } = usePrototypeStore()
    const windows: PrototypeTimeWindow[] = ['today', 'yesterday', 'last24h']

    return (
        <section className="prototype-panel prototype-panel--digest">
            <div className="prototype-section-head">
                <h2>{props.headline}</h2>
                <div className="prototype-tab-row">
                    {windows.map((window) => (
                        <button
                            key={window}
                            type="button"
                            className={window === clock.window ? 'is-active' : undefined}
                            onClick={() => actions.setTimeWindow(window)}
                        >
                            {labelTimeWindow(window)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="prototype-digest-hero">
                <strong>{labelTimeWindow(props.window)}</strong>
                <p>{props.summary}</p>
            </div>
        </section>
    )
}

export function StreamsOverviewPanel(props: {
    goals: PrototypeGoal[]
    streams: PrototypeStream[]
    checkpointId: PrototypeCheckpointId
}) {
    const { threads, actions } = usePrototypeStore()
    const [expandedId, setExpandedId] = useState<string | null>(props.streams[0]?.id ?? null)

    return (
        <section className="prototype-panel">
            <div className="prototype-section-head">
                <h2>执行流</h2>
            </div>

            <div className="prototype-stream-list">
                {props.streams.map((stream) => {
                    const goal = props.goals.find((item) => item.id === stream.goalId)
                    const view = streamPresentation(stream, props.checkpointId)
                    const expanded = expandedId === stream.id
                    const relatedThreads = getRelatedThreads(threads, { goalId: stream.goalId, streamId: stream.id })
                    const primaryThread = getPrimaryRelatedThread(threads, { goalId: stream.goalId, streamId: stream.id })
                    const unresolvedCount = countUnresolvedThreads(relatedThreads)

                    return (
                        <article key={stream.id} className="prototype-stream-card prototype-card">
                            <button
                                type="button"
                                className="prototype-stream-card__header"
                                onClick={() => setExpandedId(expanded ? null : stream.id)}
                            >
                                <div className="prototype-stream-card__title">
                                    <div className="prototype-icon-pill">
                                        <Glyph name={streamGlyph(stream.id)} />
                                    </div>
                                    <div className="prototype-stream-card__title-copy">
                                        <span>{goal ? goalTitle(goal.id) : '未命名目标'}</span>
                                        <h3>{view.title}</h3>
                                    </div>
                                </div>
                                <div className="prototype-stream-card__status">
                                    <StreamStatusBadge status={stream.status} />
                                    <SparkBar value={stream.progress} />
                                    <strong>{stream.progress}%</strong>
                                </div>
                            </button>

                            {expanded ? (
                                <div className="prototype-stream-card__body">
                                    <div className="prototype-inline-note">
                                        <span>最新动作</span>
                                        <strong>{view.latestMove}</strong>
                                    </div>
                                    {view.dependencyLabel ? (
                                        <div className="prototype-inline-note">
                                            <span>依赖</span>
                                            <strong>{view.dependencyLabel}</strong>
                                        </div>
                                    ) : null}
                                    <div className="prototype-inline-actions">
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
                                        <Link to="/goals/$goalId/execution/$streamId" params={{ goalId: stream.goalId, streamId: stream.id }}>
                                            查看执行明细
                                        </Link>
                                    </div>
                                </div>
                            ) : null}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
