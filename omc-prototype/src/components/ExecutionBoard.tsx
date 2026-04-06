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
        <div className="prototype-board-shell">
            <section className="prototype-panel prototype-panel--compact">
                <div className="prototype-section-head">
                    <h2>阶段</h2>
                </div>
                <div className="prototype-phase-strip">
                    {props.phases.map((phase) => {
                        const view = phasePresentation(phase)

                        return (
                            <article key={phase.id} className="prototype-phase-chip">
                                <div className="prototype-phase-chip__head">
                                    <div className="prototype-icon-pill">
                                        <Glyph name="phase" />
                                    </div>
                                    <MetaBadge tone={phase.status === 'Done' ? 'success' : phase.status === 'Review' ? 'accent' : phase.status === 'Running' ? 'warning' : 'neutral'}>
                                        {labelPhaseStatus(phase.status)}
                                    </MetaBadge>
                                </div>
                                <h3>{view.title}</h3>
                                <p className="prototype-phase-chip__summary">{phase.summary}</p>
                            </article>
                        )
                    })}
                </div>
            </section>

            <section className="prototype-kanban">
                {COLUMNS.map((column) => (
                    <div key={column} className="prototype-kanban__column">
                        <div className="prototype-kanban__header">
                            <h3>{labelPlanColumn(column)}</h3>
                        </div>

                        <div className="prototype-kanban__body">
                            {props.planCards
                                .filter((card) => card.column === column)
                                .map((card) => {
                                    const view = planPresentation(card)
                                    const isActiveTrace = operatorSurface.activeTrace?.planId === card.id

                                    return (
                                        <button
                                            key={card.id}
                                            type="button"
                                            className={`prototype-plan-card prototype-card prototype-plan-card--interactive${isActiveTrace ? ' is-active' : ''}`}
                                            aria-pressed={isActiveTrace}
                                            onClick={() => operatorSurface.openTrace({ planId: card.id, streamId: card.streamId })}
                                        >
                                            <div className="prototype-plan-card__header">
                                                <div className="prototype-icon-pill">
                                                    <Glyph name="kanban" />
                                                </div>
                                                <span>{card.updatedAt}</span>
                                            </div>
                                            <h4>{view.title}</h4>
                                            <p className="prototype-plan-card__summary">{card.summary}</p>
                                            <strong className="prototype-plan-card__signal">{card.signal}</strong>
                                            <div className="prototype-badge-row">
                                                {card.badges.map((badge) => (
                                                    <MetaBadge key={badge}>{labelPlanBadge(badge)}</MetaBadge>
                                                ))}
                                            </div>
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
