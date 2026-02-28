import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useMergeTaskWorktree } from '@/hooks/mutations/useMergeTaskWorktree'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { queryKeys } from '@/lib/query-keys'
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

function ImportSessionAsTaskDialog(props: {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    session: Session
    suggestedTitle: string
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const [projectId, setProjectId] = useState<string>('')
    const [title, setTitle] = useState(props.suggestedTitle)
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const machineId = props.session.metadata?.machineId ?? null

    useEffect(() => {
        if (!props.isOpen) {
            setProjectId('')
            setError(null)
            setIsPending(false)
            return
        }

        setTitle(props.suggestedTitle)
        setError(null)
    }, [props.isOpen, props.suggestedTitle])

    const projectsQuery = useQuery({
        queryKey: [...queryKeys.projects, 'active'],
        queryFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.getProjects()
        },
        enabled: Boolean(props.isOpen && props.api)
    })

    const projects = projectsQuery.data?.projects ?? []
    const filteredProjects = machineId
        ? projects.filter((p) => p.machineId === machineId && !p.archivedAt)
        : projects.filter((p) => !p.archivedAt)

    useEffect(() => {
        if (!props.isOpen) return
        if (projectId) return
        if (filteredProjects.length !== 1) return
        setProjectId(filteredProjects[0].id)
    }, [props.isOpen, projectId, filteredProjects])

    const canConfirm = Boolean(props.api && projectId && title.trim() && !isPending)

    const handleConfirm = async () => {
        if (!props.api || !canConfirm) return
        setIsPending(true)
        setError(null)
        try {
            const createdTask = await props.api.createProjectTask(projectId, {
                title: title.trim(),
                status: 'in_progress',
                sortKey: Date.now()
            })
            await props.api.attachTaskSession(createdTask.task.id, props.session.id)

            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.task(createdTask.task.id) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(props.session.id) })

            addToast({
                title: t('session.import.toastTitle'),
                body: createdTask.task.title,
                sessionId: props.session.id,
                url: ''
            })
            props.onClose()
            navigate({
                to: '/projects/$projectId/tasks/$taskId/chat',
                params: { projectId, taskId: createdTask.task.id }
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : t('dialog.error.default')
            setError(message)
        } finally {
            setIsPending(false)
        }
    }

    return (
        <Dialog
            open={props.isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    props.onClose()
                }
            }}
        >
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('session.import.title')}</DialogTitle>
                    <DialogDescription>{t('session.import.description')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('session.import.project')}
                        </label>
                        {projectsQuery.isLoading ? (
                            <div className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm text-[var(--app-hint)]">
                                {t('loading')}
                            </div>
                        ) : filteredProjects.length === 0 ? (
                            <div className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-sm text-[var(--app-hint)] space-y-3">
                                <div>{t('session.import.noProjects')}</div>
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => {
                                            props.onClose()
                                            navigate({ to: '/projects' })
                                        }}
                                    >
                                        {t('session.import.goToProjects')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                disabled={isPending}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            >
                                <option value="">{t('session.import.selectProject')}</option>
                                {filteredProjects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('session.import.taskTitle')}
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    {projectsQuery.error ? (
                        <div className="text-sm text-red-600">
                            {projectsQuery.error instanceof Error ? projectsQuery.error.message : t('dialog.error.default')}
                        </div>
                    ) : null}

                    {error ? (
                        <div className="text-sm text-red-600">{error}</div>
                    ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={handleConfirm} disabled={!canConfirm}>
                        {isPending ? t('session.import.importing') : t('session.import.confirm')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
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

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
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
    const { session, api, onSessionDeleted } = props
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

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [importOpen, setImportOpen] = useState(false)
    const [mergeOpen, setMergeOpen] = useState(false)

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
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

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onImportAsTask={!taskLink ? () => setImportOpen(true) : undefined}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />

            <ImportSessionAsTaskDialog
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                api={api}
                session={session}
                suggestedTitle={title}
            />

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
