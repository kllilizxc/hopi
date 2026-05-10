import {
    Children,
    isValidElement,
    type ComponentPropsWithoutRef,
    type ReactElement,
    type ReactNode,
} from 'react'
import {
    MarkdownTextPrimitive,
    unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
    useIsMarkdownCodeBlock,
    type CodeHeaderProps,
} from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { CopyIcon, CheckIcon } from '@/components/icons'

export const MARKDOWN_PLUGINS = [remarkGfm]
export const MARKDOWN_ROOT_CLASS_NAME = 'aui-md min-w-0 max-w-full break-words text-base leading-relaxed [overflow-wrap:anywhere]'

function CodeHeader(props: CodeHeaderProps) {
    const { copied, copy } = useCopyToClipboard()
    const language = props.language && props.language !== 'unknown' ? props.language : ''

    return (
        <div className="aui-md-codeheader mt-3 flex min-w-0 max-w-full items-center justify-between overflow-hidden rounded-t-md bg-[var(--app-code-bg)] px-3 py-1.5">
            <div className="min-w-0 flex-1 truncate pr-2 text-xs font-mono text-[var(--app-hint)]">
                {language}
            </div>
            <button
                type="button"
                onClick={() => copy(props.code)}
                className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                title="Copy"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
    const { className, ...rest } = props

    return (
        <div className="aui-md-pre-wrapper my-3 min-w-0 w-full max-w-full overflow-x-hidden overflow-y-hidden">
            <pre
                {...rest}
                className={cn(
                    'aui-md-pre m-0 w-full min-w-0 whitespace-pre-wrap break-words rounded-md bg-[var(--app-code-bg)] p-3 text-[13px] leading-relaxed [overflow-wrap:anywhere]',
                    className
                )}
            />
        </div>
    )
}

function Code(props: ComponentPropsWithoutRef<'code'>) {
    const isCodeBlock = useIsMarkdownCodeBlock()

    if (isCodeBlock) {
        return (
            <code
                {...props}
                className={cn('aui-md-codeblockcode whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]', props.className)}
            />
        )
    }

    return (
        <code
            {...props}
            className={cn(
                'aui-md-code break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[0.9em] [overflow-wrap:anywhere]',
                props.className
            )}
        />
    )
}

function A(props: ComponentPropsWithoutRef<'a'>) {
    const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel

    return (
        <a
            {...props}
            rel={rel}
            className={cn('aui-md-a break-words text-[var(--app-link)] underline [overflow-wrap:anywhere]', props.className)}
        />
    )
}

function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
    return <p {...props} className={cn('aui-md-p my-2 min-w-0 leading-relaxed [overflow-wrap:anywhere]', props.className)} />
}

function Blockquote(props: ComponentPropsWithoutRef<'blockquote'>) {
    return (
        <blockquote
            {...props}
            className={cn(
                'aui-md-blockquote shadow-[inset_4px_0_0_var(--app-hint)] pl-3 opacity-85',
                props.className
            )}
        />
    )
}

function UnorderedList(props: ComponentPropsWithoutRef<'ul'>) {
    return <ul {...props} className={cn('aui-md-ul my-2.5 list-disc space-y-1.5 pl-5 leading-relaxed [overflow-wrap:anywhere]', props.className)} />
}

function OrderedList(props: ComponentPropsWithoutRef<'ol'>) {
    return <ol {...props} className={cn('aui-md-ol my-2.5 list-decimal space-y-1.5 pl-5 leading-relaxed [overflow-wrap:anywhere]', props.className)} />
}

function parseTodoListItem(children: ReactNode): {
    isTodoListItem: boolean
    isDone: boolean
    content: ReactNode[]
} {
    const nodes = Children.toArray(children)
    let checkboxIndex = -1
    let checkbox: ReactElement<{ checked?: boolean; defaultChecked?: boolean }> | null = null

    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        if (!isValidElement(node) || node.type !== 'input') {
            continue
        }

        const props = node.props as { type?: string; checked?: boolean; defaultChecked?: boolean }
        if (props.type === 'checkbox') {
            checkboxIndex = i
            checkbox = node as ReactElement<{ checked?: boolean; defaultChecked?: boolean }>
            break
        }
    }

    if (checkboxIndex < 0 || checkbox === null) {
        return {
            isTodoListItem: false,
            isDone: false,
            content: nodes,
        }
    }

    const isDone = Boolean(checkbox.props.checked ?? checkbox.props.defaultChecked)

    const content = nodes
        .filter((_, index) => index !== checkboxIndex)
        .map(node => {
            if (typeof node === 'string') {
                const text = node.replace(/^[\t\r\n ]+/, '')
                return text
            }
            return node
        })
        .filter(node => !(typeof node === 'string' && node.length === 0))

    return {
        isTodoListItem: true,
        isDone,
        content,
    }
}

