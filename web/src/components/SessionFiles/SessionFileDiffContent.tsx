import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import type { UseSessionFileDiffViewerResult } from '@/hooks/useSessionFileDiffViewer'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

type SessionFileDiffContentLabels = {
    loading: string
    noPath: string
    binary: string
    fileEmpty: string
    noChanges: string
    diffTab: string
    fileTab: string
    diffUnavailablePrefix: string
    copyContent: string
    copiedContent: string
    staged: string
    unstaged: string
}

export function SessionFileDiffContent(props: {
    viewer: UseSessionFileDiffViewerResult
    staged?: boolean
    labels: SessionFileDiffContentLabels
    showStagedStatus?: boolean
    fileErrorClassName?: string
    contentCopyVariant?: 'icon' | 'button'
}) {
    const { copied: contentCopied, copy: copyContent } = useCopyToClipboard()
    const isDiffMode = props.viewer.displayMode === 'diff'
    const isFileMode = props.viewer.displayMode === 'file'

    const diffErrorMessage = props.viewer.diffError
        ? `${props.labels.diffUnavailablePrefix}${props.viewer.diffError}`
        : null
    const fileErrorClassName = props.fileErrorClassName ?? 'text-sm text-[var(--app-hint)]'
    const contentCopyVariant = props.contentCopyVariant ?? 'icon'

    return (
        <>
            {props.viewer.hasDiffContent ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                        <Tag
                            asChild
                            variant={props.viewer.displayMode === 'diff' ? 'primary' : 'secondary'}
                            size="md"
                            shape="rounded"
                            bordered={false}
                            className="cursor-pointer"
                        >
                            <button
                                type="button"
                                onClick={() => props.viewer.setDisplayMode('diff')}
                            >
                                {props.labels.diffTab}
                            </button>
                        </Tag>
                        <Tag
                            asChild
                            variant={props.viewer.displayMode === 'file' ? 'primary' : 'secondary'}
                            size="md"
                            shape="rounded"
                            bordered={false}
                            className="cursor-pointer"
                        >
                            <button
                                type="button"
                                onClick={() => props.viewer.setDisplayMode('file')}
                            >
                                {props.labels.fileTab}
                            </button>
                        </Tag>

                        {props.showStagedStatus ? (
                            <div className="ml-auto text-[10px] text-[var(--app-hint)]">
                                {props.staged ? props.labels.staged : props.labels.unstaged}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4">
                    {diffErrorMessage ? (
                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">
                            {diffErrorMessage}
                        </div>
                    ) : null}

                    {props.viewer.missingPath ? (
                        <div className="text-sm text-[var(--app-hint)]">{props.labels.noPath}</div>
                    ) : props.viewer.loading ? (
                        <FileContentSkeleton label={props.labels.loading} />
                    ) : isDiffMode && props.viewer.hasDiffContent ? (
                        <DiffDisplay diffContent={props.viewer.diffContent} />
                    ) : isFileMode && props.viewer.fileError ? (
                        <div className={cn(fileErrorClassName)}>{props.viewer.fileError}</div>
                    ) : isFileMode && props.viewer.binaryFile ? (
                        <div className="text-sm text-[var(--app-hint)]">{props.labels.binary}</div>
                    ) : isFileMode ? (
                        props.viewer.decodedContent ? (
                            <>
                                <div className="relative min-w-0 max-w-full">
                                    {contentCopyVariant === 'icon' && props.viewer.canCopyContent ? (
                                        <button
                                            type="button"
                                            onClick={() => void copyContent(props.viewer.decodedContent)}
                                            className="absolute right-2 top-2 z-10 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                                            title={props.labels.copyContent}
                                        >
                                            {contentCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                                        </button>
                                    ) : null}

                                    <div className="min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-md bg-[var(--app-code-bg)]">
                                        <pre
                                            className={cn(
                                                'shiki m-0 w-max min-w-full p-3 text-xs font-mono',
                                                contentCopyVariant === 'icon' && props.viewer.canCopyContent && 'pr-8'
                                            )}
                                        >
                                            <code className="block">{props.viewer.highlightedContent ?? props.viewer.decodedContent}</code>
                                        </pre>
                                    </div>
                                </div>

                                {contentCopyVariant === 'button' && props.viewer.canCopyContent ? (
                                    <div className="mt-3 flex justify-end">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => void copyContent(props.viewer.decodedContent)}
                                        >
                                            {contentCopied ? props.labels.copiedContent : props.labels.copyContent}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">{props.labels.fileEmpty}</div>
                        )
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">{props.labels.noChanges}</div>
                    )}
                </div>
            </div>
        </>
    )
}

function DiffDisplay(props: { diffContent: string }) {
    const lines = props.diffContent.split('\n')

    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            {lines.map((line, index) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isRemove = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                const isHeader = line.startsWith('+++') || line.startsWith('---')

                const className = [
                    'whitespace-pre-wrap px-3 py-0.5 text-xs font-mono',
                    isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
                    isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
                    isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
                    isHeader ? 'text-[var(--app-hint)] font-semibold' : ''
                ].filter(Boolean).join(' ')

                const style = isAdd
                    ? { borderLeft: '2px solid var(--app-git-staged-color)' }
                    : isRemove
                        ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                        : undefined

                return (
                    <div key={`${index}-${line}`} className={className} style={style}>
                        {line || ' '}
                    </div>
                )
            })}
        </div>
    )
}

function FileContentSkeleton(props: { label: string }) {
    const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4', 'w-2/3', 'w-4/5']

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{props.label}</span>
            <div className="animate-pulse space-y-2 rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3">
                {Array.from({ length: 12 }).map((_, index) => (
                    <div key={`file-skeleton-${index}`} className={`h-3 ${widths[index % widths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                ))}
            </div>
        </div>
    )
}
