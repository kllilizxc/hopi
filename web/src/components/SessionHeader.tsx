import { memo, type ReactNode, useMemo } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import type { Session } from '@/types/api'
import { isTelegramApp } from '@/hooks/useTelegram'
import { getSessionDisplayTitle } from '@/lib/displayNames'
import { useTranslation } from '@/lib/use-translation'
import { BackIcon, DiffIcon, FilesIcon, TaskIcon } from '@/assets/icons'
import { IconButton } from '@/components/ui/icon-button'

type SessionHeaderProps = {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onViewDiffs?: () => void
    onSessionDeleted?: () => void
    extra?: ReactNode
}

function SessionHeaderImpl(props: SessionHeaderProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { session } = props
    const title = useMemo(() => getSessionDisplayTitle(session), [session])
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
                {props.extra ? (
                    <div className="mx-auto w-full max-w-content px-3 pb-3">
                        {props.extra}
                    </div>
                ) : null}
            </div>
        </>
    )
}

function areSessionHeaderPropsEqual(prev: SessionHeaderProps, next: SessionHeaderProps): boolean {
    if (prev.onBack !== next.onBack || prev.onViewFiles !== next.onViewFiles || prev.onViewDiffs !== next.onViewDiffs || prev.onSessionDeleted !== next.onSessionDeleted || prev.extra !== next.extra) {
        return false
    }

    const prevSession = prev.session
    const nextSession = next.session

    if (prevSession.id !== nextSession.id || prevSession.modelMode !== nextSession.modelMode) {
        return false
    }

    const prevMetadata = prevSession.metadata
    const nextMetadata = nextSession.metadata

    return prevMetadata?.name === nextMetadata?.name
        && prevMetadata?.summary?.text === nextMetadata?.summary?.text
        && prevMetadata?.path === nextMetadata?.path
        && prevMetadata?.flavor === nextMetadata?.flavor
        && prevMetadata?.worktree?.branch === nextMetadata?.worktree?.branch
        && prevMetadata?.projectId === nextMetadata?.projectId
        && prevMetadata?.taskId === nextMetadata?.taskId
}

export const SessionHeader = memo(SessionHeaderImpl, areSessionHeaderPropsEqual)
