import {
    labelPhaseStatus,
    labelPlanBadge,
    labelPlanColumn,
    phasePresentation,
    planPresentation
} from '@/prototype/presenter'
import { useOperatorSurface } from './operator/OperatorSurfaceContext'
import type { PrototypePhase, PrototypePlanCard, PrototypePlanColumn } from '@/prototype/types'
import { MetaBadge } from './StatusBadge'
import { Glyph } from './Visuals'

const COLUMNS: PrototypePlanColumn[] = ['Planning', 'Running', 'Review', 'Done']

export default function ExecutionBoard(props: {
    phases: PrototypePhase[]
    planCards: PrototypePlanCard[]
}) {
    const operatorSurface = useOperatorSurface()

    return (
        <div className="flex flex-col gap-6 h-full overflow-hidden w-full max-w-[1600px] mx-auto">
            <section className="flex flex-col gap-4 flex-shrink-0">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                    <h2 className="text-xl font-semibold text-zinc-900">阶段</h2>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
                    {props.phases.map((phase) => {
                        const view = phasePresentation(phase)

                        return (
                            <article key={phase.id} className="flex flex-col flex-shrink-0 w-80 p-5 bg-white border border-zinc-200 rounded-xl shadow-sm snap-start">
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-100 text-zinc-600 flex-shrink-0">
                                        <Glyph name="phase" />
                                    </div>
                                    <MetaBadge tone={phase.status === 'Done' ? 'success' : phase.status === 'Review' ? 'accent' : phase.status === 'Running' ? 'warning' : 'neutral'}>
                                        {labelPhaseStatus(phase.status)}
                                    </MetaBadge>
                                </div>
                                <h3 className="text-base font-semibold text-zinc-900 truncate mb-1">{view.title}</h3>
                                <p className="text-sm text-zinc-500 line-clamp-2">{phase.summary}</p>
                            </article>
                        )
                    })}
                </div>
            </section>

            <section className="flex gap-6 overflow-x-auto h-full pb-4 items-stretch">
                {COLUMNS.map((column) => (
                    <div key={column} className="flex flex-col gap-4 w-[320px] flex-shrink-0 h-full">
                        <div className="flex items-center justify-between pb-2 border-b border-zinc-200 sticky top-0 bg-zinc-50 z-10">
                            <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">{labelPlanColumn(column)}</h3>
                            <span className="flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-medium text-zinc-500 bg-zinc-200 rounded-full">
                                {props.planCards.filter((card) => card.column === column).length}
                            </span>
                        </div>

                        <div className="flex flex-col gap-3 overflow-y-auto pr-2 pb-12 h-full flex-1 content-start">
                            {props.planCards
                                .filter((card) => card.column === column)
                                .map((card) => {
                                    const view = planPresentation(card)
                                    const isActiveTrace = operatorSurface.activeTrace?.planId === card.id

                                    return (
                                        <button
                                            key={card.id}
                                            type="button"
                                            className={`flex flex-col gap-3 p-4 bg-white border rounded-lg shadow-sm text-left transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isActiveTrace ? 'border-indigo-500 ring-1 ring-indigo-500 shadow-md' : 'border-zinc-200 hover:border-zinc-300 hover:shadow-md'}`}
                                            aria-pressed={isActiveTrace}
                                            onClick={() => operatorSurface.openTrace({ planId: card.id, streamId: card.streamId })}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center justify-center w-6 h-6 rounded bg-zinc-100 text-zinc-500 flex-shrink-0">
                                                    <Glyph name="kanban" />
                                                </div>
                                                <span className="text-xs text-zinc-400 font-medium">{card.updatedAt}</span>
                                            </div>
                                            <h4 className="text-sm font-semibold text-zinc-900 line-clamp-2">{view.title}</h4>
                                            <p className="text-xs text-zinc-500 line-clamp-3 leading-relaxed">{card.summary}</p>

                                            {card.signal && (
                                                <strong className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md self-start">{card.signal}</strong>
                                            )}

                                            {card.badges.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    {card.badges.map((badge) => (
                                                        <MetaBadge key={badge}>{labelPlanBadge(badge)}</MetaBadge>
                                                    ))}
                                                </div>
                                            )}
                                        </button>
                                    )
                                })}
                        </div>
                    </div>
                ))}
            </section>
        </div>
    )
}
