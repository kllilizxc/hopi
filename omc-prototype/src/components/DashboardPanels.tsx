import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
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
    const { threads } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                <h2 className="text-xl font-semibold text-zinc-900">目标</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {props.goals.map((goal) => {
                    const view = goalPresentation(goal, props.checkpointId)
                    const relatedThreads = getRelatedThreads(threads, { goalId: goal.id })
                    const unresolvedCount = countUnresolvedThreads(relatedThreads)
                    const primaryThread = getPrimaryRelatedThread(threads, { goalId: goal.id })

                    return (
                        <article key={goal.id} className="flex flex-col bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
                            <Link
                                to="/goals/$goalId"
                                params={{ goalId: goal.id }}
                                className="flex flex-col p-5 gap-4 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t-xl"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 min-w-0">
                                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-100 text-zinc-600 flex-shrink-0">
                                            <Glyph name={goalGlyph(goal.id)} />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <h3 className="text-base font-semibold text-zinc-900 truncate">{view.title}</h3>
                                            <p className="text-sm text-zinc-500 line-clamp-2 mt-1">{view.headline}</p>
                                        </div>
                                    </div>
                                    <GoalStatusBadge status={goal.status} />
                                </div>
                            </Link>

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-zinc-50 border-t border-zinc-100">
                                <span className="text-sm font-medium text-zinc-700">{view.progressLabel}</span>
                                <div className="flex flex-wrap items-center gap-2">
                                    {relatedThreads.length > 0 ? (
                                        <MetaBadge tone="neutral">
                                            {unresolvedCount > 0 ? `${unresolvedCount} 条待处理线程` : `${relatedThreads.length} 条相关线程`}
                                        </MetaBadge>
                                    ) : null}
                                    <Link
                                        to="/goals/$goalId"
                                        params={{ goalId: goal.id }}
                                        className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                                    >
                                        查看目标
                                    </Link>
                                    {primaryThread ? (
                                            <button
                                                type="button"
                                                className="px-4 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded hover:bg-zinc-50 shadow-sm transition-colors cursor-pointer whitespace-nowrap flex-shrink-0"
                                                onClick={() => operatorSurface.openThread(primaryThread.id)}
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
        <section className="flex flex-col gap-5 p-6 bg-white border border-zinc-200 rounded-xl shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100">
                <h2 className="text-xl font-semibold text-zinc-900">{props.headline}</h2>
                <div className="flex items-center bg-zinc-100 p-1 rounded-lg">
                    {windows.map((window) => (
                        <button
                            key={window}
                            type="button"
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer min-w-[64px] ${window === clock.window ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
                            onClick={() => actions.setTimeWindow(window)}
                        >
                            {labelTimeWindow(window)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-3 py-4">
                <strong className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">{labelTimeWindow(props.window)}</strong>
                <p className="text-base text-zinc-700 leading-relaxed max-w-3xl">{props.summary}</p>
            </div>
        </section>
    )
}

export function StreamsOverviewPanel(props: {
    goals: PrototypeGoal[]
    streams: PrototypeStream[]
    checkpointId: PrototypeCheckpointId
}) {
    const { threads } = usePrototypeStore()
    const operatorSurface = useOperatorSurface()
    const [expandedId, setExpandedId] = useState<string | null>(props.streams[0]?.id ?? null)

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                <h2 className="text-xl font-semibold text-zinc-900">执行流</h2>
            </div>

            <div className="flex flex-col gap-4">
                {props.streams.map((stream) => {
                    const goal = props.goals.find((item) => item.id === stream.goalId)
                    const view = streamPresentation(stream, props.checkpointId)
                    const expanded = expandedId === stream.id
                    const relatedThreads = getRelatedThreads(threads, { goalId: stream.goalId, streamId: stream.id })
                    const primaryThread = getPrimaryRelatedThread(threads, { goalId: stream.goalId, streamId: stream.id })
                    const unresolvedCount = countUnresolvedThreads(relatedThreads)

                    return (
                        <article key={stream.id} className={`flex flex-col bg-white border border-zinc-200 rounded-xl shadow-sm transition-all duration-200 overflow-hidden ${expanded ? 'ring-2 ring-blue-500/20' : 'hover:border-zinc-300'}`}>
                            <button
                                type="button"
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 w-full text-left focus:outline-none focus-visible:bg-zinc-50 transition-colors"
                                onClick={() => setExpandedId(expanded ? null : stream.id)}
                            >
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0">
                                        <Glyph name={streamGlyph(stream.id)} />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-medium text-zinc-500 truncate mb-0.5">{goal ? goalTitle(goal.id) : '未命名目标'}</span>
                                        <h3 className="text-base font-semibold text-zinc-900 truncate">{view.title}</h3>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 flex-shrink-0">
                                    <StreamStatusBadge status={stream.status} />
                                    <div className="hidden sm:flex items-center gap-3">
                                        <SparkBar value={stream.progress} />
                                        <strong className="text-sm font-medium text-zinc-700 w-10 text-right">{stream.progress}%</strong>
                                    </div>
                                </div>
                            </button>

                            {expanded ? (
                                <div className="flex flex-col gap-4 p-5 pt-0 bg-white border-t border-zinc-100">
                                    <p className="text-sm text-zinc-600 leading-relaxed max-w-3xl mt-4">{view.summary}</p>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="flex flex-col gap-1 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                                            <span className="text-xs font-medium text-zinc-500 uppercase">当前推进</span>
                                            <strong className="text-sm font-medium text-zinc-900">{view.latestMove}</strong>
                                        </div>
                                        {view.dependencyLabel ? (
                                            <div className="flex flex-col gap-1 p-3 bg-orange-50 rounded-lg border border-orange-100">
                                                <span className="text-xs font-medium text-orange-600 uppercase">依赖</span>
                                                <strong className="text-sm font-medium text-orange-900">{view.dependencyLabel}</strong>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 mt-2 pt-4 border-t border-zinc-100">
                                        {relatedThreads.length > 0 ? (
                                            <MetaBadge tone="neutral">
                                                {unresolvedCount > 0 ? `${unresolvedCount} 条待处理线程` : `${relatedThreads.length} 条相关线程`}
                                            </MetaBadge>
                                        ) : null}
                                        {primaryThread ? (
                                            <button
                                                type="button"
                                                className="px-4 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors cursor-pointer whitespace-nowrap flex-shrink-0"
                                                onClick={() => operatorSurface.openThread(primaryThread.id)}
                                            >
                                                打开线程
                                            </button>
                                        ) : null}
                                        <Link
                                            to="/goals/$goalId/execution/$streamId"
                                            params={{ goalId: stream.goalId, streamId: stream.id }}
                                            className="px-4 py-1.5 text-sm font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 shadow-sm transition-colors ml-auto sm:ml-0 cursor-pointer whitespace-nowrap text-center flex-shrink-0 text-white"
                                        >
                                            看执行明细
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-5 pb-5 pt-0">
                                    <p className="text-sm text-zinc-500 truncate">{view.summary}</p>
                                </div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
