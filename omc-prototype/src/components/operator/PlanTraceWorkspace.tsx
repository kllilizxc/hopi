import { useEffect, useMemo, useState } from 'react'
import PlanTraceDiffWorkspace from './PlanTraceDiffWorkspace'
import PlanTraceTabs from './PlanTraceTabs'
import SessionLogWorkspace from './SessionLogWorkspace'
import type { PlanTraceInspection, PlanTraceTab } from '@/prototype/types'

function prettyJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}

function LinkedTopics(props: {
    inspection: PlanTraceInspection
    onOpenThread: (threadId: string) => void
}) {
    if (!props.inspection.linkedTopics.length) {
        return null
    }

    return (
        <section className="flex flex-col gap-3 p-4 bg-indigo-50 border border-indigo-100 rounded-xl mt-4" aria-label="linked-topics">
            <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider">关联线程</p>
            <div className="flex flex-wrap gap-2">
                {props.inspection.linkedTopics.map((topic) => (
                    <button
                        key={topic.id}
                        type="button"
                        className="px-3 py-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                        onClick={() => props.onOpenThread(topic.id)}
                        aria-label={`打开相关线程：${topic.title}`}
                    >
                        {topic.title}
                    </button>
                ))}
            </div>
        </section>
    )
}

function LogsEmptyState() {
    return (
        <section
            className="flex flex-col gap-4"
            aria-label="logs"
            role="tabpanel"
            id="prototype-trace-panel-logs"
            aria-labelledby="prototype-trace-tab-logs"
        >
            <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl">
                <h3 className="text-sm font-semibold text-zinc-900 mb-2">还没有底层日志</h3>
                <p className="text-sm">这张 plan 还没创建 runtime session。真正启动执行后，才会出现底层日志。</p>
            </section>
        </section>
    )
}

