import {
    labelDirection,
    labelPriority
} from '@/prototype/presenter'
import type {
    PrototypeCheckpointId,
    PrototypeGoal,
    PrototypeStrategySnapshot
} from '@/prototype/types'
import { MetaBadge } from './StatusBadge'
import { Glyph } from './Visuals'

export default function StrategyPanel(props: {
    goal: PrototypeGoal
    strategy: PrototypeStrategySnapshot
    checkpointId: PrototypeCheckpointId
}) {
    void props.checkpointId

    return (
        <section className="flex flex-col gap-5 p-6 bg-white border border-zinc-200 rounded-xl shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100">
                <h2 className="text-xl font-semibold text-zinc-900">路线</h2>
                <div className="flex flex-wrap items-center gap-2">
                    <MetaBadge tone="neutral">优先级 · {labelPriority(props.goal.priority)}</MetaBadge>
                    <MetaBadge tone="neutral">路线 · {labelDirection(props.goal.direction)}</MetaBadge>
                </div>
            </div>

            <div className="flex items-start gap-4 p-4 sm:p-5 bg-indigo-50 border border-indigo-100 rounded-xl">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex-shrink-0 shadow-sm border border-indigo-200/50">
                    <Glyph name="strategy" />
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                    <h3 className="text-base font-bold text-indigo-900 leading-tight">{props.strategy.thesis}</h3>
                    <p className="text-sm text-indigo-700 leading-relaxed mt-1">{props.strategy.reason}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-2">
                <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">当前焦点</h3>
                    <div className="flex flex-wrap gap-2">
                        {props.strategy.focusAreas.map((item) => (
                            <span key={item} className="px-2.5 py-1 text-sm font-medium text-zinc-700 bg-zinc-100 border border-zinc-200 rounded-md whitespace-nowrap">{item}</span>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">今天动作</h3>
                    <div className="flex flex-wrap gap-2">
                        {props.strategy.todayMoves.map((item) => (
                            <span key={item} className="px-2.5 py-1 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md whitespace-nowrap">{item}</span>
                        ))}
                    </div>
                </section>
            </div>
        </section>
    )
}
