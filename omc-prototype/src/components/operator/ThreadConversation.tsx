import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
    MessagePrimitive,
    ThreadPrimitive,
} from '@assistant-ui/react'
import { memo } from 'react'
import ThreadHeader from '@/components/operator/ThreadHeader'
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
        <MessagePrimitive.Root className="prototype-thread-message prototype-thread-message--agent">
            <div className="prototype-thread-bubble prototype-thread-bubble--agent">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </div>
        </MessagePrimitive.Root>
    )
})

const ThreadUserMessage = memo(function ThreadUserMessage() {
    return (
        <MessagePrimitive.Root className="prototype-thread-message prototype-thread-message--user">
            <div className="prototype-thread-bubble prototype-thread-bubble--user">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </div>
        </MessagePrimitive.Root>
    )
})

const ThreadSystemMessage = memo(function ThreadSystemMessage() {
    return (
        <MessagePrimitive.Root className="prototype-thread-message prototype-thread-message--system">
            <div className="prototype-thread-bubble prototype-thread-bubble--system">
                <MessagePrimitive.Content components={MESSAGE_PARTS} />
            </div>
        </MessagePrimitive.Root>
    )
})

const THREAD_COMPONENTS = {
    UserMessage: ThreadUserMessage,
    AssistantMessage: ThreadAssistantMessage,
    SystemMessage: ThreadSystemMessage,
} as const

export default function ThreadConversation(props: {
    thread: OperatorThread
    messages: OperatorMessage[]
}) {
    const { actions } = usePrototypeStore()
    const runtime = useOmcAssistantRuntime({
        messages: props.messages,
        onSend(text) {
            actions.sendThreadReply(props.thread.id, text)
        },
    })

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <section className="prototype-thread-shell">
                <ThreadHeader thread={props.thread} />

                <ThreadPrimitive.Root className="prototype-thread-root">
                    <ThreadPrimitive.Viewport className="prototype-thread-viewport" autoScroll>
                        <div className="prototype-thread-message-list">
                            <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
                        </div>
                    </ThreadPrimitive.Viewport>
                </ThreadPrimitive.Root>

                <ThreadQuickActions thread={props.thread} />

                <ComposerPrimitive.Root className="prototype-thread-composer">
                    <ComposerPrimitive.Input
                        className="prototype-thread-composer__input"
                        placeholder="继续追问，或直接告诉 Agent 你要它怎么做"
                        submitOnEnter
                        maxRows={8}
                    />
                    <div className="prototype-thread-composer__footer">
                        <small>Enter 发送，Shift+Enter 换行</small>
                        <ComposerPrimitive.Send className="prototype-primary-button">
                            发送
                        </ComposerPrimitive.Send>
                    </div>
                </ComposerPrimitive.Root>
            </section>
        </AssistantRuntimeProvider>
    )
}
