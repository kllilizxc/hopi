import type { ToolCallBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { memo, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { isObject, safeStringify } from '@hopi/protocol'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { DiffView } from '@/components/DiffView'
import { PermissionFooter } from '@/components/ToolCard/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/ToolCard/AskUserQuestionFooter'
import { RequestUserInputFooter } from '@/components/ToolCard/RequestUserInputFooter'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolSummaryTitle } from '@/components/ToolCard/toolSummary'
import { getToolFullViewComponent } from '@/components/ToolCard/views/_all'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { getInputString, getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { ChevronRightIcon, SpinnerIcon, StatusCompletedIcon, StatusErrorIcon, StatusPendingIcon } from '@/assets/icons'

const ELAPSED_INTERVAL_MS = 1000

function ElapsedView(props: { from: number; active: boolean }) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!props.active) return
        const id = setInterval(() => setNow(Date.now()), ELAPSED_INTERVAL_MS)
        return () => clearInterval(id)
    }, [props.active])

    if (!props.active) return null

    const elapsed = (now - props.from) / 1000
    if (!Number.isFinite(elapsed)) return null

    return (
        <span className="font-mono text-xs text-[var(--app-hint)]">
            {elapsed.toFixed(1)}s
        </span>
    )
}

function renderEditInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
    const oldString = getInputString(input, 'old_string')
    const newString = getInputString(input, 'new_string')
    if (oldString === null || newString === null) return null

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath}
        />
    )
}

function renderExitPlanModeInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const plan = getInputString(input, 'plan')
    if (!plan) return null
    return <MarkdownRenderer content={plan} />
}

function renderToolInput(block: ToolCallBlock): ReactNode {
    const toolName = block.tool.name
    const input = block.tool.input

    if (toolName === 'Task' && isObject(input) && typeof input.prompt === 'string') {
        return <MarkdownRenderer content={input.prompt} />
    }

    if (toolName === 'Edit') {
        const diff = renderEditInput(input)
        if (diff) return diff
    }

    if (toolName === 'MultiEdit' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
        const edits = Array.isArray(input.edits) ? input.edits : null
        if (edits && edits.length > 0) {
            const rendered = edits
                .slice(0, 3)
                .map((edit, idx) => {
                    if (!isObject(edit)) return null
                    const oldString = getInputString(edit, 'old_string')
                    const newString = getInputString(edit, 'new_string')
                    if (oldString === null || newString === null) return null
                    return (
                        <div key={idx}>
                            <DiffView oldString={oldString} newString={newString} filePath={filePath} />
                        </div>
                    )
                })
                .filter(Boolean)

            if (rendered.length > 0) {
                return (
                    <div className="flex flex-col gap-2">
                        {rendered}
                        {edits.length > 3 ? (
                            <div className="text-xs text-[var(--app-hint)]">
                                (+{edits.length - 3} more edits)
                            </div>
                        ) : null}
                    </div>
                )
            }
        }
    }

    if (toolName === 'Write' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const content = getInputStringAny(input, ['content', 'text'])
        if (filePath && content !== null) {
            return (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" />
                </div>
            )
        }
    }

    if (toolName === 'CodexDiff' && isObject(input) && typeof input.unified_diff === 'string') {
        return <CodeBlock code={input.unified_diff} language="diff" />
    }

    if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode') {
        const plan = renderExitPlanModeInput(input)
        if (plan) return plan
    }

    const commandArray = isObject(input) && Array.isArray(input.command) ? input.command : null
    if ((toolName === 'CodexBash' || toolName === 'Bash') && (typeof commandArray?.[0] === 'string' || typeof input === 'object')) {
        const cmd = Array.isArray(commandArray)
            ? commandArray.filter((part) => typeof part === 'string').join(' ')
            : getInputStringAny(input, ['command', 'cmd'])
        if (cmd) {
            return <CodeBlock code={cmd} language="bash" />
        }
    }

    return <CodeBlock code={safeStringify(input)} language="json" />
}

function StatusIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return <StatusCompletedIcon />
    }
    if (props.state === 'error') {
        return <StatusErrorIcon />
    }
    if (props.state === 'pending') {
        return <StatusPendingIcon />
    }
    return <SpinnerIcon className="h-3 w-3 animate-spin" />
}

function statusColorClass(state: ToolCallBlock['tool']['state']): string {
    if (state === 'completed') return 'text-emerald-600'
    if (state === 'error') return 'text-red-600'
    if (state === 'pending') return 'text-amber-600'
    return 'text-[var(--app-hint)]'
}

type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
    defaultExpanded?: boolean
    nestedContent?: ReactNode
    nestedCount?: number
}

