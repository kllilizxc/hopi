import type { MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { MARKDOWN_PLUGINS, MARKDOWN_ROOT_CLASS_NAME, defaultComponents } from '@/components/assistant-ui/markdown-text'
import { HopiActionPacketCard } from '@/components/HopiActionPacketCard'
import { extractHopiActionPacketView } from '@/lib/hopi-action-packet'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
    content: string
    components?: MarkdownTextPrimitiveProps['components']
    isRunning?: boolean
}

function MarkdownPrimitiveContent(props: MarkdownRendererProps) {
    const mergedComponents = props.components
        ? { ...defaultComponents, ...props.components }
        : defaultComponents

    return (
        <TextMessagePartProvider text={props.content} isRunning={props.isRunning}>
            <MarkdownTextPrimitive
                remarkPlugins={MARKDOWN_PLUGINS}
                components={mergedComponents}
                className={cn(MARKDOWN_ROOT_CLASS_NAME)}
            />
        </TextMessagePartProvider>
    )
}

function MarkdownContent(props: MarkdownRendererProps) {
    const hopiActionPacket = extractHopiActionPacketView(props.content)
    if (hopiActionPacket) {
        return (
            <div className="min-w-0 max-w-full space-y-3">
                {hopiActionPacket.introText ? (
                    <MarkdownPrimitiveContent
                        content={hopiActionPacket.introText}
                        components={props.components}
                        isRunning={props.isRunning}
                    />
                ) : null}
                <HopiActionPacketCard packet={hopiActionPacket} />
            </div>
        )
    }

    return <MarkdownPrimitiveContent {...props} />
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
    return <MarkdownContent {...props} />
}
