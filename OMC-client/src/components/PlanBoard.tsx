import { Link } from '@tanstack/react-router'
import type { OmcPlanRuntime, OmcPlanningIndexResponse } from '@hopi/protocol/types'

type PlanBoardProps = {
    programId: string
    phases: OmcPlanningIndexResponse['phases']
    runtimes: Record<string, OmcPlanRuntime | undefined>
}

const BOARD_COLUMNS: Array<OmcPlanRuntime['column']> = ['Planning', 'Running', 'Review', 'Done']

function renderBadge(label: string, tone: 'neutral' | 'accent' | 'warning' | 'success' = 'neutral') {
    return <span className={`omc-badge omc-badge--${tone}`}>{label}</span>
}

export default function PlanBoard(props: PlanBoardProps) {
    if (props.phases.length === 0) {
        return (
            <section className="omc-panel omc-empty-panel">
                <h2>No plans found yet</h2>
                <p>
                    OMC did load the program, but it could not find a usable markdown planning tree with
                    `phases/*-PLAN.md` cards. Check the program planning root or set `HOPI_OMC_PLANNING_ROOT`
                    before starting the hub.
                </p>
            </section>
        )
    }

    return (
        <div className="omc-board">
            {props.phases.map((phase) => (
                <section key={phase.phaseKey} className="omc-phase">
                    <header className="omc-phase__header">
                        <div>
                            <p className="omc-phase__eyebrow">{phase.phaseKey}</p>
                            <h2>{phase.phaseLabel}</h2>
                        </div>
                        <p className="omc-phase__count">{phase.plans.length} plans</p>
                    </header>

                    <div className="omc-phase__grid">
                        {BOARD_COLUMNS.map((column) => (
                            <div key={column} className="omc-column">
                                <div className="omc-column__header">
                                    <h3>{column}</h3>
                                </div>

                                <div className="omc-column__body">
                                    {phase.plans
                                        .filter((plan) => (props.runtimes[plan.planKey]?.column ?? (plan.checklistOpen === 0 ? 'Done' : 'Planning')) === column)
                                        .map((plan) => {
                                            const runtime = props.runtimes[plan.planKey]
                                            const isReadyToRun = (runtime?.column ?? 'Planning') === 'Planning' && plan.checklistOpen > 0

                                            return (
                                                <Link
                                                    key={plan.planKey}
                                                    to="/programs/$programId/plans/$planKey"
                                                    params={{ programId: props.programId, planKey: plan.planKey }}
                                                    className="omc-card"
                                                >
                                                    <div className="omc-card__meta">
                                                        <span>{plan.planKey}</span>
                                                        <span>{new Date(plan.lastModifiedAt).toLocaleDateString()}</span>
                                                    </div>
                                                    <h4>{plan.planTitle}</h4>
                                                    <p>{plan.summary}</p>
                                                    <div className="omc-card__badges">
                                                        {isReadyToRun ? renderBadge('ready-to-run', 'accent') : null}
                                                        {renderBadge(`${plan.checklistDone}/${plan.checklistTotal} tasks`, plan.checklistOpen === 0 ? 'success' : 'neutral')}
                                                        {runtime?.attemptCount ? renderBadge(`attempts ${runtime.attemptCount}`, 'warning') : null}
                                                        {runtime?.lastFailureFingerprint ? renderBadge(runtime.lastFailureFingerprint, 'warning') : null}
                                                    </div>
                                                    {plan.firstOpenItem ? (
                                                        <div className="omc-card__next">
                                                            <span>Next</span>
                                                            <strong>{plan.firstOpenItem}</strong>
                                                        </div>
                                                    ) : null}
                                                </Link>
                                            )
                                        })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}
