import { useMemo, useState } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { useTask } from '@/hooks/queries/useTask'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast-context'
import { BackIcon, DiffIcon, FilesIcon, TaskIcon } from '@/assets/icons'

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

function formatSkippedReason(reason: string): string {
    if (reason === 'already_merged') {
        return 'Task already merged'
    }
    if (reason === 'no_changes') {
        return 'No changes to merge'
    }
    return reason
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }
    return String(error)
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function waitForTaskMerged(api: ApiClient, taskId: string): Promise<boolean> {
    const maxChecks = 6
    const checkDelayMs = 2_000
    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        try {
            const latest = await api.getTask(taskId)
            if (latest.task.worktreeMergedAt) {
                return true
            }
        } catch {
        }

        if (attempt < maxChecks - 1) {
            await wait(checkDelayMs)
        }
    }

    return false
}

function MergeWorktreeDialog(props: {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    isPending: boolean
    sourceBranch: string
}) {
    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Merge Worktree</DialogTitle>
                    <DialogDescription>
                        Merge changes from {props.sourceBranch} into the target branch.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.isPending}>
                        Cancel
                    </Button>
                    <Button type="button" variant="default" onClick={props.onConfirm} disabled={props.isPending}>
                        {props.isPending ? 'Merging...' : 'Merge to Target Branch'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onViewDiffs?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { addToast } = useToast()
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
    const { task } = useTask(api, taskLink?.taskId ?? null)
    const isTaskMerged = Boolean(task?.worktreeMergedAt)
    const { mergeTaskWorktree, isPending: isMergePending } = useMergeTaskWorktree(api)

    const [mergeOpen, setMergeOpen] = useState(false)
    const [isMergeFinalizing, setIsMergeFinalizing] = useState(false)
    const isMergeBusy = isMergePending || isMergeFinalizing

    const handleMergeConfirm = async () => {
        if (!taskLink || !api || isMergeBusy) {
            return
        }

        setMergeOpen(false)
        addToast({
            title: 'Merge started',
            body: 'Running in background. We will notify when it finishes.',
            sessionId: '',
            url: ''
        })

        try {
            const res = await mergeTaskWorktree({ taskId: taskLink.taskId })
            if (res.skippedReason) {
                const skippedBody = formatSkippedReason(res.skippedReason)
                const title = res.skippedReason === 'already_merged' ? 'Already merged' : 'Merge skipped'
                addToast({ title, body: skippedBody, sessionId: '', url: '' })
                return
            }

            const body = res.autoResolved
                ? `Auto-resolved conflicts before merge. ${res.commitHash ?? ''}`.trim()
                : (res.commitHash ?? '')
            addToast({ title: 'Merged successfully', body, sessionId: '', url: '' })
        } catch (error) {
            setIsMergeFinalizing(true)
            let mergedAfterFailure = false
            try {
                mergedAfterFailure = await waitForTaskMerged(api, taskLink.taskId)
            } finally {
                setIsMergeFinalizing(false)
            }

            if (mergedAfterFailure) {
                addToast({
                    title: 'Merged successfully',
                    body: 'Detected from latest task state after retry errors.',
                    sessionId: '',
                    url: ''
                })
                return
            }

            addToast({
                title: 'Merge failed',
                body: toErrorMessage(error),
                sessionId: '',
                url: ''
            })
        }
    }

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
                        <BackIcon />
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold" title={title}>
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
                            disabled={session.thinking || isTaskMerged || isMergeBusy}
                            className="rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--app-link)] text-[var(--app-bg)] hover:opacity-90 transition-colors disabled:opacity-50"
                            title={t('Merge Worktree')}
                        >
                            {isTaskMerged ? 'Merged' : session.thinking ? 'Agent thinking...' : isMergeBusy ? 'Merging...' : 'Merge'}
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

                    {props.onViewDiffs ? (
                        <button
                            type="button"
                            onClick={props.onViewDiffs}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('projects.workbench.tab.diffs')}
                        >
                            <DiffIcon />
                        </button>
                    ) : null}

                    {taskLink ? (
                        <button
                            type="button"
                            onClick={() => navigate({
                                to: '/projects/$projectId/tasks/$taskId/task',
                                params: { projectId: taskLink.projectId, taskId: taskLink.taskId }
                            })}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            aria-label={t('projects.workbench.tab.task')}
                            title={t('projects.workbench.tab.task')}
                        >
                            <TaskIcon />
                        </button>
                    ) : null}
                </div>
            </div>

            {worktreeBranch && taskLink ? (
                <MergeWorktreeDialog
                    isOpen={mergeOpen}
                    onClose={() => setMergeOpen(false)}
                    onConfirm={() => {
                        void handleMergeConfirm()
                    }}
                    isPending={isMergeBusy}
                    sourceBranch={worktreeBranch}
                />
            ) : null}
        </>
    )
}
