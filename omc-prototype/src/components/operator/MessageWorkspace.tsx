import { useMemo } from 'react'
import ThreadConversation from '@/components/operator/ThreadConversation'
import ThreadInbox from '@/components/operator/ThreadInbox'
import PlanTraceWorkspace from '@/components/operator/PlanTraceWorkspace'
import SessionLogWorkspace from '@/components/operator/SessionLogWorkspace'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import { Glyph } from '@/components/Visuals'
import { buildPlanTraceInspection } from '@/prototype/planTrace'
import { getPrototypeSnapshot } from '@/prototype/scenario'
import { usePrototypeStore } from '@/prototype/store'
import type {
    DecisionTopic,
    OperatorMessage,
    OperatorThread,
    PlanTraceInspection,
    PrototypePlanCard,
    SessionLogSelection,
    TraceSelection,
    WorldModel,
} from '@/prototype/types'

type MessageHeading = {
    title: string
    summary: string
}

function threadKindLabel(kind: OperatorThread['kind']) {
    switch (kind) {
        case 'approval':
            return '审批话题'
        case 'risk':
            return '风险话题'
        case 'direction':
            return '方向话题'
        case 'status':
            return '状态更新'
    }
}

function createEmptyTraceInspection(input: {
    planId: string
    planTitle: string
    detail: string
}): PlanTraceInspection {
    return {
        planId: input.planId,
        planTitle: input.planTitle,
        mappingConfidence: 'none',
        match: { kind: 'none', label: '无运行态输出' },
        workOrder: null,
        round: null,
        events: [],
        stateTransitions: [],
        linkedTopics: [],
        emptyState: {
            title: '这张卡还没有运行态输出，当前只有计划信息。',
            detail: input.detail,
        },
    }
}

function resolveTraceInspection(input: {
    worldModel: WorldModel
    decisionTopics: Record<string, DecisionTopic>
    traceSelection: TraceSelection | null
    planCards: PrototypePlanCard[]
}): PlanTraceInspection {
    if (!input.traceSelection) {
        return createEmptyTraceInspection({
            planId: 'unknown',
            planTitle: '未知计划',
            detail: '当前没有选中的计划轨迹。',
        })
    }

    const planCard = input.planCards.find((item) => item.id === input.traceSelection?.planId)

    if (!planCard) {
        return createEmptyTraceInspection({
            planId: input.traceSelection.planId,
            planTitle: input.traceSelection.planId,
            detail: `当前 checkpoint 里没有找到 ${input.traceSelection.planId} 对应的计划卡。`,
        })
    }

    return buildPlanTraceInspection({
        planCard,
        worldModel: input.worldModel,
        decisionTopics: input.decisionTopics,
    })
}

