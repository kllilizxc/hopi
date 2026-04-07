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
        <section className="flex flex-col mx-auto max-w-3xl w-full my-6 bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
            {identityItems.length ? (
                <div className="flex flex-wrap gap-2 p-4 bg-zinc-50 border-b border-zinc-100">
                    {identityItems.map((item) => (
                        <span key={item} className="px-2 py-1 text-xs font-mono text-zinc-600 bg-white border border-zinc-200 rounded-md">
                            {item}
                        </span>
                    ))}
                </div>
            ) : null}

            <dl className="flex flex-col p-4 sm:p-6 gap-6">
                <div className="flex flex-col sm:flex-row sm:gap-6">
                    <dt className="text-sm font-semibold text-zinc-900 sm:w-32 flex-shrink-0">发生了什么</dt>
                    <dd className="text-sm text-zinc-700 leading-relaxed mt-1 sm:mt-0">{props.briefing.summaryRows.whatHappened}</dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-6">
                    <dt className="text-sm font-semibold text-zinc-900 sm:w-32 flex-shrink-0">为什么会找你</dt>
                    <dd className="text-sm text-zinc-700 leading-relaxed mt-1 sm:mt-0">{props.briefing.summaryRows.whyEscalated}</dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-6">
                    <dt className="text-sm font-semibold text-zinc-900 sm:w-32 flex-shrink-0">系统建议</dt>
                    <dd className="text-sm text-zinc-700 leading-relaxed mt-1 sm:mt-0">{props.briefing.summaryRows.recommendedAction}</dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-6">
                    <dt className="text-sm font-semibold text-zinc-900 sm:w-32 flex-shrink-0">当前影响</dt>
                    <dd className="text-sm text-zinc-700 leading-relaxed mt-1 sm:mt-0">{props.briefing.summaryRows.currentImpact}</dd>
                </div>
            </dl>

            {(props.briefing.primaryAction || props.briefing.secondaryAction) ? (
                <div className="flex flex-col p-4 sm:p-6 pt-0 gap-3">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">选项参考</p>
                    {props.briefing.primaryAction ? (
                        <p className="text-sm flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                            <strong className="text-zinc-900">{props.briefing.primaryAction.label}</strong>
                            <span className="text-zinc-500">{props.briefing.primaryAction.helper}</span>
                        </p>
                    ) : null}
                    {props.briefing.secondaryAction ? (
                        <p className="text-sm flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                            <strong className="text-zinc-900">{props.briefing.secondaryAction.label}</strong>
                            <span className="text-zinc-500">{props.briefing.secondaryAction.helper}</span>
                        </p>
                    ) : null}
                </div>
            ) : null}

            <div className="flex flex-col border-t border-zinc-200">
                <div className="flex items-center justify-between p-4 bg-zinc-50">
                    <button
                        type="button"
                        className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-2 focus:outline-none focus-visible:underline"
                        onClick={() => setExpanded((value) => !value)}
                    >
                        <span className={`transform transition-transform ${expanded ? 'rotate-90' : 'rotate-0'}`}>▶</span>
                        查看原始诊断依据
                    </button>
                    <p className="text-xs text-zinc-400 hidden sm:block">
                        技术排查参考，不需要用于日常决策
                    </p>
                </div>

                {expanded ? (
                    <div className="flex flex-col p-4 sm:p-6 gap-4 bg-zinc-900 text-zinc-300 font-mono text-xs overflow-x-auto">
                        {props.briefing.rawEvidence.summary ? (
                            <pre className="whitespace-pre-wrap text-zinc-100">{props.briefing.rawEvidence.summary}</pre>
                        ) : null}
                        {props.briefing.rawEvidence.terminationReason ? (
                            <p className="flex flex-col">
                                <span className="text-zinc-500">termination reason:</span>
                                <span>{props.briefing.rawEvidence.terminationReason}</span>
                            </p>
                        ) : null}
                        {props.briefing.rawEvidence.nextSuggestedStep ? (
                            <p className="flex flex-col">
                                <span className="text-zinc-500">next suggested step:</span>
                                <span>{props.briefing.rawEvidence.nextSuggestedStep}</span>
                            </p>
                        ) : null}
                        {props.briefing.rawEvidence.failureFingerprint ? (
                            <p className="flex flex-col">
                                <span className="text-zinc-500">failure fingerprint:</span>
                                <span>{props.briefing.rawEvidence.failureFingerprint}</span>
                            </p>
                        ) : null}
                        {(props.onOpenSessionLog || props.onOpenTrace) ? (
                            <div className="flex items-center gap-4 pt-4 mt-2 border-t border-zinc-800">
                                {props.onOpenSessionLog ? (
                                    <button
                                        type="button"
                                        className="text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded px-1"
                                        onClick={props.onOpenSessionLog}
                                    >
                                        [打开执行日志]
                                    </button>
                                ) : null}
                                {props.onOpenTrace ? (
                                    <button
                                        type="button"
                                        className="text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded px-1"
                                        onClick={props.onOpenTrace}
                                    >
                                        [打开原始轨迹]
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
