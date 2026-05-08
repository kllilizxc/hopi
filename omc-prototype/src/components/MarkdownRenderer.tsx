import { TextMessagePartProvider } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MARKDOWN_PLUGINS = [remarkGfm]

export function MarkdownRenderer(props: { content: string }) {
    return (
        <div className="prototype-thread-markdown overflow-x-hidden [overflow-wrap:anywhere]">
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>
                {props.content}
            </ReactMarkdown>
        </div>
    )
}

export function MarkdownMessagePart() {
    return (
        <MarkdownTextPrimitive
            remarkPlugins={MARKDOWN_PLUGINS}
            className="prototype-thread-markdown overflow-x-hidden [overflow-wrap:anywhere]"
        />
    )
}
