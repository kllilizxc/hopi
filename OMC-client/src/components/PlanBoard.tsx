import { Link } from '@tanstack/react-router'
import type {
    OmcGuidedPlanningRun,
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramOverviewResponse
} from '@hopi/protocol/types'
import PlanningBootstrapPanel from '@/components/PlanningBootstrapPanel'

type PlanBoardProps = {
    programId: string
    program: OmcProgramOverviewResponse['program']
    planning: OmcProgramOverviewResponse['planning']
    planningRun: OmcGuidedPlanningRun | null
    phases: OmcPlanningIndexResponse['phases']
    runtimes: Record<string, OmcPlanRuntime | undefined>
}

const BOARD_COLUMNS: Array<OmcPlanRuntime['column']> = ['Planning', 'Running', 'Review', 'Done']

function renderBadge(label: string, tone: 'neutral' | 'accent' | 'warning' | 'success' = 'neutral') {
    return <span className={`omc-badge omc-badge--${tone}`}>{label}</span>
}

function renderMergeBadge(runtime: OmcPlanRuntime | undefined) {
    if (!runtime) {
        return null
    }

    if (runtime.mergeStatus === 'ready') {
        return renderBadge('ready-to-merge', 'success')
    }

    if (runtime.mergeStatus === 'blocked') {
        return renderBadge('merge-blocked', 'warning')
    }

    if (runtime.mergeStatus === 'conflict') {
        return renderBadge('conflict', 'warning')
    }

    if (runtime.mergeStatus === 'merged') {
        return renderBadge('merged', 'success')
    }

    return null
}

export default function PlanBoard(props: PlanBoardProps) {
    if (props.phases.length === 0) {
        if (props.planning.hasPlans) {
            return (
                <section className="omc-panel omc-empty-panel">
                    <h2>Executable plan cards detected</h2>
                    <p>OMC is refreshing the planning index and handing you back to the normal board.</p>
                </section>
            )
        }

        return (
            <PlanningBootstrapPanel
                programId={props.programId}
                program={props.program}
                planning={props.planning}
                planningRun={props.planningRun}
            />
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
                                                        {runtime?.loopStatus ? renderBadge(runtime.loopStatus, runtime.loopStatus === 'review' ? 'warning' : runtime.loopStatus === 'running' ? 'accent' : 'neutral') : null}
                                                        {renderMergeBadge(runtime)}
                                                        {runtime?.attemptCount ? renderBadge(`attempts ${runtime.attemptCount}`, 'warning') : null}
                                                        {runtime?.reviewRequired ? renderBadge('needs-human', 'warning') : null}
                                                        {runtime?.reviewApprovedAt ? renderBadge('review-approved', 'success') : null}
                                                        {runtime?.consecutiveFailureCount ? renderBadge(`failures ${runtime.consecutiveFailureCount}`, 'warning') : null}
                                                        {runtime?.lastFailureFingerprint ? renderBadge(runtime.lastFailureFingerprint, 'warning') : null}
                                                    </div>
                                                    {plan.firstOpenItem ? (
                                                        <div className="omc-card__next">
                                                            <span>Next</span>
                                                            <strong>{plan.firstOpenItem}</strong>
                                                        </div>
                                                    ) : null}
                                                    {runtime?.latestEvidenceSummary ? (
                                                        <div className="omc-card__next">
                                                            <span>Signal</span>
                                                            <strong>{runtime.latestEvidenceSummary}</strong>
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
