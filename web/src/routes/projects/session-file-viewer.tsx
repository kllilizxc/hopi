import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { SessionFileDiffContent } from '@/components/SessionFiles/SessionFileDiffContent'
import { BackIcon, CheckIcon, CopyIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useSessionFileDiffViewer } from '@/hooks/useSessionFileDiffViewer'
import { useTranslation } from '@/lib/use-translation'

export function SessionFileViewer(props: {
    api: ApiClient | null
    sessionId: string
    filePath: string
    staged?: boolean
    baseRef?: string
    diffScope?: 'staged' | 'unstaged' | 'committed'
    onBack: () => void
}) {
    const { t } = useTranslation()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()

    const viewer = useSessionFileDiffViewer({
        api: props.api,
        sessionId: props.sessionId,
        filePath: props.filePath,
        staged: props.staged,
        baseRef: props.baseRef,
    })

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={props.onBack}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('projects.files.back')}
                    title={t('projects.files.back')}
                >
                    <BackIcon className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{viewer.fileName}</div>
                    <div className="truncate text-[10px] text-[var(--app-hint)]">{props.filePath || 'Unknown path'}</div>
                </div>
            </div>

            <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center gap-2">
                <FileIcon fileName={viewer.fileName} size={20} />
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

            <SessionFileDiffContent
                viewer={viewer}
                staged={props.staged}
                showStagedStatus
                fileErrorClassName="text-sm text-red-600"
                contentCopyVariant="button"
                labels={{
                    loading: t('loading.files'),
                    noPath: 'No file path provided.',
                    binary: t('projects.files.binary'),
                    fileEmpty: 'File is empty.',
                    noChanges: 'No changes to display.',
                    diffTab: t('projects.files.viewDiff'),
                    fileTab: t('projects.files.viewFile'),
                    diffUnavailablePrefix: 'Diff unavailable: ',
                    copyContent: t('projects.files.copyContent'),
                    copiedContent: t('projects.files.copied'),
                    staged: t('projects.files.staged'),
                    unstaged: t('projects.files.unstaged'),
                }}
            />
        </div>
    )
}
