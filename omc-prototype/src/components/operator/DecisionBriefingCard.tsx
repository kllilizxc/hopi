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

    const summaryRows = [
        { label: '这次目标', value: props.briefing.summaryRows.targetOutcome ?? null },
        { label: '这轮产出', value: props.briefing.summaryRows.changeSummary ?? null },
        { label: '发生了什么', value: props.briefing.summaryRows.whatHappened },
        { label: '为什么会找你', value: props.briefing.summaryRows.whyEscalated },
        { label: '系统建议', value: props.briefing.summaryRows.recommendedAction },
        { label: '当前影响', value: props.briefing.summaryRows.currentImpact },
    ].filter((row): row is { label: string; value: string } => Boolean(row.value))

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

            {props.briefing.decisionQuestion ? (
                <div className="px-4 pt-4 sm:px-6 sm:pt-6">
                    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                        <p className="text-xs font-semibold text-amber-800 tracking-wide">你现在要确认的是</p>
                        <p className="text-sm leading-relaxed text-amber-950">{props.briefing.decisionQuestion}</p>
                    </div>
                </div>
            ) : null}

            <dl className="flex flex-col p-4 sm:p-6 gap-6">
                {summaryRows.map((row) => (
                    <div key={row.label} className="flex flex-col sm:flex-row sm:gap-6">
                        <dt className="text-sm font-semibold text-zinc-900 sm:w-32 flex-shrink-0">{row.label}</dt>
                        <dd className="text-sm text-zinc-700 leading-relaxed mt-1 sm:mt-0 whitespace-pre-wrap break-words">{row.value}</dd>
                    </div>
                ))}
            </dl>

            {(props.briefing.primaryAction || props.briefing.secondaryAction) ? (
                <div className="flex flex-col p-4 sm:p-6 pt-0 gap-3">
                    <p className="text-xs font-semibold text-zinc-500 tracking-wide mb-1">按钮含义</p>
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
                        aria-label="查看原始依据"
                        className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-2 focus:outline-none focus-visible:underline"
                        onClick={() => setExpanded((value) => !value)}
                    >
                        <span aria-hidden="true" className={`transform transition-transform ${expanded ? 'rotate-90' : 'rotate-0'}`}>▶</span>
                        查看原始依据
                    </button>
                    <p className="text-xs text-zinc-400 hidden sm:block">
                        技术排查参考，不需要用于日常决策
                    </p>
                </div>

                {expanded ? (
                    <div className="flex flex-col p-4 sm:p-6 gap-4 bg-zinc-900 text-zinc-300 font-mono text-xs overflow-x-hidden">
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
                        {props.briefing.rawEvidence.changedFiles?.length ? (
                            <p className="flex flex-col">
                                <span className="text-zinc-500">changed files:</span>
                                <span className="whitespace-pre-wrap break-all">{props.briefing.rawEvidence.changedFiles.join('\n')}</span>
                            </p>
                        ) : null}
                        {(props.onOpenSessionLog || props.onOpenTrace) ? (
                            <div className="flex items-center gap-4 pt-4 mt-2 border-t border-zinc-800">
                                {props.onOpenSessionLog ? (
                                    <button
                                        type="button"
                                        aria-label="打开执行日志"
                                        className="text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded px-1"
                                        onClick={props.onOpenSessionLog}
                                    >
                                        打开执行日志
                                    </button>
                                ) : null}
                                {props.onOpenTrace ? (
                                    <button
                                        type="button"
                                        aria-label="打开原始轨迹"
                                        className="text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded px-1"
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
