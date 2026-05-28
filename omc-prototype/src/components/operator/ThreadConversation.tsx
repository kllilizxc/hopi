import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
    MessagePrimitive,
    ThreadPrimitive,
} from '@assistant-ui/react'
import { memo } from 'react'
import DecisionBriefingCard from '@/components/operator/DecisionBriefingCard'
import ThreadHeader from '@/components/operator/ThreadHeader'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import { OperatorMessageCard, getOperatorMessageRootClass } from '@/components/operator/OperatorMessageCard'
import ThreadQuickActions from '@/components/operator/ThreadQuickActions'
import { MarkdownMessagePart } from '@/components/MarkdownRenderer'
import { useOmcAssistantRuntime } from '@/lib/omcAssistantRuntime'
import { usePrototypeStore } from '@/prototype/store'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const MESSAGE_PARTS = {
    Text: MarkdownMessagePart,
} as const

const ThreadAssistantMessage = memo(function ThreadAssistantMessage() {
    return (
        <MessagePrimitive.Root className={getOperatorMessageRootClass('assistant')}>
            <OperatorMessageCard role="assistant">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </OperatorMessageCard>
        </MessagePrimitive.Root>
    )
})

const ThreadUserMessage = memo(function ThreadUserMessage() {
    return (
        <MessagePrimitive.Root className={getOperatorMessageRootClass('user')}>
            <OperatorMessageCard role="user">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </OperatorMessageCard>
        </MessagePrimitive.Root>
    )
})

const ThreadSystemMessage = memo(function ThreadSystemMessage() {
    return (
        <MessagePrimitive.Root className={getOperatorMessageRootClass('system')}>
            <OperatorMessageCard role="system">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </OperatorMessageCard>
        </MessagePrimitive.Root>
    )
})

const THREAD_COMPONENTS = {
    UserMessage: ThreadUserMessage,
    AssistantMessage: ThreadAssistantMessage,
    SystemMessage: ThreadSystemMessage,
} as const

const OPERATOR_COMPOSER_PLACEHOLDER = '继续追问，或直接告诉 Agent 要怎么做'

export default function ThreadConversation(props: {
    thread: OperatorThread
    messages: OperatorMessage[]
}) {
    const operatorSurface = useOperatorSurface()
    const { actions, live } = usePrototypeStore()
    const runtime = useOmcAssistantRuntime({
        messages: props.messages,
        onSend(text) {
            actions.sendThreadReply(props.thread.id, text)
        },
    })
    const planRef = props.thread.refs.find((ref) => ref.kind === 'plan') ?? null
    const sessionId = props.thread.briefing?.identity.sessionId ?? (planRef ? live?.sessionIdByPlanKey?.[planRef.id] ?? null : null)

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <section className="flex flex-col h-full bg-white relative">
                <ThreadPrimitive.Root className="prototype-chat-thread flex flex-col flex-1 min-h-0 bg-zinc-50/30">
                    <div className="prototype-chat-thread__root flex flex-col h-full">
                        <div className="flex-shrink-0 z-20 bg-white border-b border-zinc-200">
                            <ThreadHeader thread={props.thread} />
                        </div>

                        <div className="flex-1 min-h-0 relative">
                            <ThreadPrimitive.Viewport className="prototype-chat-thread__viewport absolute inset-0 overflow-y-auto" autoScroll>
                                <div className="flex flex-col max-w-3xl mx-auto w-full">
                                    {props.thread.briefing ? (
                                        <div className="px-6 py-4">
                                            <DecisionBriefingCard
                                                briefing={props.thread.briefing}
                                                onOpenSessionLog={sessionId ? () => operatorSurface.openSessionLog({
                                                    sessionId,
                                                    source: 'plan-runtime',
                                                    title: props.thread.briefing?.identity.planLabel ?? props.thread.title,
                                                    subtitle: planRef?.id ?? null,
                                                }) : undefined}
                                                onOpenTrace={planRef ? () => operatorSurface.openTrace({
                                                    planId: planRef.id,
                                                    streamId: planRef.id,
                                                }) : undefined}
                                            />
                                        </div>
                                    ) : null}

                                    <div className="prototype-chat-thread__messages flex flex-col w-full gap-8 px-6 pt-4 pb-8">
                                        <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
                                    </div>
                                </div>
                            </ThreadPrimitive.Viewport>
                        </div>
                    </div>
                </ThreadPrimitive.Root>

                <div className="flex-shrink-0 border-t border-zinc-200 bg-white p-4 z-20">
                    <div className="prototype-chat-thread__controls max-w-3xl mx-auto w-full flex flex-col gap-3">
                        <ThreadQuickActions thread={props.thread} />

                        <ComposerPrimitive.Root className="prototype-chat-compose flex flex-col border border-zinc-300 rounded-xl bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 overflow-hidden transition-all duration-200">
                            <div className="flex items-end bg-white w-full p-2 relative">
                                <ComposerPrimitive.Input
                                    className="flex-1 max-h-32 min-h-[44px] px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 bg-transparent resize-none outline-none leading-relaxed"
                                    aria-label="回复这条线程"
                                    placeholder={OPERATOR_COMPOSER_PLACEHOLDER}
                                    submitOnEnter
                                    maxRows={4}
                                />
                                <ComposerPrimitive.Send className="flex items-center justify-center h-9 px-4 mb-1 mr-1 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    发送
                                </ComposerPrimitive.Send>
                            </div>
                        </ComposerPrimitive.Root>
                    </div>
                </div>
            </section>
        </AssistantRuntimeProvider>
    )
}
