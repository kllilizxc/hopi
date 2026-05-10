import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { SessionFileDiffContent } from '@/components/SessionFiles/SessionFileDiffContent'
import { BackIcon, CheckIcon, CopyIcon } from '@/components/icons'
import { IconButton } from '@/components/ui/icon-button'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useSessionFileDiffViewer } from '@/hooks/useSessionFileDiffViewer'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export function SessionFileViewer(props: {
    api: ApiClient | null
    sessionId: string
    filePath: string
    staged?: boolean
    baseRef?: string
    taskMergedDiffId?: string
    diffScope?: 'staged' | 'unstaged' | 'committed'
    onBack: () => void
    showSafeAreaTop?: boolean
    constrainHeaderWidth?: boolean
    contentCopyVariant?: 'icon' | 'button'
    showStagedStatus?: boolean
    fileErrorClassName?: string
}) {
    const { t } = useTranslation()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const showStagedStatus = props.showStagedStatus ?? (props.diffScope !== 'committed')

    const viewer = useSessionFileDiffViewer({
        api: props.api,
        sessionId: props.sessionId,
        filePath: props.filePath,
        staged: props.staged,
        baseRef: props.baseRef,
        taskMergedDiffId: props.taskMergedDiffId,
    })

    return (
        <div className="h-full flex flex-col">
            <div className={cn('bg-[var(--app-bg)]', props.showSafeAreaTop ? 'pt-[env(safe-area-inset-top)]' : undefined)}>
                <div className={cn(
                    'px-3 py-2 app-shadow-divider-b flex items-center justify-between gap-3',
                    props.constrainHeaderWidth ? 'mx-auto w-full max-w-content' : undefined
                )}>
                    <IconButton
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={props.onBack}
                        aria-label={t('projects.files.back')}
                        title={t('projects.files.back')}
                    >
                        <BackIcon className="h-5 w-5" />
                    </IconButton>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{viewer.fileName}</div>
                        <div className="truncate text-[10px] text-[var(--app-hint)]">{props.filePath || t('projects.files.pathUnknown')}</div>
                    </div>
                </div>
            </div>

            <div className={cn(
                'bg-[var(--app-bg)] px-3 py-2 app-shadow-divider-b flex items-center gap-2',
                props.constrainHeaderWidth ? 'mx-auto w-full max-w-content' : undefined
            )}>
                <FileIcon fileName={viewer.fileName} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">{props.filePath}</span>
                <IconButton
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void copyPath(props.filePath)}
                    className="shrink-0 rounded-md"
                    title={t('projects.files.copyPath')}
                >
                    {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </IconButton>
            </div>

            <SessionFileDiffContent
                viewer={viewer}
                staged={props.staged}
                showStagedStatus={showStagedStatus}
                fileErrorClassName={props.fileErrorClassName ?? 'text-sm text-red-600'}
                contentCopyVariant={props.contentCopyVariant ?? 'button'}
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
            />
        </div>
    )
}
