import { useState, useEffect, type FC, type PropsWithChildren } from 'react'
import { useMessage } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { cn } from '@/lib/utils'
import { defaultComponents, MARKDOWN_PLUGINS } from '@/components/assistant-ui/markdown-text'
import { ChevronRightIcon } from '@/assets/icons'

function ShimmerDot() {
    return (
        <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
    )
}

/**
 * Renders individual reasoning message part content with markdown support.
 */
export const Reasoning: FC = () => {
    return (
        <MarkdownTextPrimitive
            remarkPlugins={MARKDOWN_PLUGINS}
            components={defaultComponents}
            className={cn('aui-reasoning-content min-w-0 max-w-full break-words text-sm text-[var(--app-hint)]')}
        />
    )
}

/**
 * Wraps consecutive reasoning parts in a collapsible container.
 * Shows shimmer effect while reasoning is streaming.
 */
export const ReasoningGroup: FC<PropsWithChildren> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false)

    // Check if reasoning is still streaming
    const message = useMessage()
    const isStreaming = message.status?.type === 'running'
        && message.content.length > 0
        && message.content[message.content.length - 1]?.type === 'reasoning'

    // Auto-expand while streaming
    useEffect(() => {
        if (isStreaming) {
            setIsOpen(true)
        }
    }, [isStreaming])

    const expanded = isOpen || isStreaming

    return (
        <div className="aui-reasoning-group my-2">
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-expanded={expanded}
                className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    'text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                    'transition-colors cursor-pointer select-none'
                )}
            >
                <ChevronRightIcon className={cn('h-3 w-3 transition-transform duration-200', expanded ? 'rotate-90' : '')} />
                <span>Reasoning</span>
                {isStreaming && (
                    <span className="flex items-center gap-1 ml-1 text-[var(--app-hint)]">
                        <ShimmerDot />
                    </span>
                )}
            </button>

            {expanded ? (
                <div className="pl-4 pt-2 shadow-[inset_2px_0_0_var(--app-border)] ml-0.5">
                    {children}
                </div>
            ) : null}
        </div>
    )
}