function ToolCardInner(props: ToolCardProps) {
    const { t } = useTranslation()
    const bodyId = useId()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata
    }), [
        props.block.tool.name,
        props.block.tool.input,
        props.block.tool.result,
        props.block.children.length,
        props.block.tool.description,
        props.metadata
    ])

    const toolName = props.block.tool.name
    const fallbackToolTitle = toolName === 'ToolGroup'
        ? t('tool.calls', { count: props.nestedCount ?? props.block.children.length })
        : presentation.title
    const toolTitle = getToolSummaryTitle({
        block: props.block,
        metadata: props.metadata,
        t,
        fallbackTitle: fallbackToolTitle
    })
    const subtitle = presentation.subtitle ?? props.block.tool.description
    const runningFrom = props.block.tool.startedAt ?? props.block.tool.createdAt
    const FullToolView = getToolFullViewComponent(toolName)
    const ResultToolView = getToolResultViewComponent(toolName)
    const permission = props.block.tool.permission
    const isAskUserQuestion = isAskUserQuestionToolName(toolName)
    const isRequestUserInput = isRequestUserInputToolName(toolName)
    const isQuestionTool = isAskUserQuestion || isRequestUserInput
    const showDialogResult = !isQuestionTool || !permission?.answers || Object.keys(permission.answers).length === 0
    const showSeparateDialogResult = showDialogResult && toolName !== 'TodoWrite'
    const showsPermissionFooter = Boolean(permission && (
        permission.status === 'pending'
        || ((permission.status === 'denied' || permission.status === 'canceled') && Boolean(permission.reason))
    ))
    const hasNestedContent = props.nestedContent !== undefined && props.nestedContent !== null
    const isContainerTool = (toolName === 'Task' || toolName === 'ToolGroup') && hasNestedContent
    const showOwnDetails = !isContainerTool
    const hasBody = hasNestedContent || showOwnDetails || showsPermissionFooter
    const [expanded, setExpanded] = useState(() => Boolean(props.defaultExpanded || (permission?.status === 'pending')))
    const stateColor = statusColorClass(props.block.tool.state)
    const { suppressFocusRing, onTriggerPointerDown, onTriggerKeyDown, onTriggerBlur } = usePointerFocusRing()
    const subtitleText = typeof subtitle === 'string' && subtitle.length > 0 ? subtitle : null
    const showSubtitle = expanded && subtitleText !== null
    const showNestedLabel = toolName !== 'ToolGroup'
    const showStatus = toolName !== 'ToolGroup'

    useEffect(() => {
        if (props.defaultExpanded || permission?.status === 'pending') {
            setExpanded(true)
        }
    }, [props.defaultExpanded, permission?.status])

    const renderExpandedDetails = () => {
        if (!showOwnDetails) return null

        return (
            <div className="flex flex-col gap-3">
                <div>
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                        {!showDialogResult && isQuestionTool ? t('tool.questionsAnswers') : t('tool.input')}
                    </div>
                    {FullToolView ? (
                        <FullToolView block={props.block} metadata={props.metadata} />
                    ) : (
                        renderToolInput(props.block)
                    )}
                </div>
                {showSeparateDialogResult && (
                    <div>
                        <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                        <ResultToolView block={props.block} metadata={props.metadata} />
                    </div>
                )}
            </div>
        )
    }

    const header = (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                    <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                        {presentation.icon}
                    </div>
                    <CardTitle className="min-w-0 truncate text-sm font-medium leading-tight" title={toolTitle}>
                        {toolTitle}
                    </CardTitle>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {showStatus ? (
                        <>
                            <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} />
                            <span className={stateColor}>
                                <StatusIcon state={props.block.tool.state} />
                            </span>
                        </>
                    ) : null}
                    <span className="text-[var(--app-hint)]">
                        <ChevronRightIcon className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-90')} />
                    </span>
                </div>
            </div>

            {showSubtitle ? (
                <CardDescription className="font-mono text-xs break-all opacity-80">
                    {truncate(subtitleText, 160)}
                </CardDescription>
            ) : null}
        </div>
    )

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className="px-3 py-1.5 space-y-0">
                <button
                    type="button"
                    className={cn(
                        'w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                        suppressFocusRing && 'focus-visible:ring-0'
                    )}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onPointerDown={onTriggerPointerDown}
                    onKeyDown={onTriggerKeyDown}
                    onBlur={onTriggerBlur}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {header}
                </button>
            </CardHeader>

            {hasBody && expanded ? (
                <CardContent id={bodyId} className="px-3 pb-3 pt-0">
                    <div className="flex flex-col gap-3">
                        {hasNestedContent ? (
                            <div>
                                {showNestedLabel ? (
                                    <div className="mb-2 text-xs font-medium text-[var(--app-hint)]">
                                        {t('tool.calls', { count: props.nestedCount ?? 0 })}
                                    </div>
                                ) : null}
                                {props.nestedContent}
                            </div>
                        ) : null}

                        {renderExpandedDetails()}

                        {isAskUserQuestion && permission?.status === 'pending' ? (
                            <AskUserQuestionFooter
                                api={props.api}
                                sessionId={props.sessionId}
                                tool={props.block.tool}
                                disabled={props.disabled}
                                onDone={props.onDone}
                            />
                        ) : isRequestUserInput && permission?.status === 'pending' ? (
                            <RequestUserInputFooter
                                api={props.api}
                                sessionId={props.sessionId}
                                tool={props.block.tool}
                                disabled={props.disabled}
                                onDone={props.onDone}
                            />
                        ) : (
                            <PermissionFooter
                                api={props.api}
                                sessionId={props.sessionId}
                                metadata={props.metadata}
                                tool={props.block.tool}
                                disabled={props.disabled}
                                onDone={props.onDone}
                            />
                        )}
                    </div>
                </CardContent>
            ) : null}
        </Card>
    )
}

export const ToolCard = memo(ToolCardInner)