export default function MessageWorkspace(props: {
    className?: string
    heading: MessageHeading
    threads: OperatorThread[]
    messagesByThread: Record<string, OperatorMessage[]>
    selectedThread: OperatorThread | null
    mode?: 'inbox' | 'thread' | 'trace' | 'session-log'
    traceSelection?: TraceSelection | null
    sessionLogSelection?: SessionLogSelection | null
    showHandled: boolean
    onToggleHandled: () => void
    onSelectThread: (threadId: string) => void
    onBackToList: () => void
    onClose?: () => void
}) {
    const className = props.className ? `prototype-message-panel ${props.className}` : 'prototype-message-panel'
    const mode = props.mode ?? (props.selectedThread ? 'thread' : 'inbox')
    const operatorSurface = useOperatorSurface()
    const { state, dataSource, live } = usePrototypeStore()
    const activeMessages = props.selectedThread
        ? props.messagesByThread[props.selectedThread.id] ?? []
        : []
    const snapshot = dataSource?.getSnapshot ? dataSource.getSnapshot() : getPrototypeSnapshot(state.checkpoint)

    const traceInspection = useMemo(
        () => (
            mode === 'trace'
                ? resolveTraceInspection({
                    worldModel: state.worldModel,
                    decisionTopics: state.decisionTopics,
                    traceSelection: props.traceSelection ?? null,
                    planCards: snapshot.planCards,
                })
                : null
        ),
        [dataSource, mode, props.traceSelection, snapshot.planCards, state.checkpoint, state.decisionTopics, state.worldModel],
    )

    if (mode === 'trace' && traceInspection) {
        const sessionId = live?.sessionIdByPlanKey?.[traceInspection.planId] ?? null
        return (
            <aside className={className}>
                <PlanTraceWorkspace
                    inspection={traceInspection}
                    sessionId={sessionId}
                    onOpenSessionLog={sessionId ? () => {
                        operatorSurface.openSessionLog({
                            sessionId,
                            source: 'plan-runtime',
                            title: traceInspection.planTitle,
                            subtitle: traceInspection.planId,
                        })
                    } : undefined}
                    onBackToInbox={props.onBackToList}
                    onOpenThread={props.onSelectThread}
                />
            </aside>
        )
    }

    if (mode === 'session-log' && props.sessionLogSelection) {
        return (
            <aside className={className}>
                <SessionLogWorkspace
                    selection={props.sessionLogSelection}
                    onBack={props.onBackToList}
                />
            </aside>
        )
    }

    return (
        <aside className={className}>
            <div className={`prototype-message-panel__head${mode !== 'inbox' ? ' prototype-message-panel__head--detail' : ''}`}>
                {mode === 'inbox' ? (
                    <div className="prototype-icon-pill prototype-icon-pill--small">
                        <Glyph name="digest" />
                    </div>
                ) : (
                    <button
                        type="button"
                        className="prototype-thread-detail__back"
                        onClick={props.onBackToList}
                    >
                        <Glyph name="back" />
                        <span>返回列表</span>
                    </button>
                )}
                <div className="prototype-message-panel__title">
                    {mode === 'thread' && props.selectedThread ? (
                        <p className="prototype-message-panel__eyebrow">
                            {threadKindLabel(props.selectedThread.kind)}
                        </p>
                    ) : null}
                    <div className="prototype-message-panel__title-row">
                        <h2>{props.selectedThread ? props.selectedThread.title : props.heading.title}</h2>
                    </div>
                    {mode === 'thread' && props.selectedThread ? (
                        <p className="prototype-message-panel__meta">
                            <span>{props.selectedThread.statusLabel}</span>
                            <span>{props.selectedThread.updatedAt}</span>
                        </p>
                    ) : props.heading.summary ? (
                        <p className="prototype-message-panel__meta">{props.heading.summary}</p>
                    ) : null}
                </div>
                {props.onClose ? (
                    <button
                        type="button"
                        className="prototype-message-panel__close"
                        onClick={props.onClose}
                        aria-label="关闭消息面板"
                    >
                        <Glyph name="close" />
                    </button>
                ) : null}
            </div>

            {props.selectedThread ? (
                <div className="prototype-message-panel__body prototype-message-panel__body--detail">
                    <section className="prototype-message-panel__detail">
                        <ThreadConversation thread={props.selectedThread} messages={activeMessages} />
                    </section>
                </div>
            ) : (
                <div className="prototype-message-panel__body prototype-message-panel__body--inbox">
                    <ThreadInbox
                        threads={props.threads}
                        activeThreadId={null}
                        showHandled={props.showHandled}
                        onToggleHandled={props.onToggleHandled}
                        onSelect={props.onSelectThread}
                    />
                    {!props.threads.length ? (
                        <section className="prototype-thread-empty">
                            <div className="prototype-icon-pill prototype-icon-pill--small">
                                <Glyph name="digest" />
                            </div>
                            <div>
                                <h3>暂无线程</h3>
                                <p>当前没有进入经营边界的话题。系统会继续静默推进。</p>
                            </div>
                        </section>
                    ) : null}
                </div>
            )}
        </aside>
    )
}
