import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import AttemptInspector from '@/components/AttemptInspector'
import { useOmcApi } from '@/api/client'

function formatNullableDate(timestamp: number | null | undefined): string {
    if (!timestamp) {
        return 'Not yet'
    }
    return new Date(timestamp).toLocaleString()
}

function getMergeStatusLabel(runtime: {
    reviewApprovedAt?: number | null
    mergeStatus?: string | null
}): string | null {
    if (runtime.mergeStatus === 'ready') {
        return 'ready-to-merge'
    }
    if (runtime.mergeStatus === 'blocked') {
        return 'merge-blocked'
    }
    if (runtime.mergeStatus === 'conflict') {
        return 'conflict'
    }
    if (runtime.mergeStatus === 'merged') {
        return 'merged'
    }
    if (runtime.reviewApprovedAt) {
        return 'review-approved'
    }
    return null
}

export default function PlanPage() {
    const api = useOmcApi()
    const queryClient = useQueryClient()
    const { programId, planKey } = useParams({ from: '/programs/$programId/plans/$planKey' })

    const invalidatePlanQueries = async (attemptId?: string | null) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'plan', programId, planKey] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', programId] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', programId] }),
            ...(attemptId ? [queryClient.invalidateQueries({ queryKey: ['omc', 'attempt', attemptId] })] : [])
        ])
    }

    const planQuery = useQuery({
        queryKey: ['omc', 'plan', programId, planKey],
        queryFn: () => api.getPlanDetail(programId, planKey)
    })

    const startMutation = useMutation({
        mutationFn: () => api.startPlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidatePlanQueries(result.attempt.id)
        }
    })

    const retryMutation = useMutation({
        mutationFn: () => api.retryPlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidatePlanQueries(result.attempt?.id)
        }
    })

    const resumeMutation = useMutation({
        mutationFn: () => api.resumePlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidatePlanQueries(result.attempt?.id)
        }
    })

    const cancelMutation = useMutation({
        mutationFn: () => api.cancelPlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidatePlanQueries(result.attempt?.id)
        }
    })

    const takeoverMutation = useMutation({
        mutationFn: () => api.takeoverPlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidatePlanQueries(result.attempt?.id)
            const takeoverUrl = api.resolveAppUrl(result.sessionUrl) ?? api.createSessionUrl(result.sessionId)
            if (takeoverUrl) {
                window.location.assign(takeoverUrl)
            }
        }
    })

    if (planQuery.isLoading) {
        return <div className="omc-empty">Loading plan…</div>
    }

    if (planQuery.error || !planQuery.data) {
        return <div className="omc-empty">Could not load this plan.</div>
    }

    const { plan, runtime, attempts, evidence } = planQuery.data
    const latestAttempt = attempts[0] ?? null
    const latestAttemptEvidence = latestAttempt
        ? evidence.filter((item) => item.attemptId === latestAttempt.id)
        : []
    const openSessionUrl = api.createSessionUrl(latestAttempt?.sessionId)
    const reviewCockpitHref = `/programs/${encodeURIComponent(programId)}/plans/${encodeURIComponent(planKey)}/review`
    const mergeStatusLabel = getMergeStatusLabel(runtime)
    const mutationError = startMutation.error
        ?? retryMutation.error
        ?? resumeMutation.error
        ?? cancelMutation.error
        ?? takeoverMutation.error

    return (
        <div className="omc-plan-page">
            <section className="omc-plan-hero">
                <p className="omc-phase__eyebrow">{plan.phaseLabel}</p>
                <h1>{plan.planTitle}</h1>
                <p>{plan.summary}</p>
                <div className="omc-card__badges">
                    <span className="omc-badge omc-badge--accent">{runtime.column}</span>
                    <span className="omc-badge omc-badge--neutral">{runtime.loopStatus}</span>
                    <span className="omc-badge omc-badge--neutral">attempts {runtime.attemptCount}</span>
                    {runtime.reviewRequired ? <span className="omc-badge omc-badge--warning">needs-human</span> : null}
                    {mergeStatusLabel ? (
                        <span className={`omc-badge ${runtime.mergeStatus === 'ready' || runtime.mergeStatus === 'merged' || runtime.reviewApprovedAt ? 'omc-badge--success' : 'omc-badge--warning'}`}>
                            {mergeStatusLabel}
                        </span>
                    ) : null}
                    {runtime.consecutiveFailureCount > 0 ? <span className="omc-badge omc-badge--warning">failures {runtime.consecutiveFailureCount}</span> : null}
                    {runtime.lastFailureFingerprint ? <span className="omc-badge omc-badge--warning">{runtime.lastFailureFingerprint}</span> : null}
                </div>
            </section>

            <div className="omc-plan-layout">
                <section className="omc-panel">
                    <div className="omc-panel__header">
                        <div>
                            <p className="omc-phase__eyebrow">Runtime</p>
                            <h2>Control</h2>
                        </div>
                    </div>

                    {runtime.column === 'Review' ? (
                        <div className="omc-callout omc-callout--review">
                            <div>
                                <p className="omc-phase__eyebrow">Review posture</p>
                                <h3>Merge and reopen decisions moved into the cockpit.</h3>
                                <p>
                                    Keep this plan page as the runtime home, then step into the dedicated cockpit for
                                    `Approve review`, `Approve merge`, `Resume loop`, conflict resolution, and merge blockers.
                                </p>
                            </div>
                            <Link
                                to="/programs/$programId/plans/$planKey/review"
                                params={{ programId, planKey }}
                                className="omc-primary-link"
                            >
                                Open review cockpit
                            </Link>
                        </div>
                    ) : null}

                    <div className="omc-action-row">
                        <button
                            type="button"
                            className="omc-primary-button"
                            disabled={startMutation.isPending || runtime.loopStatus === 'running' || runtime.attemptCount > 0}
                            onClick={() => startMutation.mutate()}
                        >
                            {startMutation.isPending ? 'Starting…' : 'Start plan'}
                        </button>
                        <button
                            type="button"
                            className="omc-secondary-button"
                            disabled={resumeMutation.isPending || runtime.loopStatus === 'running'}
                            onClick={() => resumeMutation.mutate()}
                        >
                            {resumeMutation.isPending ? 'Resuming…' : 'Resume loop'}
                        </button>
                        <button
                            type="button"
                            className="omc-secondary-button"
                            disabled={retryMutation.isPending || runtime.loopStatus === 'running' || runtime.attemptCount === 0}
                            onClick={() => retryMutation.mutate()}
                        >
                            {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                        </button>
                        <button
                            type="button"
                            className="omc-secondary-button"
                            disabled={takeoverMutation.isPending}
                            onClick={() => takeoverMutation.mutate()}
                        >
                            {takeoverMutation.isPending ? 'Preparing…' : 'Take over'}
                        </button>
                        <button
                            type="button"
                            className="omc-secondary-button"
                            disabled={cancelMutation.isPending || runtime.loopStatus !== 'running'}
                            onClick={() => cancelMutation.mutate()}
                        >
                            {cancelMutation.isPending ? 'Canceling…' : 'Cancel'}
                        </button>
                        {openSessionUrl ? (
                            <a className="omc-secondary-link" href={openSessionUrl}>
                                Open session
                            </a>
                        ) : null}
                        {runtime.column === 'Review' ? (
                            <Link
                                to="/programs/$programId/plans/$planKey/review"
                                params={{ programId, planKey }}
                                className="omc-secondary-link"
                            >
                                Review cockpit
                            </Link>
                        ) : null}
                    </div>

                    {mutationError ? (
                        <p className="omc-error-copy">
                            {mutationError instanceof Error ? mutationError.message : 'Could not update this plan.'}
                        </p>
                    ) : null}

                    <dl className="omc-facts">
                        <div><dt>Loop status</dt><dd>{runtime.loopStatus}</dd></div>
                        <div><dt>Current branch</dt><dd>{runtime.currentBranch ?? 'Not assigned'}</dd></div>
                        <div><dt>Worktree</dt><dd>{runtime.currentWorktreePath ?? 'Not assigned'}</dd></div>
                        <div><dt>Last attempt</dt><dd>{formatNullableDate(runtime.lastAttemptAt)}</dd></div>
                        <div><dt>Review required</dt><dd>{runtime.reviewRequired ? 'Yes' : 'No'}</dd></div>
                        <div><dt>Review approved</dt><dd>{formatNullableDate(runtime.reviewApprovedAt)}</dd></div>
                        <div><dt>Merge posture</dt><dd>{runtime.mergeStatus ?? 'idle'}</dd></div>
                        <div><dt>Merge blocked</dt><dd>{runtime.mergeBlockedReason ?? 'No active merge blocker'}</dd></div>
                        <div><dt>Latest evidence</dt><dd>{runtime.latestEvidenceSummary ?? 'Not reported yet'}</dd></div>
                    </dl>
                </section>

                <section className="omc-panel">
                    <h2>Attempts</h2>
                    {attempts.length > 0 ? (
                        <ul className="omc-evidence-list">
                            {attempts.map((attempt) => (
                                <li key={attempt.id}>
                                    <div className="omc-card__badges">
                                        <span className="omc-badge omc-badge--accent">{attempt.status}</span>
                                        <span className="omc-badge omc-badge--neutral">#{attempt.attemptNumber}</span>
                                        {attempt.terminationReason ? <span className="omc-badge omc-badge--neutral">{attempt.terminationReason}</span> : null}
                                    </div>
                                    <strong>{attempt.summary ?? attempt.id}</strong>
                                    <p>{formatNullableDate(attempt.updatedAt)}</p>
                                    <div className="omc-inline-links">
                                        <Link
                                            to="/programs/$programId/attempts/$attemptId"
                                            params={{ programId, attemptId: attempt.id }}
                                        >
                                            Open attempt inspector
                                        </Link>
                                        {attempt.sessionId ? <a href={api.createSessionUrl(attempt.sessionId) ?? '#'}>Open session</a> : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No attempts yet. Start this plan to create the first manual Ralph loop attempt.</p>
                    )}
                </section>
            </div>

            {latestAttempt ? (
                <AttemptInspector attempt={latestAttempt} evidence={latestAttemptEvidence} />
            ) : null}

            <div className="omc-plan-layout">
                <section className="omc-panel">
                    <h2>Planning refs</h2>
                    <ul className="omc-simple-list">
                        <li>{plan.refs.projectPath}</li>
                        <li>{plan.refs.roadmapPath}</li>
                        {plan.refs.contextPath ? <li>{plan.refs.contextPath}</li> : null}
                        {plan.refs.researchPath ? <li>{plan.refs.researchPath}</li> : null}
                    </ul>
                </section>

                <section className="omc-panel">
                    <h2>Checklist</h2>
                    <ul className="omc-checklist">
                        {plan.checklist.map((item) => (
                            <li key={item.text} className={item.checked ? 'is-checked' : ''}>
                                <span>{item.checked ? 'Done' : 'Open'}</span>
                                <strong>{item.text}</strong>
                            </li>
                        ))}
                    </ul>
                    {runtime.column === 'Review' ? (
                        <div className="omc-inline-links">
                            <a className="omc-secondary-link" href={reviewCockpitHref}>Open review cockpit</a>
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    )
}
