import { Link } from '@tanstack/react-router'
import type { OmcEvidence, OmcMergePacket, OmcPlanDetailResponse, OmcPlanRuntime } from '@hopi/protocol/types'

type ReviewCockpitProps = {
    programId: string
    plan: OmcPlanDetailResponse['plan']
    runtime: OmcPlanRuntime
    packet: OmcMergePacket
    evidence: OmcEvidence[]
    latestAttemptId: string | null
    latestSessionUrl: string | null
    actionError: string | null
    isApproveReviewPending: boolean
    isApproveMergePending: boolean
    isResumePending: boolean
    isBackToPlanningPending: boolean
    isTakeoverPending: boolean
    onApproveReview: () => void
    onApproveMerge: () => void
    onResumeLoop: () => void
    onBackToPlanning: () => void
    onTakeover: () => void
}

function formatNullableDate(timestamp: number | null | undefined): string {
    if (!timestamp) {
        return 'Not yet'
    }

    return new Date(timestamp).toLocaleString()
}

function getVerdictCopy(props: Pick<ReviewCockpitProps, 'runtime' | 'packet'>): string {
    if (props.runtime.mergeStatus === 'merged') {
        return 'Merge already landed. This card should now read as delivered rather than pending.'
    }

    if (props.runtime.mergeStatus === 'conflict') {
        return props.runtime.mergeBlockedReason ?? 'Merge conflicts are blocking landing. Resolve conflicts inside takeover while keeping review posture.'
    }

    if (props.runtime.mergeStatus === 'blocked') {
        return props.runtime.mergeBlockedReason ?? 'Merge is blocked by a non-conflict precondition. Fix the blocker or retry merge from review.'
    }

    if (!props.runtime.reviewApprovedAt) {
        return 'Human review has not been approved yet. Start with the review decision before merge approval.'
    }

    return props.packet.blockers.length === 0
        ? 'Human review is approved and the packet looks merge-ready.'
        : 'Human review is approved, but the packet still carries blockers that need operator attention.'
}

function getVerdictTone(runtime: OmcPlanRuntime): 'accent' | 'success' | 'warning' {
    if (runtime.mergeStatus === 'merged' || runtime.mergeStatus === 'ready') {
        return 'success'
    }

    if (runtime.mergeStatus === 'blocked' || runtime.mergeStatus === 'conflict' || runtime.reviewRequired) {
        return 'warning'
    }

    return 'accent'
}

function getConflictFiles(evidence: OmcEvidence[]): string[] {
    const latestConflict = evidence.find((item) => item.label === 'merge-conflict')
    const payloadFiles = latestConflict?.payload?.conflictFiles

    return Array.isArray(payloadFiles)
        ? payloadFiles.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
}

function renderPreconditionTone(status: OmcMergePacket['preconditions'][number]['status']): 'neutral' | 'success' | 'warning' {
    if (status === 'ready') {
        return 'success'
    }

    if (status === 'blocked') {
        return 'warning'
    }

    return 'neutral'
}

