import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import { GitChangeList } from '@/components/GitChangeList'
import { LoadingState } from '@/components/LoadingState'
import { BackIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useTranslation } from '@/lib/use-translation'
import { SessionFileViewer } from '@/routes/projects/session-file-viewer'

export function TaskSessionDiffs(props: { api: ApiClient | null; sessionId: string; onBack?: () => void }) {
    const { t } = useTranslation()
    const { status: gitStatus, error, isLoading, refetch } = useGitStatusFiles(props.api, props.sessionId)
    const [openFile, setOpenFile] = useState<{ path: string; staged?: boolean } | null>(null)

    if (openFile) {
        return (
            <SessionFileViewer
                api={props.api}
                sessionId={props.sessionId}
                filePath={openFile.path}
                staged={openFile.staged}
                onBack={() => setOpenFile(null)}
            />
        )
    }

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading.git')} className="text-sm" />
            </div>
        )
    }

    const hasChanges = Boolean(gitStatus && (gitStatus.stagedFiles.length > 0 || gitStatus.unstagedFiles.length > 0))

    return (
        <div className="h-full flex flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)] border-b border-[var(--app-divider)]">
                <div className="mx-auto w-full max-w-content flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {props.onBack ? (
                            <button
                                type="button"
                                onClick={props.onBack}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                aria-label={t('projects.files.back')}
                                title={t('projects.files.back')}
                            >
                                <BackIcon className="h-5 w-5" />
                            </button>
                        ) : null}
                        <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{t('projects.diffs.title')}</div>
                            <div className="text-xs text-[var(--app-hint)] truncate">
                                {gitStatus?.branch ? t('projects.diffs.branch', { name: gitStatus.branch }) : t('projects.diffs.noBranch')}
                            </div>
                        </div>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => void refetch()}>
                        {t('projects.diffs.refresh')}
                    </Button>
                </div>
            </div>

            {error ? (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] bg-amber-500/10 text-xs text-[var(--app-hint)]">
                    {error}
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {gitStatus ? (
                        <GitChangeList
                            stagedFiles={gitStatus.stagedFiles}
                            unstagedFiles={gitStatus.unstagedFiles}
                            stagedTitle={t('projects.diffs.staged')}
                            unstagedTitle={t('projects.diffs.unstaged')}
                            onOpenFile={(path, staged) => setOpenFile({ path, staged })}
                        />
                    ) : null}

                    {!gitStatus ? (
                        <div className="p-6 text-sm text-[var(--app-hint)]">
                            {t('projects.diffs.unavailable')}
                        </div>
                    ) : null}

                    {gitStatus && !hasChanges ? (
                        <div className="p-6 text-sm text-[var(--app-hint)]">
                            {t('projects.diffs.noChanges')}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
