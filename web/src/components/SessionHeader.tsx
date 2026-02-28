import { useMemo, useState } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast-context'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function MergeWorktreeDialog(props: {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    taskId: string
    sourceBranch: string
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { mergeTaskWorktree, isPending } = useMergeTaskWorktree(props.api)
    const [error, setError] = useState<string | null>(null)

    const handleConfirm = async () => {
        if (!props.api) return
        setError(null)
        try {
            const res = await mergeTaskWorktree({ taskId: props.taskId })
            if (res.skippedReason) {
                addToast({ title: 'Merge skipped', body: res.skippedReason, sessionId: '', url: '' })
            } else {
                addToast({ title: 'Merged successfully', body: res.commitHash ?? '', sessionId: '', url: '' })
            }
            props.onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Merge Worktree</DialogTitle>
                    <DialogDescription>
                        Merge changes from {props.sourceBranch} into the target branch.
                    </DialogDescription>
                </DialogHeader>

                {error ? (
                    <div className="mt-4 text-sm text-red-600">{error}</div>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button type="button" variant="default" onClick={handleConfirm} disabled={isPending}>
                        {isPending ? 'Merging...' : 'Merge to Target Branch'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { session, api } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch

    const taskRouteMatch = matchRoute({ to: '/projects/$projectId/tasks/$taskId', fuzzy: true })
    const taskParamsFromRoute = taskRouteMatch
        ? { projectId: taskRouteMatch.projectId, taskId: taskRouteMatch.taskId }
        : null

    const taskParamsFromMetadata = session.metadata?.projectId && session.metadata?.taskId
        ? { projectId: session.metadata.projectId, taskId: session.metadata.taskId }
        : null

    const taskLink = taskParamsFromRoute ?? taskParamsFromMetadata

    const [mergeOpen, setMergeOpen] = useState(false)

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            <span>
                                {t('session.item.modelMode')}: {session.modelMode || 'default'}
                            </span>
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {worktreeBranch && taskLink ? (
                        <button
                            type="button"
                            onClick={() => setMergeOpen(true)}
                            disabled={session.thinking}
                            className="rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--app-link)] text-[var(--app-bg)] hover:opacity-90 transition-colors disabled:opacity-50"
                            title={t('Merge Worktree')}
                        >
                            {session.thinking ? 'Agent thinking...' : 'Merge'}
                        </button>
                    ) : null}

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    {taskLink ? (
                        <button
                            type="button"
                            onClick={() => navigate({
                                to: '/projects/$projectId/tasks/$taskId/task',
                                params: { projectId: taskLink.projectId, taskId: taskLink.taskId }
                            })}
                            className="rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors"
                            title={t('projects.workbench.tab.task')}
                        >
                            {t('projects.workbench.tab.task')}
                        </button>
                    ) : null}
                </div>
            </div>

            {worktreeBranch && taskLink ? (
                <MergeWorktreeDialog
                    isOpen={mergeOpen}
                    onClose={() => setMergeOpen(false)}
                    api={api}
                    taskId={taskLink.taskId}
                    sourceBranch={worktreeBranch}
                />
            ) : null}
        </>
    )
}
