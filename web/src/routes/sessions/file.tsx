import { useMemo } from 'react'
import { useParams, useSearch } from '@tanstack/react-router'
import { FileIcon } from '@/components/FileIcon'
import { SessionFileDiffContent } from '@/components/SessionFiles/SessionFileDiffContent'
import { BackIcon, CheckIcon, CopyIcon } from '@/components/icons'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useSessionFileDiffViewer } from '@/hooks/useSessionFileDiffViewer'
import { decodeBase64 } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

export default function FilePage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/file' })
    const search = useSearch({ from: '/sessions/$sessionId/file' })

    const encodedPath = typeof search.path === 'string' ? search.path : ''
    const staged = search.staged
    const filePath = useMemo(() => decodePath(encodedPath), [encodedPath])

    const viewer = useSessionFileDiffViewer({
        api,
        sessionId,
        filePath,
        staged,
    })

    return (
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon className="h-5 w-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{viewer.fileName}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{filePath || t('projects.files.pathUnknown')}</div>
                    </div>
                </div>
            </div>

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                    <FileIcon fileName={viewer.fileName} size={20} />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">{filePath}</span>
                    <button
                        type="button"
                        onClick={() => void copyPath(filePath)}
                        className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        title={t('projects.files.copyPath')}
                    >
                        {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            <SessionFileDiffContent
                viewer={viewer}
                labels={{
                    loading: t('loading.files'),
                    noPath: t('projects.files.noPath'),
                    binary: t('projects.files.binary'),
                    fileEmpty: t('projects.files.fileEmpty'),
                    noChanges: t('projects.files.noChanges'),
                    diffTab: t('projects.files.viewDiff'),
                    fileTab: t('projects.files.viewFile'),
                    diffUnavailablePrefix: t('projects.files.diffUnavailablePrefix'),
                    copyContent: t('projects.files.copyContent'),
                    copiedContent: t('projects.files.copied'),
                    staged: t('projects.files.staged'),
                    unstaged: t('projects.files.unstaged'),
                }}
                contentCopyVariant="icon"
            />
        </div>
    )
}
