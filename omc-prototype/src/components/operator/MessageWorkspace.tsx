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
    const mode = props.mode ?? (props.selectedThread ? 'thread' : 'inbox')
    const className = [
        'flex flex-col h-full bg-white border-l border-zinc-200 overflow-hidden w-full max-w-[500px] shadow-xl md:shadow-none transition-all duration-300',
        props.className,
    ].filter(Boolean).join(' ')
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
            <div className={`flex flex-col px-6 py-5 bg-white border-b border-zinc-200 relative z-10 flex-shrink-0 ${mode !== 'inbox' ? 'gap-3' : 'gap-4'}`}>
                <div className="flex items-center justify-between w-full">
                    {mode === 'inbox' ? (
                        <div className="flex items-center justify-center w-8 h-8 rounded bg-zinc-100 text-zinc-600">
                            <Glyph name="digest" />
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded p-1 -ml-1"
                            onClick={props.onBackToList}
                        >
                            <Glyph name="back" />
                            <span>返回列表</span>
                        </button>
                    )}

                    {props.onClose ? (
                        <button
                            type="button"
                            className="flex items-center justify-center w-8 h-8 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            onClick={props.onClose}
                            aria-label="关闭消息面板"
                        >
                            <Glyph name="close" />
                        </button>
                    ) : null}
                </div>

                <div className="flex flex-col min-w-0">
                    {mode === 'thread' && props.selectedThread ? (
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                            {threadKindLabel(props.selectedThread.kind)}
                        </p>
                    ) : null}
                    <div className="flex items-center gap-3 w-full">
                        <h2 className="text-xl font-bold text-zinc-900 truncate leading-tight break-all whitespace-normal">{props.selectedThread ? props.selectedThread.title : props.heading.title}</h2>
                    </div>
                    {mode === 'thread' && props.selectedThread ? (
                        <div className="flex items-center gap-3 mt-2 text-xs font-medium text-zinc-500">
                            <span className="px-2 py-0.5 bg-zinc-100 rounded-md text-zinc-700">{props.selectedThread.statusLabel}</span>
                            <span>{props.selectedThread.updatedAt}</span>
                        </div>
                    ) : props.heading.summary ? (
                        <p className="text-sm text-zinc-500 mt-1 line-clamp-2 leading-relaxed break-all whitespace-normal">{props.heading.summary}</p>
                    ) : null}
                </div>
            </div>

            {props.selectedThread ? (
                <div className="flex-1 overflow-hidden relative bg-white min-h-0">
                    <section className="absolute inset-0 flex flex-col min-h-0">
                        <ThreadConversation thread={props.selectedThread} messages={activeMessages} />
                    </section>
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden bg-zinc-50/50 min-h-0">
                    <ThreadInbox
                        threads={props.threads}
                        activeThreadId={null}
                        showHandled={props.showHandled}
                        onToggleHandled={props.onToggleHandled}
                        onSelect={props.onSelectThread}
                    />
                    {!props.threads.length ? (
                        <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 h-full">
                            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-zinc-100 text-zinc-400 mb-4">
                                <Glyph name="digest" />
                            </div>
                            <h3 className="text-base font-medium text-zinc-900 mb-2">暂无线程</h3>
                            <p className="text-sm max-w-[240px] leading-relaxed">当前没有进入经营边界的话题。系统会继续静默推进。</p>
                        </section>
                    ) : null}
                </div>
            )}
        </aside>
    )
}