export default function PlanTraceWorkspace(props: {
    inspection: PlanTraceInspection
    sessionId?: string | null
    onOpenSessionLog?: () => void
    onBackToInbox: () => void
    onOpenThread: (threadId: string) => void
}) {
    const [activeTab, setActiveTab] = useState<PlanTraceTab>('logs')

    useEffect(() => {
        setActiveTab('logs')
    }, [props.inspection.planId])

    const jsonText = useMemo(() => prettyJson({
        workOrder: props.inspection.workOrder,
        agentEvents: props.inspection.events.map((event) => event.raw),
    }), [props.inspection.events, props.inspection.workOrder])

    const showEmbeddedLogs = activeTab === 'logs' && Boolean(props.sessionId)

    return (
        <section className="flex flex-col h-full bg-white relative">
            <div className="flex-shrink-0 border-b border-zinc-200 z-10 bg-white">
                <header className="px-6 py-5 bg-zinc-50 border-b border-zinc-100">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            type="button"
                            className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors focus:outline-none focus-visible:underline cursor-pointer"
                            onClick={props.onBackToInbox}
                        >
                            <span>← 返回收件箱</span>
                        </button>

                        {props.sessionId && props.onOpenSessionLog ? (
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded hover:bg-zinc-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 cursor-pointer whitespace-nowrap min-w-[100px]"
                                onClick={props.onOpenSessionLog}
                            >
                                独立打开日志
                            </button>
                        ) : null}
                    </div>

                    <div className="flex flex-col">
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">运行轨迹</p>
                        <h2 className="text-xl font-bold text-zinc-900 mb-2">{props.inspection.planTitle}</h2>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                            <span className="px-2 py-0.5 bg-zinc-200/50 rounded text-zinc-700">{props.inspection.match.label}</span>
                            {props.inspection.workOrder ? <span className="px-2 py-0.5 bg-zinc-100 rounded">{props.inspection.workOrder.id}</span> : null}
                            {props.inspection.round !== null ? <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">Round {props.inspection.round}</span> : null}
                        </div>
                    </div>
                </header>

                <div className="flex flex-col px-6 pt-4 pb-0">
                    {props.inspection.match.kind === 'inferred' ? (
                        <p className="px-4 py-2 mb-4 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
                            当前输出按 stream/phase 推断关联，不是 plan 直连。
                        </p>
                    ) : null}

                    <PlanTraceTabs activeTab={activeTab} onChange={setActiveTab} />
                </div>
            </div>

            {showEmbeddedLogs ? (
                <div
                    className="flex-1 min-h-0 bg-zinc-50/30"
                    role="tabpanel"
                    aria-label="logs"
                    id="prototype-trace-panel-logs"
                    aria-labelledby="prototype-trace-tab-logs"
                >
                    <SessionLogWorkspace
                        mode="embedded"
                        selection={{
                            sessionId: props.sessionId!,
                            source: 'plan-runtime',
                            title: props.inspection.planTitle,
                            subtitle: props.inspection.planId,
                        }}
                        onBack={props.onBackToInbox}
                    />
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto bg-zinc-50/30" data-testid="trace-scroll-shell">
                    <div className="flex flex-col gap-6 p-6">
                        {activeTab === 'logs' ? (
                            <LogsEmptyState />
                        ) : activeTab === 'events' ? (
                            <section
                                className="flex flex-col gap-4"
                                aria-label="events"
                                role="tabpanel"
                                id="prototype-trace-panel-events"
                                aria-labelledby="prototype-trace-tab-events"
                            >
                                {props.inspection.emptyState ? (
                                    <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl" aria-label="trace-empty-state">
                                        <h3 className="text-sm font-semibold text-zinc-900 mb-2">{props.inspection.emptyState.title}</h3>
                                        <p className="text-sm">{props.inspection.emptyState.detail}</p>
                                    </section>
                                ) : props.inspection.events.length ? props.inspection.events.map((event) => (
                                    <article key={event.id} className="flex flex-col p-4 bg-white border border-zinc-200 rounded-xl shadow-sm gap-3">
                                        <div className="flex items-center gap-3 text-xs font-mono">
                                            <span className={`px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${event.role === 'driver' ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-600'}`}>{event.role}</span>
                                            <strong className="text-zinc-900">{event.kind}</strong>
                                            <time className="text-zinc-400 ml-auto">{event.createdAt}</time>
                                        </div>
                                        <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{event.summary}</p>
                                        <details className="mt-2 group">
                                            <summary className="text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-900 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded p-0.5 inline-block">原始 payload</summary>
                                            <pre className="mt-2 p-3 bg-zinc-950 text-zinc-300 font-mono text-[10px] rounded-md overflow-x-auto">
                                                <code>{prettyJson(event.raw)}</code>
                                            </pre>
                                        </details>
                                    </article>
                                )) : (
                                    <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl">
                                        <h3 className="text-sm font-semibold text-zinc-900 mb-2">暂无事件</h3>
                                        <p className="text-sm">当前计划卡已经有运行态，但没有可展示的原始事件。</p>
                                    </section>
                                )}
                            </section>
                        ) : activeTab === 'state' ? (
                            <section
                                className="flex flex-col"
                                aria-label="state"
                                role="tabpanel"
                                id="prototype-trace-panel-state"
                                aria-labelledby="prototype-trace-tab-state"
                            >
                                {props.inspection.stateTransitions.length ? (
                                    <ul className="flex flex-col gap-2 p-4 bg-white border border-zinc-200 rounded-xl shadow-sm">
                                        {props.inspection.stateTransitions.map((transition, index) => (
                                            <li key={transition} className="flex items-center gap-3 text-sm text-zinc-700 font-mono">
                                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-100 text-zinc-500 text-xs flex-shrink-0">{index + 1}</span>
                                                {transition}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl">
                                        <h3 className="text-sm font-semibold text-zinc-900 mb-2">暂无状态转移</h3>
                                        <p className="text-sm">这条轨迹还没有形成可读的状态变化串。</p>
                                    </section>
                                )}
                            </section>
                        ) : activeTab === 'json' ? (
                            <section
                                className="flex flex-col gap-2"
                                aria-label="json"
                                role="tabpanel"
                                id="prototype-trace-panel-json"
                                aria-labelledby="prototype-trace-tab-json"
                            >
                                <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">workOrder + agentEvents</div>
                                <pre className="p-4 bg-zinc-950 text-zinc-300 font-mono text-[10px] rounded-xl shadow-sm overflow-x-auto">
                                    <code>{jsonText}</code>
                                </pre>
                            </section>
                        ) : (
                            <section
                                className="flex flex-col gap-2"
                                aria-label="diff"
                                role="tabpanel"
                                id="prototype-trace-panel-diff"
                                aria-labelledby="prototype-trace-tab-diff"
                            >
                                <PlanTraceDiffWorkspace
                                    sessionId={props.sessionId}
                                    planTitle={props.inspection.planTitle}
                                />
                            </section>
                        )}

                        <LinkedTopics
                            inspection={props.inspection}
                            onOpenThread={props.onOpenThread}
                        />
                    </div>
                </div>
            )}
        </section>
    )
}
