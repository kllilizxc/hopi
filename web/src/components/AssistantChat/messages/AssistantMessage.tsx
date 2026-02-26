import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { useTranslation } from '@/lib/use-translation'

const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage
} as const

const MESSAGE_PART_COMPONENTS = {
    Text: MarkdownText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: TOOL_COMPONENTS
} as const

function AssistantTypingIndicator() {
    const { t } = useTranslation()
    const label = t('misc.loading')

    return (
        <div
            className="w-fit max-w-[92%] rounded-xl bg-[var(--app-subtle-bg)] px-3 py-2 text-[var(--app-hint)]"
            role="status"
            aria-label={label}
            aria-live="polite"
        >
            <span className="sr-only">{label}</span>
            <div className="flex items-center gap-1" aria-hidden="true">
                <span className="hapi-typing-dot h-2 w-2 rounded-full bg-current" style={{ animationDelay: '0ms' }} />
                <span className="hapi-typing-dot h-2 w-2 rounded-full bg-current" style={{ animationDelay: '150ms' }} />
                <span className="hapi-typing-dot h-2 w-2 rounded-full bg-current" style={{ animationDelay: '300ms' }} />
            </div>
        </div>
    )
}

export function HappyAssistantMessage() {
    const showTypingIndicator = useAssistantState(({ message }) => message.isLast && message.status?.type === 'running')
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const toolOnly = useAssistantState(({ message }) => {
        if (message.role !== 'assistant') return false
        const parts = message.content
        return parts.length > 0 && parts.every((part) => part.type === 'tool-call')
    })
    const rootClass = toolOnly
        ? 'py-1 min-w-0 max-w-full overflow-x-hidden'
        : 'px-1 min-w-0 max-w-full overflow-x-hidden'

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <CliOutputBlock text={cliText} />
                {showTypingIndicator ? (
                    <div className="mt-2">
                        <AssistantTypingIndicator />
                    </div>
                ) : null}
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root className={rootClass}>
            <MessagePrimitive.Content components={MESSAGE_PART_COMPONENTS} />
            {showTypingIndicator ? (
                <div className="mt-2">
                    <AssistantTypingIndicator />
                </div>
            ) : null}
        </MessagePrimitive.Root>
    )
}
