import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitCommandResponse, GitFileStatus } from '@/types/api'
import { GitChangeList, type GitChangeSection } from '@/components/GitChangeList'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useTask } from '@/hooks/queries/useTask'
import { parseNumStat } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { SessionFileViewer } from '@/routes/projects/session-file-viewer'

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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGitFileStatus(value: unknown): value is GitFileStatus {
    if (!isObject(value)) return false
    return typeof value.fileName === 'string'
        && typeof value.filePath === 'string'
        && typeof value.fullPath === 'string'
        && (value.status === 'added'
            || value.status === 'deleted'
            || value.status === 'modified'
            || value.status === 'renamed'
            || value.status === 'untracked'
            || value.status === 'conflicted')
        && typeof value.isStaged === 'boolean'
        && typeof value.linesAdded === 'number'
        && typeof value.linesRemoved === 'number'
}

function normalizeMergedDiffSnapshot(value: unknown): { files: GitFileStatus[]; capturedAt?: number; baseCommit?: string } | null {
    if (!isObject(value)) return null

    const files = Array.isArray(value.files)
        ? value.files.filter(isGitFileStatus)
        : typeof value.rawNumstat === 'string'
            ? parseCommittedFiles(value.rawNumstat)
            : []

    return {
        files,
        capturedAt: typeof value.capturedAt === 'number' ? value.capturedAt : undefined,
        baseCommit: typeof value.baseCommit === 'string' ? value.baseCommit : undefined
    }
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

    // Reuse canonical task query shape to avoid cache key collisions with useTask().
    const taskId = session?.metadata?.taskId ?? null
    const { task, isLoading: isTaskLoading } = useTask(props.api, taskId)
    const mergedDiffSnapshot = normalizeMergedDiffSnapshot(task?.mergedDiffSnapshot)

    const sessionDiffQuery = useQuery({
        queryKey: queryKeys.gitCommittedDiff(props.sessionId, worktreeBaseCommit ?? 'none'),
        queryFn: async () => {
            if (!props.api || !hasWorktreeBaseCommit) {
                throw new Error('Committed diff unavailable')
            }
            return await props.api.getGitDiffNumstat(props.sessionId, { baseRef: worktreeBaseCommit })
        },
        enabled: Boolean(props.api && props.sessionId && hasWorktreeBaseCommit && !mergedDiffSnapshot)
    })

    const hasWorkingTreeChanges = Boolean(gitStatus && (gitStatus.stagedFiles.length > 0 || gitStatus.unstagedFiles.length > 0))
    const sessionDiffOutput = sessionDiffQuery.data?.success ? (sessionDiffQuery.data.stdout ?? '') : ''
    const sessionDiffFiles = useMemo(() => parseCommittedFiles(sessionDiffOutput), [sessionDiffOutput])
    const showSessionDiff = hasWorktreeBaseCommit && sessionDiffFiles.length > 0
    const sessionDiffError = extractCommandError(sessionDiffQuery.data)
    const combinedError = [error, sessionDiffError].filter(Boolean).join(' ') || null
    const [openFile, setOpenFile] = useState<{
        path: string
        staged?: boolean
        baseRef?: string
        taskMergedDiffId?: string
        diffScope?: 'staged' | 'unstaged' | 'committed'
    } | null>(null)

    const changeSections = useMemo<GitChangeSection[]>(() => {
        const sections: GitChangeSection[] = []
        if (gitStatus?.stagedFiles.length) {
            sections.push({
                key: 'staged',
                title: t('projects.diffs.staged'),
                titleClassName: 'text-[var(--app-git-staged-color)]',
                files: gitStatus.stagedFiles,
                onOpenFile: (file) => setOpenFile({ path: file.fullPath, staged: true, diffScope: 'staged' }),
            })
        }
        if (gitStatus?.unstagedFiles.length) {
            sections.push({
                key: 'unstaged',
                title: t('projects.diffs.unstaged'),
                titleClassName: 'text-[var(--app-git-unstaged-color)]',
                files: gitStatus.unstagedFiles,
                onOpenFile: (file) => setOpenFile({ path: file.fullPath, staged: false, diffScope: 'unstaged' }),
            })
        }
        if (showSessionDiff) {
            sections.push({
                key: 'committed',
                title: t('projects.diffs.sinceSessionStart'),
                titleClassName: 'text-[var(--app-git-staged-color)]',
                files: sessionDiffFiles,
                onOpenFile: (file) => setOpenFile({
                    path: file.fullPath,
                    baseRef: worktreeBaseCommit,
                    diffScope: 'committed'
                }),
            })
        }
        if (mergedDiffSnapshot && mergedDiffSnapshot.files.length > 0) {
            const mergedTaskId = task?.id ?? taskId
            sections.push({
                key: 'merged',
                title: t('projects.diffs.merged'),
                titleClassName: 'text-[var(--app-git-staged-color)]',
                files: mergedDiffSnapshot.files,
                onOpenFile: (file) => setOpenFile({
                    path: file.fullPath,
                    taskMergedDiffId: mergedTaskId ?? undefined,
                    diffScope: 'committed'
                }),
            })
        }
        return sections
    }, [gitStatus, mergedDiffSnapshot, sessionDiffFiles, showSessionDiff, t, task?.id, taskId, worktreeBaseCommit])

    if (openFile) {
        return (
            <SessionFileViewer
                api={props.api}
                sessionId={props.sessionId}
                filePath={openFile.path}
                staged={openFile.staged}
                baseRef={openFile.baseRef}
                taskMergedDiffId={openFile.taskMergedDiffId}
                diffScope={openFile.diffScope}
                onBack={() => setOpenFile(null)}
            />
        )
    }

    if (isLoading || (hasWorktreeBaseCommit && sessionDiffQuery.isLoading && !mergedDiffSnapshot) || isTaskLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading.git')} className="text-sm" />
            </div>
        )
    }

    const hasChanges = hasWorkingTreeChanges || showSessionDiff || (mergedDiffSnapshot && mergedDiffSnapshot.files.length > 0)

    const handleRefresh = async () => {
        await refetch()
        if (hasWorktreeBaseCommit) {
            await sessionDiffQuery.refetch()
        }
    }

    return (
        <div className="h-full flex flex-col">
            <PageHeader
                title={t('projects.diffs.title')}
                subtitle={gitStatus?.branch ? t('projects.diffs.branch', { name: gitStatus.branch }) : t('projects.diffs.noBranch')}
                onBack={props.onBack}
                backLabel={t('projects.files.back')}
                right={(
                    <Button type="button" variant="secondary" onClick={() => void handleRefresh()}>
                        {t('projects.diffs.refresh')}
                    </Button>
                )}
            />

            {combinedError ? (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] bg-amber-500/10 text-xs text-[var(--app-hint)]">
                    {combinedError}
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {changeSections.length > 0 ? (
                        <GitChangeList
                            sections={changeSections}
                            rootLabel={t('session.files.projectRoot')}
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
