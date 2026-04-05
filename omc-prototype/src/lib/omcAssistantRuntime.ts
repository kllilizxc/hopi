import { useCallback, useMemo } from 'react'
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react'
import { useExternalMessageConverter, useExternalStoreRuntime } from '@assistant-ui/react'
import type { OperatorMessage } from '@/prototype/types'

function toThreadMessageLike(message: OperatorMessage): ThreadMessageLike {
    return {
        role: message.role === 'agent' ? 'assistant' : message.role,
        id: message.id,
        createdAt: new Date(message.createdAt),
        content: [{ type: 'text', text: message.body }],
        metadata: {
            custom: {
                status: message.status ?? 'sent',
            },
        },
    }
}

type TextPart = { type: 'text'; text: string }

function extractText(message: AppendMessage) {
    return (message.content ?? [])
        .filter((part): part is TextPart => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
}

export function useOmcAssistantRuntime(props: {
    messages: readonly OperatorMessage[]
    onSend: (text: string) => void
}) {
    const convertedMessages = useExternalMessageConverter<OperatorMessage>({
        callback: toThreadMessageLike,
        messages: props.messages as OperatorMessage[],
        isRunning: false,
    })

    const onNew = useCallback(async (message: AppendMessage) => {
        const text = extractText(message)
        if (!text) {
            return
        }
        props.onSend(text)
    }, [props.onSend])

    const adapter = useMemo(() => ({
        isDisabled: false,
        isRunning: false,
        messages: convertedMessages,
        onNew,
        onCancel: async () => {},
        unstable_capabilities: { copy: true },
    }), [convertedMessages, onNew])

    return useExternalStoreRuntime(adapter)
}
