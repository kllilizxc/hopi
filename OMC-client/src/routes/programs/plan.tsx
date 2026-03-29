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

export default function PlanPage() {
    const api = useOmcApi()
    const queryClient = useQueryClient()
    const { programId, planKey } = useParams({ from: '/programs/$programId/plans/$planKey' })
    const planQuery = useQuery({
        queryKey: ['omc', 'plan', programId, planKey],
        queryFn: () => api.getPlanDetail(programId, planKey)
    })
    const startMutation = useMutation({
        mutationFn: () => api.startPlan(programId, planKey),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['omc', 'plan', programId, planKey] }),
                queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', programId] }),
                queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', programId] })
            ])
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

    return (
        <div className="omc-plan-page">
            <section className="omc-plan-hero">
                <p className="omc-phase__eyebrow">{plan.phaseLabel}</p>
                <h1>{plan.planTitle}</h1>
                <p>{plan.summary}</p>
                <div className="omc-card__badges">
                    <span className="omc-badge omc-badge--accent">{runtime.column}</span>
                    <span className="omc-badge omc-badge--neutral">attempts {runtime.attemptCount}</span>
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
                        <button
                            type="button"
                            className="omc-primary-button"
                            disabled={startMutation.isPending || runtime.loopStatus === 'running'}
                            onClick={() => startMutation.mutate()}
                        >
                            {runtime.loopStatus === 'running'
                                ? 'Loop running'
                                : startMutation.isPending
                                    ? 'Starting…'
                                    : 'Start plan'}
                        </button>
                    </div>
                    {startMutation.error ? (
                        <p className="omc-error-copy">{startMutation.error instanceof Error ? startMutation.error.message : 'Could not start this plan.'}</p>
                    ) : null}
                    <dl className="omc-facts">
                        <div><dt>Loop status</dt><dd>{runtime.loopStatus}</dd></div>
                        <div><dt>Current branch</dt><dd>{runtime.currentBranch ?? 'Not assigned'}</dd></div>
                        <div><dt>Worktree</dt><dd>{runtime.currentWorktreePath ?? 'Not assigned'}</dd></div>
                        <div><dt>Last attempt</dt><dd>{formatNullableDate(runtime.lastAttemptAt)}</dd></div>
                        <div><dt>Review required</dt><dd>{runtime.reviewRequired ? 'Yes' : 'No'}</dd></div>
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
                <AttemptInspector
                    attempt={latestAttempt}
                    evidence={evidence.filter((item) => item.attemptId === latestAttempt.id)}
                />
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
                </section>
            </div>
        </div>
    )
}
