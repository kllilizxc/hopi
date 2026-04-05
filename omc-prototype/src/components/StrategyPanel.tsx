import {
    labelDirection,
    labelPriority,
    strategyPresentation
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
    const view = strategyPresentation(
        props.goal.id,
        props.checkpointId,
        props.goal.direction,
        props.goal.priority
    )

    return (
        <section className="prototype-panel">
            <div className="prototype-section-head">
                <h2>路线</h2>
                <div className="prototype-badge-row">
                    <MetaBadge tone="neutral">优先级 · {labelPriority(props.goal.priority)}</MetaBadge>
                    <MetaBadge tone="neutral">路线 · {labelDirection(props.goal.direction)}</MetaBadge>
                </div>
            </div>

            <div className="prototype-strategy-callout">
                <div className="prototype-icon-pill prototype-icon-pill--large">
                    <Glyph name="strategy" />
                </div>
                <div>
                    <h3>{view.thesis}</h3>
                    <p>{view.reason}</p>
                </div>
            </div>
        </section>
    )
}
