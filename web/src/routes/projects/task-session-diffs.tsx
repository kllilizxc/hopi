import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitCommandResponse, GitFileStatus } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { LoadingState } from '@/components/LoadingState'
import { BackIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { parseNumStat } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { SessionFileViewer } from '@/routes/projects/session-file-viewer'

function StatusBadge(props: { status: GitFileStatus['status'] }) {
    const label = useMemo(() => {
        switch (props.status) {
            case 'added':
                return 'A'
            case 'deleted':
                return 'D'
            case 'renamed':
                return 'R'
            case 'untracked':
                return '?'
            case 'conflicted':
                return 'U'
            default:
                return 'M'
        }
    }, [props.status])

    const color = useMemo(() => {
        switch (props.status) {
            case 'added':
                return 'var(--app-git-staged-color)'
            case 'deleted':
                return 'var(--app-git-deleted-color)'
            case 'renamed':
                return 'var(--app-git-renamed-color)'
            case 'untracked':
                return 'var(--app-git-untracked-color)'
            case 'conflicted':
                return 'var(--app-git-deleted-color)'
            default:
                return 'var(--app-git-unstaged-color)'
        }
    }, [props.status])

    return (
        <span
            className="inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color, borderColor: color }}
        >
            {label}
        </span>
    )
}

function LineChanges(props: { added: number; removed: number }) {
    if (!props.added && !props.removed) return null

    return (
        <span className="flex items-center gap-1 text-[11px] font-mono">
            {props.added ? (
                <span className="text-[var(--app-diff-added-text)]">+{props.added}</span>
            ) : null}
            {props.removed ? (
                <span className="text-[var(--app-diff-removed-text)]">-{props.removed}</span>
            ) : null}
        </span>
    )
}

function GitFileRow(props: {
    file: GitFileStatus
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || 'project root'

    return (
        <button
            type="button"
            onClick={props.onOpen}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            <FileIcon fileName={props.file.fileName} size={22} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
            <div className="flex items-center gap-2">
                <LineChanges added={props.file.linesAdded} removed={props.file.linesRemoved} />
                <StatusBadge status={props.file.status} />
            </div>
        </button>
    )
}

function normalizeNumstatPath(rawPath: string): string {
    const trimmed = rawPath.trim()
    if (!trimmed) return ''

    if (trimmed.includes('{') && trimmed.includes('=>') && trimmed.includes('}')) {
        return trimmed.replace(/\{([^{}]+?)\s*=>\s*([^{}]+?)\}/g, (_, __oldPart: string, newPart: string) => newPart.trim())
    }

    if (trimmed.includes('=>')) {
        const parts = trimmed.split(/\s*=>\s*/)
        return parts[parts.length - 1]?.trim() ?? trimmed
    }

    return trimmed
}

function parseCommittedFiles(numStatOutput: string): GitFileStatus[] {
    const summary = parseNumStat(numStatOutput)

    const files = summary.files.map((file): GitFileStatus | null => {
        const fullPath = normalizeNumstatPath(file.file)
        if (!fullPath) return null
        const parts = fullPath.split('/')
        const fileName = parts[parts.length - 1] || fullPath
        const filePath = parts.slice(0, -1).join('/')

        return {
            fileName,
            filePath,
            fullPath,
            status: 'modified' as const,
            isStaged: true,
            linesAdded: file.insertions,
            linesRemoved: file.deletions
        }
    })

    return files.filter((file): file is GitFileStatus => file !== null)
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

export function TaskSessionDiffs(props: { api: ApiClient | null; sessionId: string; onBack?: () => void }) {
    const { t } = useTranslation()
    const { session } = useSession(props.api, props.sessionId)
    const { status: gitStatus, error, isLoading, refetch } = useGitStatusFiles(props.api, props.sessionId)
    const worktreeBaseCommit = session?.metadata?.worktree?.baseCommit
    const hasWorktreeBaseCommit = typeof worktreeBaseCommit === 'string' && worktreeBaseCommit.length > 0

    const committedDiffQuery = useQuery({
        queryKey: queryKeys.gitCommittedDiff(props.sessionId, worktreeBaseCommit ?? 'none'),
        queryFn: async () => {
            if (!props.api || !hasWorktreeBaseCommit) {
                throw new Error('Committed diff unavailable')
            }
            return await props.api.getGitDiffNumstat(props.sessionId, { baseRef: worktreeBaseCommit })
        },
        enabled: Boolean(props.api && props.sessionId && hasWorktreeBaseCommit)
    })

    const hasWorkingTreeChanges = Boolean(gitStatus && (gitStatus.stagedFiles.length > 0 || gitStatus.unstagedFiles.length > 0))
    const committedDiffOutput = committedDiffQuery.data?.success ? (committedDiffQuery.data.stdout ?? '') : ''
    const committedFiles = useMemo(() => parseCommittedFiles(committedDiffOutput), [committedDiffOutput])
    const showCommitted = !hasWorkingTreeChanges && committedFiles.length > 0
    const committedError = extractCommandError(committedDiffQuery.data)
    const combinedError = [error, showCommitted ? null : committedError].filter(Boolean).join(' ') || null
    const [openFile, setOpenFile] = useState<{
        path: string
        staged?: boolean
        baseRef?: string
        diffScope?: 'staged' | 'unstaged' | 'committed'
    } | null>(null)

    if (openFile) {
        return (
            <SessionFileViewer
                api={props.api}
                sessionId={props.sessionId}
                filePath={openFile.path}
                staged={openFile.staged}
                baseRef={openFile.baseRef}
                diffScope={openFile.diffScope}
                onBack={() => setOpenFile(null)}
            />
        )
    }

    if (isLoading || (hasWorktreeBaseCommit && committedDiffQuery.isLoading)) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading.git')} className="text-sm" />
            </div>
        )
    }

    const hasChanges = hasWorkingTreeChanges || showCommitted

    const handleRefresh = async () => {
        await refetch()
        if (hasWorktreeBaseCommit) {
            await committedDiffQuery.refetch()
        }
    }

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
                    <Button type="button" variant="secondary" onClick={() => void handleRefresh()}>
                        {t('projects.diffs.refresh')}
                    </Button>
                </div>
            </div>

            {combinedError ? (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] bg-amber-500/10 text-xs text-[var(--app-hint)]">
                    {combinedError}
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {gitStatus?.stagedFiles.length ? (
                        <div>
                            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-staged-color)]">
                                {t('projects.diffs.staged')} ({gitStatus.stagedFiles.length})
                            </div>
                            {gitStatus.stagedFiles.map((file, index) => (
                                <GitFileRow
                                    key={`staged-${file.fullPath}-${index}`}
                                    file={file}
                                    onOpen={() => setOpenFile({ path: file.fullPath, staged: true, diffScope: 'staged' })}
                                    showDivider={index < gitStatus.stagedFiles.length - 1 || gitStatus.unstagedFiles.length > 0}
                                />
                            ))}
                        </div>
                    ) : null}

                    {gitStatus?.unstagedFiles.length ? (
                        <div>
                            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-unstaged-color)]">
                                {t('projects.diffs.unstaged')} ({gitStatus.unstagedFiles.length})
                            </div>
                            {gitStatus.unstagedFiles.map((file, index) => (
                                <GitFileRow
                                    key={`unstaged-${file.fullPath}-${index}`}
                                    file={file}
                                    onOpen={() => setOpenFile({ path: file.fullPath, staged: false, diffScope: 'unstaged' })}
                                    showDivider={index < gitStatus.unstagedFiles.length - 1}
                                />
                            ))}
                        </div>
                    ) : null}

                    {showCommitted ? (
                        <div>
                            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-staged-color)]">
                                {t('projects.diffs.committed')} ({committedFiles.length})
                            </div>
                            {committedFiles.map((file, index) => (
                                <GitFileRow
                                    key={`committed-${file.fullPath}-${index}`}
                                    file={file}
                                    onOpen={() => setOpenFile({
                                        path: file.fullPath,
                                        baseRef: worktreeBaseCommit,
                                        diffScope: 'committed'
                                    })}
                                    showDivider={index < committedFiles.length - 1}
                                />
                            ))}
                        </div>
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
