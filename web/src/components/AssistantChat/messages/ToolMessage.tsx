import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { ToolCallBlock } from '@/chat/types'
import { useState } from 'react'
import { isObject, safeStringify } from '@hopi/protocol'
import { getEventPresentation } from '@/chat/presentation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { ChevronRightIcon } from '@/assets/icons'
import { cn } from '@/lib/utils'

function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number') return false
    if (!Array.isArray(value.children)) return false
    if (!isObject(value.tool)) return false
    if (typeof value.tool.name !== 'string') return false
    if (!('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    if (value.tool.state !== 'pending' && value.tool.state !== 'running' && value.tool.state !== 'completed' && value.tool.state !== 'error') return false
    return true
}

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function hasPendingPermission(block: ChatBlock): boolean {
    if (isPendingPermissionBlock(block)) return true
    if (block.kind !== 'tool-call') return false
    return block.children.some(hasPendingPermission)
}

function ToolBlockItem(props: {
    block: ToolCallBlock
    compact?: boolean
}) {
    const ctx = useHappyChatContext()
    const nestedContent = props.block.children.length > 0 ? (
        <div className={cn('app-shadow-divider-l', props.compact ? 'pl-2' : 'pl-3')}>
            <HappyNestedBlockList blocks={props.block.children} compact />
        </div>
    ) : undefined

    return (
        <div className={props.compact ? 'py-0' : 'py-0.5'}>
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={props.block}
                defaultExpanded={hasPendingPermission(props.block)}
                nestedContent={nestedContent}
                nestedCount={props.block.children.length}
            />
        </div>
    )
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
    compact?: boolean
}) {
    const ctx = useHappyChatContext()

    return (
        <div className={cn('flex flex-col', props.compact ? 'gap-1' : 'gap-3')}>
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const userBubbleClass = 'w-fit max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined

                    return (
                        <div key={`user:${block.id}`} className={userBubbleClass}>
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <MarkdownRenderer content={block.text} />
                                </div>
                                {status ? (
                                    <div className="shrink-0 self-end pb-0.5">
                                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={`agent:${block.id}`} className="px-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    const presentation = getEventPresentation(block.event)
                    return (
                        <div key={`event:${block.id}`} className="py-1">
                            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    return <ToolBlockItem key={`tool:${block.id}`} block={block} compact={props.compact} />
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const artifact = props.artifact
    const [fallbackExpanded, setFallbackExpanded] = useState(false)

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <div className="rounded-xl bg-[var(--app-secondary-bg)] px-3 py-1.5 shadow-sm">
                    <button
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        aria-expanded={fallbackExpanded}
                        onClick={() => setFallbackExpanded((value) => !value)}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate font-mono text-[var(--app-hint)]">
                                Tool: {props.toolName}
                            </div>
                            {props.isError ? (
                                <span className="text-red-500">Error</span>
                            ) : null}
                            {props.status.type === 'running' && !hasResult ? (
                                <span className="text-[var(--app-hint)]">Running…</span>
                            ) : null}
                        </div>
                        <span className="shrink-0 text-[var(--app-hint)]">
                            <ChevronRightIcon className={`h-4 w-4 transition-transform duration-200 ${fallbackExpanded ? 'rotate-90' : ''}`} />
                        </span>
                    </button>

                    {fallbackExpanded ? (
                        <>
                            {hasArgsText ? (
                                <div className="mt-2">
                                    <CodeBlock code={argsText} language="json" />
                                </div>
                            ) : null}

                            {hasResult ? (
                                <div className="mt-2">
                                    <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} />
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
        )
    }

    const block = artifact

    return (
        <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <ToolBlockItem block={block} />
        </div>
    )
}