function ListItem(props: ComponentPropsWithoutRef<'li'>) {
    const { className, children, ...rest } = props
    const parsed = parseTodoListItem(children)

    if (!parsed.isTodoListItem) {
        return <li {...rest} className={cn('aui-md-li min-w-0 pl-1 [overflow-wrap:anywhere]', className)} />
    }

    return (
        <li
            {...rest}
            className={cn(
                'aui-md-li aui-md-task-list-item flex min-w-0 list-none items-start gap-2 pl-0 [overflow-wrap:anywhere]',
                className
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    'aui-md-task-check h-4 w-4 rounded border text-[10px] leading-none shrink-0 mt-1 inline-flex items-center justify-center transition-all',
                    parsed.isDone
                        ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-button-text)]'
                        : 'border-[var(--app-border)] bg-transparent text-transparent'
                )}
            >
                {parsed.isDone ? <CheckIcon className="h-3 w-3" /> : null}
            </span>
            <span className={cn('aui-md-task-text min-w-0', parsed.isDone ? 'opacity-75 line-through' : null)}>
                {parsed.content}
            </span>
        </li>
    )
}

function Hr(props: ComponentPropsWithoutRef<'hr'>) {
    const { className, style, ...rest } = props
    return (
        <hr
            {...rest}
            style={{ ...style, border: 0 }}
            className={cn('aui-md-hr h-px bg-[var(--app-divider)]', className)}
        />
    )
}

function Table(props: ComponentPropsWithoutRef<'table'>) {
    const { className, style, ...rest } = props

    return (
        <div className="aui-md-table-wrapper max-w-full overflow-x-auto">
            <table
                {...rest}
                style={{ ...style, borderCollapse: 'separate', borderSpacing: 0 }}
                className={cn('aui-md-table w-full', className)}
            />
        </div>
    )
}

function Thead(props: ComponentPropsWithoutRef<'thead'>) {
    return <thead {...props} className={cn('aui-md-thead', props.className)} />
}

function Tbody(props: ComponentPropsWithoutRef<'tbody'>) {
    return <tbody {...props} className={cn('aui-md-tbody', props.className)} />
}

function Tr(props: ComponentPropsWithoutRef<'tr'>) {
    return <tr {...props} className={cn('aui-md-tr', props.className)} />
}

function Th(props: ComponentPropsWithoutRef<'th'>) {
    return (
        <th
            {...props}
            className={cn(
                'aui-md-th app-shadow-border bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold',
                props.className
            )}
        />
    )
}

function Td(props: ComponentPropsWithoutRef<'td'>) {
    return <td {...props} className={cn('aui-md-td app-shadow-border px-2 py-1', props.className)} />
}

function H1(props: ComponentPropsWithoutRef<'h1'>) {
    return <h1 {...props} className={cn('aui-md-h1 mb-2 mt-5 text-lg font-semibold leading-snug', props.className)} />
}

function H2(props: ComponentPropsWithoutRef<'h2'>) {
    return <h2 {...props} className={cn('aui-md-h2 mb-1.5 mt-4 text-base font-semibold leading-snug', props.className)} />
}

function H3(props: ComponentPropsWithoutRef<'h3'>) {
    return <h3 {...props} className={cn('aui-md-h3 mb-1.5 mt-4 text-base font-semibold leading-snug', props.className)} />
}

function H4(props: ComponentPropsWithoutRef<'h4'>) {
    return <h4 {...props} className={cn('aui-md-h4 mb-1 mt-3 text-base font-semibold leading-snug', props.className)} />
}

function H5(props: ComponentPropsWithoutRef<'h5'>) {
    return <h5 {...props} className={cn('aui-md-h5 mb-1 mt-3 text-sm font-semibold leading-snug', props.className)} />
}

function H6(props: ComponentPropsWithoutRef<'h6'>) {
    return <h6 {...props} className={cn('aui-md-h6 mb-1 mt-3 text-sm font-semibold leading-snug', props.className)} />
}

function Strong(props: ComponentPropsWithoutRef<'strong'>) {
    return <strong {...props} className={cn('aui-md-strong font-semibold', props.className)} />
}

function Em(props: ComponentPropsWithoutRef<'em'>) {
    return <em {...props} className={cn('aui-md-em italic', props.className)} />
}

function Image(props: ComponentPropsWithoutRef<'img'>) {
    return <img {...props} className={cn('aui-md-img max-w-full rounded', props.className)} />
}

export const defaultComponents = memoizeMarkdownComponents({
    SyntaxHighlighter,
    CodeHeader,
    pre: Pre,
    code: Code,
    h1: H1,
    h2: H2,
    h3: H3,
    h4: H4,
    h5: H5,
    h6: H6,
    a: A,
    p: Paragraph,
    strong: Strong,
    em: Em,
    blockquote: Blockquote,
    ul: UnorderedList,
    ol: OrderedList,
    li: ListItem,
    hr: Hr,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
    img: Image,
} as const)

export function MarkdownText() {
    return (
        <MarkdownTextPrimitive
            remarkPlugins={MARKDOWN_PLUGINS}
            components={defaultComponents}
            className={cn(MARKDOWN_ROOT_CLASS_NAME)}
        />
    )
}
