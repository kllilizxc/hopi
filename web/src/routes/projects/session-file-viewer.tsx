import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitCommandResponse } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'
import { decodeBase64 } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const MAX_COPYABLE_FILE_BYTES = 1_000_000

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

function resolveLanguage(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    const ext = parts[parts.length - 1]?.toLowerCase()
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

export function SessionFileViewer(props: {
    api: ApiClient | null
    sessionId: string
    filePath: string
    staged?: boolean
    onBack: () => void
}) {
    const { t } = useTranslation()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const { copied: contentCopied, copy: copyContent } = useCopyToClipboard()

    const fileName = useMemo(() => props.filePath.split('/').pop() || props.filePath || 'File', [props.filePath])

    const diffQuery = useQuery({
        queryKey: queryKeys.gitFileDiff(props.sessionId, props.filePath, props.staged),
        queryFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.getGitDiffFile(props.sessionId, props.filePath, props.staged)
        },
        enabled: Boolean(props.api && props.sessionId && props.filePath)
    })

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(props.sessionId, props.filePath),
        queryFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.readSessionFile(props.sessionId, props.filePath)
        },
        enabled: Boolean(props.api && props.sessionId && props.filePath)
    })

    const diffContent = diffQuery.data?.success ? (diffQuery.data.stdout ?? '') : ''
    const diffError = extractCommandError(diffQuery.data)
    const diffSuccess = diffQuery.data?.success === true
    const diffFailed = diffQuery.data?.success === false

    const fileContentResult = fileQuery.data
    const decodedContentResult = fileContentResult?.success && fileContentResult.content
        ? decodeBase64(fileContentResult.content)
        : { text: '', ok: true }
    const decodedContent = decodedContentResult.text
    const binaryFile = fileContentResult?.success
        ? !decodedContentResult.ok || isBinaryContent(decodedContent)
        : false

    const language = useMemo(() => resolveLanguage(props.filePath), [props.filePath])
    const highlighted = useShikiHighlighter(decodedContent, language)
    const contentSizeBytes = useMemo(
        () => (decodedContent ? getUtf8ByteLength(decodedContent) : 0),
        [decodedContent]
    )

    const canCopyContent = fileContentResult?.success === true
        && !binaryFile
        && decodedContent.length > 0
        && contentSizeBytes <= MAX_COPYABLE_FILE_BYTES

    const [displayMode, setDisplayMode] = useState<'diff' | 'file'>('diff')

    useEffect(() => {
        if (diffSuccess && !diffContent) {
            setDisplayMode('file')
            return
        }
        if (diffFailed) {
            setDisplayMode('file')
        }
    }, [diffSuccess, diffFailed, diffContent])

    const loading = diffQuery.isLoading || fileQuery.isLoading
    const fileError = fileContentResult && !fileContentResult.success
        ? (fileContentResult.error ?? 'Failed to read file')
        : null
    const diffErrorMessage = diffError ? `Diff unavailable: ${diffError}` : null

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between gap-3">
                <Button type="button" variant="secondary" onClick={props.onBack}>
                    {t('projects.files.back')}
                </Button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{fileName}</div>
                    <div className="truncate text-[10px] text-[var(--app-hint)]">{props.filePath}</div>
                </div>
            </div>

            <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center gap-2">
                <FileIcon fileName={fileName} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">{props.filePath}</span>
                <button
                    type="button"
                    onClick={() => void copyPath(props.filePath)}
                    className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                    title={t('projects.files.copyPath')}
                >
                    {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </button>
            </div>

            {diffContent ? (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setDisplayMode('diff')}
                        className={`rounded px-3 py-1 text-xs font-semibold ${displayMode === 'diff' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}
                    >
                        {t('projects.files.viewDiff')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setDisplayMode('file')}
                        className={`rounded px-3 py-1 text-xs font-semibold ${displayMode === 'file' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}
                    >
                        {t('projects.files.viewFile')}
                    </button>

                    <div className="ml-auto text-[10px] text-[var(--app-hint)]">
                        {props.staged ? t('projects.files.staged') : t('projects.files.unstaged')}
                    </div>
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4 space-y-3">
                    {diffErrorMessage ? (
                        <div className="rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">
                            {diffErrorMessage}
                        </div>
                    ) : null}

                    {loading ? (
                        <FileContentSkeleton label={t('loading.files')} />
                    ) : fileError ? (
                        <div className="text-sm text-red-600">{fileError}</div>
                    ) : displayMode === 'diff' && diffContent ? (
                        <DiffDisplay diffContent={diffContent} />
                    ) : binaryFile ? (
                        <div className="text-sm text-[var(--app-hint)]">
                            {t('projects.files.binary')}
                        </div>
                    ) : highlighted ? (
                        <div
                            className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3 text-xs"
                            dangerouslySetInnerHTML={{ __html: highlighted }}
                        />
                    ) : (
                        <pre className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3 text-xs whitespace-pre-wrap">
                            {decodedContent}
                        </pre>
                    )}

                    {canCopyContent ? (
                        <div className="flex justify-end">
                            <Button type="button" variant="secondary" onClick={() => void copyContent(decodedContent)}>
                                {contentCopied ? t('projects.files.copied') : t('projects.files.copyContent')}
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

