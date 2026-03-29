import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import AttemptInspector from '@/components/AttemptInspector'
import { useOmcApi } from '@/api/client'

export default function AttemptPage() {
    const api = useOmcApi()
    const { programId, attemptId } = useParams({ from: '/programs/$programId/attempts/$attemptId' })
    const attemptQuery = useQuery({
        queryKey: ['omc', 'attempt', attemptId],
        queryFn: () => api.getAttempt(attemptId)
    })

    if (attemptQuery.isLoading) {
        return <div className="omc-empty">Loading attempt…</div>
    }

    if (attemptQuery.error || !attemptQuery.data) {
        return <div className="omc-empty">Could not load this attempt.</div>
    }

    const { attempt, evidence } = attemptQuery.data

    return (
        <div className="omc-plan-page">
            <section className="omc-plan-hero">
                <p className="omc-phase__eyebrow">Attempt inspector</p>
                <h1>{attempt.id}</h1>
                <p>Execution-first attempt detail with context pack, evidence, and timeline.</p>
                <div className="omc-card__badges">
                    <span className="omc-badge omc-badge--accent">{attempt.status}</span>
                    <span className="omc-badge omc-badge--neutral">{attempt.planKey}</span>
                </div>
                <div className="omc-inline-links">
                    <Link to="/programs/$programId/plans/$planKey" params={{ programId, planKey: attempt.planKey }}>
                        Back to plan
                    </Link>
                </div>
            </section>

            <AttemptInspector attempt={attempt} evidence={evidence} />
        </div>
    )
}
