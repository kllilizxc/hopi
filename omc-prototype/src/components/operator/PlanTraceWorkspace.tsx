import { useEffect, useMemo, useState } from 'react'
import PlanTraceTabs from './PlanTraceTabs'
import type { PlanTraceInspection, PlanTraceTab } from '@/prototype/types'

function prettyJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}

export default function PlanTraceWorkspace(props: {
    inspection: PlanTraceInspection
    sessionId?: string | null
    onOpenSessionLog?: () => void
    onBackToInbox: () => void
    onOpenThread: (threadId: string) => void
}) {
    const [activeTab, setActiveTab] = useState<PlanTraceTab>('events')

    useEffect(() => {
        setActiveTab('events')
    }, [props.inspection.planId])

    const jsonText = useMemo(() => prettyJson({
        workOrder: props.inspection.workOrder,
        agentEvents: props.inspection.events.map((event) => event.raw),
    }), [props.inspection.events, props.inspection.workOrder])

    return (
        <section className="prototype-trace-workspace">
            <header className="prototype-trace-workspace__header">
                <button
                    type="button"
                    className="prototype-thread-detail__back"
                    onClick={props.onBackToInbox}
                >
                    返回收件箱
                </button>
                <div className="prototype-trace-workspace__title">
                    <p className="prototype-message-panel__eyebrow">运行轨迹</p>
                    <h2>{props.inspection.planTitle}</h2>
                    <p className="prototype-trace-workspace__meta">
                        <span>{props.inspection.match.label}</span>
                        {props.inspection.workOrder ? <span>{props.inspection.workOrder.id}</span> : null}
                        {props.inspection.round !== null ? <span>Round {props.inspection.round}</span> : null}
                    </p>
                </div>
                {props.sessionId && props.onOpenSessionLog ? (
                    <button
                        type="button"
                        className="prototype-button--ghost"
                        onClick={props.onOpenSessionLog}
                    >
                        查看底层日志
                    </button>
                ) : null}
            </header>

            <div className="prototype-trace-workspace__summary">
                {props.inspection.match.kind === 'inferred' ? (
                    <p className="prototype-trace-workspace__warning">
                        当前输出按 stream/phase 推断关联，不是 plan 直连。
                    </p>
                ) : null}

                <PlanTraceTabs activeTab={activeTab} onChange={setActiveTab} />
            </div>

            <div className="prototype-trace-workspace__body" data-testid="trace-scroll-shell">
                {activeTab === 'events' ? (
                    <section
                        className="prototype-trace-section"
                        aria-label="events"
                        role="tabpanel"
                        id="prototype-trace-panel-events"
                        aria-labelledby="prototype-trace-tab-events"
                    >
                        {props.inspection.emptyState ? (
                            <>
                                <section className="prototype-trace-empty" aria-label="trace-empty-state">
                                    <h3>{props.inspection.emptyState.title}</h3>
                                    <p>{props.inspection.emptyState.detail}</p>
                                </section>
                                {!props.sessionId ? (
                                    <p className="prototype-trace-workspace__hint">
                                        这张 plan 还没创建 runtime session。真正启动执行后，才会出现底层日志。
                                    </p>
                                ) : null}
                            </>
                        ) : props.inspection.events.length ? props.inspection.events.map((event) => (
                            <article key={event.id} className="prototype-trace-event-row">
                                <div className="prototype-trace-event-row__meta">
                                    <span>{event.role}</span>
                                    <strong>{event.kind}</strong>
                                    <time>{event.createdAt}</time>
                                </div>
                                <p className="prototype-trace-event-row__summary">{event.summary}</p>
                                <details className="prototype-trace-event-row__details">
                                    <summary>原始 payload</summary>
                                    <pre className="prototype-trace-json">{prettyJson(event.raw)}</pre>
                                </details>
                            </article>
                        )) : (
                            <section className="prototype-trace-empty">
                                <h3>暂无事件</h3>
                                <p>当前计划卡已经有运行态，但没有可展示的原始事件。</p>
                            </section>
                        )}
                    </section>
                ) : activeTab === 'state' ? (
                    <section
                        className="prototype-trace-section"
                        aria-label="state"
                        role="tabpanel"
                        id="prototype-trace-panel-state"
                        aria-labelledby="prototype-trace-tab-state"
                    >
                        {props.inspection.stateTransitions.length ? (
                            <ul className="prototype-trace-state-list">
                                {props.inspection.stateTransitions.map((transition) => (
                                    <li key={transition}>{transition}</li>
                                ))}
                            </ul>
                        ) : (
                            <section className="prototype-trace-empty">
                                <h3>暂无状态转移</h3>
                                <p>这条轨迹还没有形成可读的状态变化串。</p>
                            </section>
                        )}
                    </section>
                ) : (
                    <section
                        className="prototype-trace-section"
                        aria-label="json"
                        role="tabpanel"
                        id="prototype-trace-panel-json"
                        aria-labelledby="prototype-trace-tab-json"
                    >
                        <div className="prototype-trace-json__label">workOrder + agentEvents</div>
                        <pre className="prototype-trace-json">{jsonText}</pre>
                    </section>
                )}

                {props.inspection.linkedTopics.length ? (
                    <section className="prototype-trace-linked" aria-label="linked-topics">
                        <p className="prototype-trace-linked__label">关联线程</p>
                        <div className="prototype-trace-linked__list">
                            {props.inspection.linkedTopics.map((topic) => (
                                <button
                                    key={topic.id}
                                    type="button"
                                    className="prototype-button--ghost"
                                    onClick={() => props.onOpenThread(topic.id)}
                                    aria-label={`打开相关线程：${topic.title}`}
                                >
                                    {topic.title}
                                </button>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </section>
    )
}
