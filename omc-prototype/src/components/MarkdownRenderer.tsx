import { TextMessagePartProvider } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'

const MARKDOWN_PLUGINS = [remarkGfm]

export function MarkdownRenderer(props: { content: string }) {
    return (
        <TextMessagePartProvider text={props.content}>
            <MarkdownTextPrimitive
                remarkPlugins={MARKDOWN_PLUGINS}
                className="prototype-thread-markdown"
            />
        </TextMessagePartProvider>
    )
}

export function MarkdownMessagePart() {
    return (
        <MarkdownTextPrimitive
            remarkPlugins={MARKDOWN_PLUGINS}
            className="prototype-thread-markdown"
        />
    )
}
