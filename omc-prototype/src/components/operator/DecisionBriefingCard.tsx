import { useState } from 'react'
import type { DecisionBriefing } from '@/prototype/types'

function renderIdentityItems(briefing: DecisionBriefing) {
    return [
        briefing.identity.projectLabel ? `项目：${briefing.identity.projectLabel}` : null,
        briefing.identity.goalLabel ? `目标：${briefing.identity.goalLabel}` : null,
        briefing.identity.planLabel ? `计划：${briefing.identity.planLabel}` : null,
        briefing.identity.attemptNumber ? `Attempt：#${briefing.identity.attemptNumber}` : null,
        briefing.identity.sessionId ? `Session：${briefing.identity.sessionId}` : null,
    ].filter((item): item is string => Boolean(item))
}

export default function DecisionBriefingCard(props: {
    briefing: DecisionBriefing
    onOpenSessionLog?: (() => void) | undefined
    onOpenTrace?: (() => void) | undefined
}) {
    const [expanded, setExpanded] = useState(props.briefing.rawEvidence.defaultExpanded)
    const identityItems = renderIdentityItems(props.briefing)

    return (
        <section className="prototype-decision-briefing">
            {identityItems.length ? (
                <div className="prototype-decision-briefing__identity">
                    {identityItems.map((item) => (
                        <span key={item} className="prototype-decision-briefing__identity-pill">{item}</span>
                    ))}
                </div>
            ) : null}

            <dl className="prototype-decision-briefing__rows">
                <div className="prototype-decision-briefing__row">
                    <dt>发生了什么</dt>
                    <dd>{props.briefing.summaryRows.whatHappened}</dd>
                </div>
                <div className="prototype-decision-briefing__row">
                    <dt>为什么会找你</dt>
                    <dd>{props.briefing.summaryRows.whyEscalated}</dd>
                </div>
                <div className="prototype-decision-briefing__row">
                    <dt>系统建议</dt>
                    <dd>{props.briefing.summaryRows.recommendedAction}</dd>
                </div>
                <div className="prototype-decision-briefing__row">
                    <dt>当前影响</dt>
                    <dd>{props.briefing.summaryRows.currentImpact}</dd>
                </div>
            </dl>

            {(props.briefing.primaryAction || props.briefing.secondaryAction) ? (
                <div className="prototype-decision-briefing__actions">
                    <p className="prototype-decision-briefing__actions-label">按钮含义</p>
                    {props.briefing.primaryAction ? (
                        <p className="prototype-decision-briefing__action-copy">
                            <strong>{props.briefing.primaryAction.label}</strong>
                            <span>{props.briefing.primaryAction.helper}</span>
                        </p>
                    ) : null}
                    {props.briefing.secondaryAction ? (
                        <p className="prototype-decision-briefing__action-copy">
                            <strong>{props.briefing.secondaryAction.label}</strong>
                            <span>{props.briefing.secondaryAction.helper}</span>
                        </p>
                    ) : null}
                </div>
            ) : null}

            <div className="prototype-decision-briefing__evidence">
                <button
                    type="button"
                    className="prototype-button--ghost prototype-decision-briefing__toggle"
                    onClick={() => setExpanded((value) => !value)}
                >
                    查看原始依据
                </button>
                <p className="prototype-decision-briefing__evidence-helper">
                    给需要排查底层运行问题时使用；不是给你拍板用的主说明。
                </p>
                {expanded ? (
                    <div className="prototype-decision-briefing__evidence-body">
                        {props.briefing.rawEvidence.summary ? (
                            <pre className="prototype-decision-briefing__evidence-copy">{props.briefing.rawEvidence.summary}</pre>
                        ) : null}
                        {props.briefing.rawEvidence.terminationReason ? (
                            <p className="prototype-decision-briefing__evidence-line">
                                termination reason: {props.briefing.rawEvidence.terminationReason}
                            </p>
                        ) : null}
                        {props.briefing.rawEvidence.nextSuggestedStep ? (
                            <p className="prototype-decision-briefing__evidence-line">
                                next suggested step: {props.briefing.rawEvidence.nextSuggestedStep}
                            </p>
                        ) : null}
                        {props.briefing.rawEvidence.failureFingerprint ? (
                            <p className="prototype-decision-briefing__evidence-line">
                                failure fingerprint: {props.briefing.rawEvidence.failureFingerprint}
                            </p>
                        ) : null}
                        {(props.onOpenSessionLog || props.onOpenTrace) ? (
                            <div className="prototype-decision-briefing__evidence-actions">
                                {props.onOpenSessionLog ? (
                                    <button
                                        type="button"
                                        className="prototype-button--ghost"
                                        onClick={props.onOpenSessionLog}
                                    >
                                        打开执行日志
                                    </button>
                                ) : null}
                                {props.onOpenTrace ? (
                                    <button
                                        type="button"
                                        className="prototype-button--ghost"
                                        onClick={props.onOpenTrace}
                                    >
                                        打开原始轨迹
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </section>
    )
}