export default function ReviewCockpit(props: ReviewCockpitProps) {
    const verdictTone = getVerdictTone(props.runtime)
    const verdictCopy = getVerdictCopy(props)
    const conflictFiles = getConflictFiles(props.evidence)
    const mergeActionLabel = props.runtime.mergeStatus === 'conflict'
        ? 'Resolve conflicts'
        : props.runtime.mergeStatus === 'blocked'
            ? 'Retry merge'
            : 'Approve merge'
    const mergeActionPendingLabel = props.runtime.mergeStatus === 'conflict' ? 'Preparing…' : 'Applying…'

    return (
        <div className="omc-cockpit">
            <section className="omc-plan-hero">
                <p className="omc-phase__eyebrow">{props.plan.phaseLabel}</p>
                <h1>{props.plan.planTitle}</h1>
                <p>{verdictCopy}</p>
                <div className="omc-card__badges">
                    <span className={`omc-badge omc-badge--${verdictTone}`}>{props.runtime.mergeStatus ?? 'idle'}</span>
                    <span className={`omc-badge omc-badge--${props.runtime.reviewApprovedAt ? 'success' : 'warning'}`}>
                        {props.runtime.reviewApprovedAt ? 'review-approved' : 'review-pending'}
                    </span>
                    <span className="omc-badge omc-badge--neutral">{props.runtime.column}</span>
                    <span className="omc-badge omc-badge--neutral">attempts {props.packet.attemptCount}</span>
                </div>
                <div className="omc-action-row">
                    <button
                        type="button"
                        className="omc-primary-button"
                        disabled={props.isApproveReviewPending || Boolean(props.runtime.reviewApprovedAt)}
                        onClick={props.onApproveReview}
                    >
                        {props.runtime.reviewApprovedAt ? 'Review approved' : props.isApproveReviewPending ? 'Approving…' : 'Approve review'}
                    </button>
                    <button
                        type="button"
                        className="omc-primary-button"
                        disabled={props.isApproveMergePending || !props.runtime.reviewApprovedAt || props.runtime.mergeStatus === 'merged'}
                        onClick={props.runtime.mergeStatus === 'conflict' ? props.onTakeover : props.onApproveMerge}
                    >
                        {props.isApproveMergePending ? mergeActionPendingLabel : mergeActionLabel}
                    </button>
                    <button
                        type="button"
                        className="omc-secondary-button"
                        disabled={props.isResumePending}
                        onClick={props.onResumeLoop}
                    >
                        {props.isResumePending ? 'Resuming…' : 'Resume loop'}
                    </button>
                    <button
                        type="button"
                        className="omc-secondary-button"
                        disabled={props.isBackToPlanningPending}
                        onClick={props.onBackToPlanning}
                    >
                        {props.isBackToPlanningPending ? 'Returning…' : 'Back to planning'}
                    </button>
                    <button
                        type="button"
                        className={props.runtime.mergeStatus === 'conflict' ? 'omc-primary-button' : 'omc-secondary-button'}
                        disabled={props.isTakeoverPending}
                        onClick={props.onTakeover}
                    >
                        {props.isTakeoverPending ? 'Preparing…' : props.runtime.mergeStatus === 'conflict' ? 'Resolve conflicts' : 'Take over'}
                    </button>
                    {props.latestSessionUrl ? (
                        <a className="omc-secondary-link" href={props.latestSessionUrl}>
                            Open session
                        </a>
                    ) : null}
                    <Link
                        to="/programs/$programId/plans/$planKey"
                        params={{ programId: props.programId, planKey: props.plan.planKey }}
                        className="omc-secondary-link"
                    >
                        Back to plan
                    </Link>
                </div>
                {props.actionError ? <p className="omc-error-copy">{props.actionError}</p> : null}
            </section>

            <div className="omc-cockpit__hero-grid">
                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Decision posture</p>
                            <h2>Blockers and warnings</h2>
                        </div>
                    </div>
                    <div className="omc-cockpit__lists">
                        <div>
                            <h3>Blockers</h3>
                            {props.packet.blockers.length > 0 ? (
                                <ul className="omc-evidence-list">
                                    {props.packet.blockers.map((blocker) => (
                                        <li key={blocker}>
                                            <div className="omc-card__badges">
                                                <span className="omc-badge omc-badge--warning">blocked</span>
                                            </div>
                                            <strong>{blocker}</strong>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="omc-empty-copy">No active blockers in the current merge packet.</p>
                            )}
                        </div>
                        <div>
                            <h3>Warnings</h3>
                            {props.packet.warnings.length > 0 ? (
                                <ul className="omc-evidence-list">
                                    {props.packet.warnings.map((warning) => (
                                        <li key={warning}>
                                            <div className="omc-card__badges">
                                                <span className="omc-badge omc-badge--warning">warning</span>
                                            </div>
                                            <strong>{warning}</strong>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="omc-empty-copy">No warnings surfaced by the current merge packet.</p>
                            )}
                        </div>
                    </div>
                </section>

                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Checks</p>
                            <h2>Required check summary</h2>
                        </div>
                    </div>
                    <dl className="omc-facts">
                        <div><dt>Total checks</dt><dd>{props.packet.checksSummary.total}</dd></div>
                        <div><dt>Passed</dt><dd>{props.packet.checksSummary.passed}</dd></div>
                        <div><dt>Failed</dt><dd>{props.packet.checksSummary.failed}</dd></div>
                        <div><dt>Warnings</dt><dd>{props.packet.checksSummary.warning}</dd></div>
                        <div><dt>Skipped</dt><dd>{props.packet.checksSummary.skipped}</dd></div>
                        <div><dt>Completion summary</dt><dd>{props.packet.completionSummary.summary}</dd></div>
                    </dl>
                </section>
            </div>

            <div className="omc-cockpit__hero-grid">
                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Identity</p>
                            <h2>Branches and worktree</h2>
                        </div>
                    </div>
                    <dl className="omc-facts">
                        <div><dt>Source branch</dt><dd>{props.packet.sourceBranch ?? 'Not attached'}</dd></div>
                        <div><dt>Target branch</dt><dd>{props.packet.targetBranch ?? 'Not attached'}</dd></div>
                        <div><dt>Worktree</dt><dd>{props.packet.worktreePath ?? 'Not attached'}</dd></div>
                        <div><dt>Review approved</dt><dd>{formatNullableDate(props.runtime.reviewApprovedAt)}</dd></div>
                        <div><dt>Last merge attempt</dt><dd>{formatNullableDate(props.runtime.lastMergeAttemptAt)}</dd></div>
                        <div><dt>Merge blocker</dt><dd>{props.runtime.mergeBlockedReason ?? 'No active blocker'}</dd></div>
                    </dl>
                </section>

                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Attempts</p>
                            <h2>Attempt and changed-files summary</h2>
                        </div>
                    </div>
                    <dl className="omc-facts">
                        <div><dt>Attempt count</dt><dd>{props.packet.attemptCount}</dd></div>
                        <div><dt>Changed files</dt><dd>{props.packet.changedFilesSummary.totalFiles}</dd></div>
                        <div><dt>Last outcome</dt><dd>{props.packet.completionSummary.status ?? 'Not reported yet'}</dd></div>
                        <div><dt>Termination</dt><dd>{props.packet.completionSummary.terminationReason ?? 'Not reported yet'}</dd></div>
                        <div><dt>Next step</dt><dd>{props.packet.completionSummary.nextSuggestedStep ?? 'Not reported yet'}</dd></div>
                        {props.latestAttemptId ? (
                            <div>
                                <dt>Latest attempt</dt>
                                <dd>
                                    <Link to="/programs/$programId/attempts/$attemptId" params={{ programId: props.programId, attemptId: props.latestAttemptId }}>
                                        Open attempt inspector
                                    </Link>
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                    {props.packet.changedFilesSummary.files.length > 0 ? (
                        <ul className="omc-simple-list">
                            {props.packet.changedFilesSummary.files.slice(0, 8).map((filePath) => (
                                <li key={filePath}>{filePath}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No changed-file summary recorded yet.</p>
                    )}
                </section>
            </div>

            <div className="omc-cockpit__hero-grid">
                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Preconditions</p>
                            <h2>Merge gate checklist</h2>
                        </div>
                    </div>
                    <ul className="omc-evidence-list">
                        {props.packet.preconditions.map((precondition) => (
                            <li key={precondition.key}>
                                <div className="omc-card__badges">
                                    <span className={`omc-badge omc-badge--${renderPreconditionTone(precondition.status)}`}>{precondition.status}</span>
                                </div>
                                <strong>{precondition.label}</strong>
                                <p>{precondition.detail ?? 'No additional detail.'}</p>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Deep evidence</p>
                            <h2>Signals below the decision line</h2>
                        </div>
                    </div>
                    <ul className="omc-evidence-list">
                        {props.evidence.slice(0, 8).map((item) => (
                            <li key={item.id}>
                                <div className="omc-card__badges">
                                    <span className="omc-badge omc-badge--neutral">{item.kind}</span>
                                    <span className={`omc-badge omc-badge--${item.status === 'passed' ? 'success' : item.status === 'warning' || item.status === 'failed' ? 'warning' : 'neutral'}`}>
                                        {item.status}
                                    </span>
                                </div>
                                <strong>{item.label}</strong>
                                <p>{item.summary}</p>
                            </li>
                        ))}
                    </ul>
                    {conflictFiles.length > 0 ? (
                        <div className="omc-stack">
                            <div className="omc-key-value">
                                <span>Conflict files</span>
                                <strong>{conflictFiles.length} files need resolution.</strong>
                            </div>
                            <ul className="omc-simple-list">
                                {conflictFiles.map((filePath) => (
                                    <li key={filePath}>{filePath}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    )
}
