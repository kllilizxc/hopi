import type { OmcAttempt, OmcEvidence } from '@hopi/protocol/types'

type AttemptInspectorProps = {
    attempt: OmcAttempt
    evidence: OmcEvidence[]
}

function formatDateTime(timestamp: number | null | undefined): string {
    if (!timestamp) {
        return 'Not yet'
    }

    return new Date(timestamp).toLocaleString()
}

function getBadgeTone(status: OmcEvidence['status']): 'neutral' | 'success' | 'warning' {
    if (status === 'passed') {
        return 'success'
    }
    if (status === 'failed' || status === 'warning') {
        return 'warning'
    }
    return 'neutral'
}

export default function AttemptInspector(props: AttemptInspectorProps) {
    const timeline = [
        {
            id: `${props.attempt.id}-created`,
            label: 'attempt created',
            summary: props.attempt.summary ?? 'Attempt created.',
            createdAt: props.attempt.createdAt
        },
        ...props.evidence.map((item) => ({
            id: item.id,
            label: item.label,
            summary: item.summary,
            createdAt: item.createdAt
        })),
        ...(props.attempt.completedAt
            ? [{
                id: `${props.attempt.id}-completed`,
                label: 'attempt completed',
                summary: props.attempt.status,
                createdAt: props.attempt.completedAt
            }]
            : [])
    ].sort((left, right) => left.createdAt - right.createdAt)

    const retryMemory = props.attempt.contextPack?.previousAttemptMemory ?? null
    const diffEvidence = props.evidence.find((item) => item.label === 'diff-summary')
    const diffFiles = Array.isArray(diffEvidence?.payload?.files)
        ? diffEvidence?.payload?.files as Array<{
            fullPath?: string
            linesAdded?: number
            linesRemoved?: number
        }>
        : []

    return (
        <div className="omc-attempt-inspector">
            <section className="omc-panel">
                <div className="omc-panel__header">
                    <div>
                        <p className="omc-phase__eyebrow">Attempt</p>
                        <h2>{props.attempt.id}</h2>
                    </div>
                    <div className="omc-card__badges">
                        <span className="omc-badge omc-badge--accent">{props.attempt.status}</span>
                        <span className="omc-badge omc-badge--neutral">#{props.attempt.attemptNumber}</span>
                        {props.attempt.terminationReason ? <span className="omc-badge omc-badge--warning">{props.attempt.terminationReason}</span> : null}
                    </div>
                </div>

                <dl className="omc-facts">
                    <div><dt>Session</dt><dd>{props.attempt.sessionId ?? 'Not attached'}</dd></div>
                    <div><dt>Started</dt><dd>{formatDateTime(props.attempt.createdAt)}</dd></div>
                    <div><dt>Updated</dt><dd>{formatDateTime(props.attempt.updatedAt)}</dd></div>
                    <div><dt>Completed</dt><dd>{formatDateTime(props.attempt.completedAt)}</dd></div>
                    <div><dt>Failure</dt><dd>{props.attempt.failureFingerprint ?? 'None'}</dd></div>
                    <div><dt>Termination</dt><dd>{props.attempt.terminationReason ?? 'Not reported yet'}</dd></div>
                    <div><dt>Next step</dt><dd>{props.attempt.nextSuggestedStep ?? 'Not reported yet'}</dd></div>
                </dl>
            </section>

            <div className="omc-plan-layout">
                <section className="omc-panel">
                    <h2>Context pack</h2>
                    {props.attempt.contextPack ? (
                        <div className="omc-stack">
                            <div className="omc-key-value">
                                <span>Workspace</span>
                                <strong>{props.attempt.contextPack.workspace.worktreePath ?? props.attempt.contextPack.workspace.repoRoot}</strong>
                            </div>
                            <div className="omc-key-value">
                                <span>Current objective</span>
                                <strong>{props.attempt.contextPack.currentObjective.smallestNextStep ?? props.attempt.contextPack.currentObjective.summary}</strong>
                            </div>
                            <div className="omc-key-value">
                                <span>Required checks</span>
                                <strong>{props.attempt.contextPack.acceptanceAndChecks.requiredChecks.join(', ') || 'Agent chooses relevant checks'}</strong>
                            </div>
                            <div className="omc-panel__subsection">
                                <h3>Prompt</h3>
                                <pre className="omc-code-block">{props.attempt.contextPack.promptText}</pre>
                            </div>
                        </div>
                    ) : (
                        <p className="omc-empty-copy">No context pack captured for this attempt.</p>
                    )}
                </section>

                <section className="omc-panel">
                    <h2>Retry memory</h2>
                    {retryMemory ? (
                        <div className="omc-stack">
                            <div className="omc-key-value">
                                <span>Previous attempt</span>
                                <strong>{retryMemory.attemptId}</strong>
                            </div>
                            <div className="omc-key-value">
                                <span>Summary</span>
                                <strong>{retryMemory.summary ?? 'No summary captured'}</strong>
                            </div>
                            <div className="omc-key-value">
                                <span>Failure fingerprint</span>
                                <strong>{retryMemory.failureFingerprint ?? 'None'}</strong>
                            </div>
                            <div className="omc-key-value">
                                <span>Suggested next step</span>
                                <strong>{retryMemory.nextSuggestedStep ?? 'Not carried forward'}</strong>
                            </div>
                        </div>
                    ) : (
                        <p className="omc-empty-copy">No previous-attempt retry memory was attached to this attempt.</p>
                    )}
                </section>
            </div>

            <div className="omc-plan-layout">
                <section className="omc-panel">
                    <h2>Changed files</h2>
                    {props.attempt.changedFiles.length > 0 ? (
                        <ul className="omc-simple-list">
                            {props.attempt.changedFiles.map((filePath) => (
                                <li key={filePath}>{filePath}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No changed file summary captured yet.</p>
                    )}
                </section>

                <section className="omc-panel">
                    <h2>Diff summary</h2>
                    {diffFiles.length > 0 ? (
                        <ul className="omc-evidence-list">
                            {diffFiles.map((item) => (
                                <li key={item.fullPath ?? `${item.linesAdded}-${item.linesRemoved}`}>
                                    <strong>{item.fullPath ?? 'Unknown file'}</strong>
                                    <p>{`+${item.linesAdded ?? 0} / -${item.linesRemoved ?? 0}`}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No diff summary was harvested for this attempt.</p>
                    )}
                </section>
            </div>

            <div className="omc-plan-layout">
                <section className="omc-panel">
                    <h2>Evidence</h2>
                    {props.evidence.length > 0 ? (
                        <ul className="omc-evidence-list">
                            {props.evidence.map((item) => (
                                <li key={item.id}>
                                    <div className="omc-card__badges">
                                        <span className="omc-badge omc-badge--neutral">{item.kind}</span>
                                        <span className={`omc-badge omc-badge--${getBadgeTone(item.status)}`}>{item.status}</span>
                                    </div>
                                    <strong>{item.label}</strong>
                                    <p>{item.summary}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No evidence entries yet.</p>
                    )}
                </section>

                <section className="omc-panel">
                    <h2>Checks</h2>
                    {props.attempt.checks.length > 0 ? (
                        <ul className="omc-evidence-list">
                            {props.attempt.checks.map((check) => (
                                <li key={check.label}>
                                    <div className="omc-card__badges">
                                        <span className={`omc-badge omc-badge--${check.result === 'passed' ? 'success' : check.result === 'failed' ? 'warning' : 'neutral'}`}>{check.result}</span>
                                    </div>
                                    <strong>{check.label}</strong>
                                    <p>{check.detail ?? 'No extra detail reported.'}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="omc-empty-copy">No check output has been reported yet.</p>
                    )}
                </section>
            </div>

            <section className="omc-panel">
                <h2>Timeline</h2>
                <ul className="omc-timeline">
                    {timeline.map((item) => (
                        <li key={item.id}>
                            <span>{item.label}</span>
                            <strong>{item.summary}</strong>
                            <small>{formatDateTime(item.createdAt)}</small>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}
