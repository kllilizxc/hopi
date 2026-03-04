import { memo, useMemo } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import type { Session } from '@/types/api'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useTranslation } from '@/lib/use-translation'
import { BackIcon, DiffIcon, FilesIcon, TaskIcon } from '@/assets/icons'
import { IconButton } from '@/components/ui/icon-button'

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

type SessionHeaderProps = {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onViewDiffs?: () => void
    onSessionDeleted?: () => void
}

function SessionHeaderImpl(props: SessionHeaderProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { session } = props
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

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <IconButton type="button" onClick={props.onBack}>
                        <BackIcon />
                    </IconButton>

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

                    {props.onViewFiles ? (
                        <IconButton type="button" onClick={props.onViewFiles} title={t('session.title')}>
                            <FilesIcon />
                        </IconButton>
                    ) : null}

                    {props.onViewDiffs ? (
                        <IconButton type="button" onClick={props.onViewDiffs} title={t('projects.workbench.tab.diffs')}>
                            <DiffIcon />
                        </IconButton>
                    ) : null}

                    {taskLink ? (
                        <IconButton
                            type="button"
                            onClick={() => navigate({
                                to: '/projects/$projectId/tasks/$taskId/task',
                                params: { projectId: taskLink.projectId, taskId: taskLink.taskId }
                            })}
                            aria-label={t('projects.workbench.tab.task')}
                            title={t('projects.workbench.tab.task')}
                        >
                            <TaskIcon />
                        </IconButton>
                    ) : null}
                </div>
            </div>
        </>
    )
}

function areSessionHeaderPropsEqual(prev: SessionHeaderProps, next: SessionHeaderProps): boolean {
    if (prev.onBack !== next.onBack || prev.onViewFiles !== next.onViewFiles || prev.onViewDiffs !== next.onViewDiffs) {
        return false
    }

    const prevSession = prev.session
    const nextSession = next.session

    return prevSession.id === nextSession.id
        && prevSession.modelMode === nextSession.modelMode
        && prevSession.metadata?.name === nextSession.metadata?.name
        && prevSession.metadata?.summary?.text === nextSession.metadata?.summary?.text
        && prevSession.metadata?.path === nextSession.metadata?.path
        && prevSession.metadata?.flavor === nextSession.metadata?.flavor
        && prevSession.metadata?.worktree?.branch === nextSession.metadata?.worktree?.branch
        && prevSession.metadata?.projectId === nextSession.metadata?.projectId
        && prevSession.metadata?.taskId === nextSession.metadata?.taskId
}

export const SessionHeader = memo(SessionHeaderImpl, areSessionHeaderPropsEqual)
