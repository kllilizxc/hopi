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
            <section className="prototype-chat-thread">
                <ThreadHeader thread={props.thread} />

                {props.thread.briefing ? (
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
                ) : null}

                <ThreadPrimitive.Root className="prototype-chat-thread__root">
                    <ThreadPrimitive.Viewport className="prototype-chat-thread__viewport" autoScroll>
                        <div className="prototype-chat-thread__messages">
                            <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
                        </div>
                    </ThreadPrimitive.Viewport>
                </ThreadPrimitive.Root>

                <div className="prototype-chat-thread__controls">
                    <ThreadQuickActions thread={props.thread} />

                    <ComposerPrimitive.Root className="prototype-chat-compose">
                        <div className="prototype-chat-compose__row">
                            <ComposerPrimitive.Input
                                className="prototype-chat-compose__input"
                                aria-label="回复这条线程"
                                placeholder={OPERATOR_COMPOSER_PLACEHOLDER}
                                submitOnEnter
                                maxRows={4}
                            />
                            <ComposerPrimitive.Send className="prototype-primary-button prototype-chat-compose__send">
                                发送
                            </ComposerPrimitive.Send>
                        </div>
                    </ComposerPrimitive.Root>
                </div>
            </section>
        </AssistantRuntimeProvider>
    )
}
