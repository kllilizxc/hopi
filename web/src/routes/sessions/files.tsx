import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { FileSearchItem } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { GitChangeList } from '@/components/GitChangeList'
import { PageHeader } from '@/components/PageHeader'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { IconButton } from '@/components/ui/icon-button'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { encodeBase64 } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { FolderIcon, GitBranchIcon, RefreshIcon, SearchIcon } from '@/assets/icons'
import { useQueryClient } from '@tanstack/react-query'

function SearchResultRow(props: {
    file: FileSearchItem
    rootLabel: string
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || props.rootLabel
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="text-[var(--app-link)]" />

    return (
        <button
            type="button"
            onClick={props.onOpen}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
        </button>
    )
}

function FileListSkeleton(props: { label: string; rows?: number }) {
    const titleWidths = ['w-1/3', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5']
    const subtitleWidths = ['w-1/2', 'w-2/3', 'w-3/4', 'w-1/3']
    const rows = props.rows ?? 6

    return (
        <div className="p-3 animate-pulse space-y-3" role="status" aria-live="polite">
            <span className="sr-only">{props.label}</span>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={`skeleton-row-${index}`} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded bg-[var(--app-subtle-bg)]" />
                    <div className="flex-1 space-y-2">
                        <div className={`h-3 ${titleWidths[index % titleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                        <div className={`h-2 ${subtitleWidths[index % subtitleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                    </div>
                </div>
            ))}
        </div>
    )
}

export default function FilesPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)
    const [searchQuery, setSearchQuery] = useState('')

    const initialTab = search.tab === 'directories' ? 'directories' : 'changes'
    const [activeTab, setActiveTab] = useState<'changes' | 'directories'>(initialTab)

    const {
        status: gitStatus,
        error: gitError,
        isLoading: gitLoading,
        refetch: refetchGit
    } = useGitStatusFiles(api, sessionId)

    const shouldSearch = Boolean(searchQuery)

    const searchResults = useSessionFileSearch(api, sessionId, searchQuery, {
        enabled: shouldSearch
    })

    const handleOpenFile = useCallback((path: string, staged?: boolean) => {
        const fileSearch = staged === undefined
            ? (activeTab === 'directories'
                ? { path: encodeBase64(path), tab: 'directories' as const }
                : { path: encodeBase64(path) })
            : (activeTab === 'directories'
                ? { path: encodeBase64(path), staged, tab: 'directories' as const }
                : { path: encodeBase64(path), staged })
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId },
            search: fileSearch
        })
    }, [activeTab, navigate, sessionId])

    const branchLabel = gitStatus?.branch ?? t('session.files.branchDetached')
    const subtitle = session?.metadata?.path ?? sessionId
    const showGitErrorBanner = Boolean(gitError)
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const handleRefresh = useCallback(() => {
        if (searchQuery) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFiles(sessionId, searchQuery)
            })
            return
        }

        if (activeTab === 'directories') {
            void queryClient.invalidateQueries({
                queryKey: ['session-directory', sessionId]
            })
            return
        }

        void refetchGit()
    }, [activeTab, queryClient, refetchGit, searchQuery, sessionId])

    const handleTabChange = useCallback((nextTab: 'changes' | 'directories') => {
        setActiveTab(nextTab)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: nextTab === 'changes' ? {} : { tab: nextTab },
            replace: true,
        })
    }, [navigate, sessionId])

    return (
        <div className="flex h-full flex-col">
            <PageHeader
                title={t('projects.files.title')}
                subtitle={subtitle}
                onBack={goBack}
                backLabel={t('projects.files.back')}
                borderClassName="border-b border-[var(--app-border)]"
                contentClassName="p-3"
                right={(
                    <IconButton
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={handleRefresh}
                        title={t('projects.diffs.refresh')}
                    >
                        <RefreshIcon />
                    </IconButton>
                )}
            />

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-content p-3 border-b border-[var(--app-border)]">
                    <div className="flex items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-3 py-2">
                        <SearchIcon className="text-[var(--app-hint)]" />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={t('session.files.searchPlaceholder')}
                            className="w-full bg-transparent text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none"
                            autoCapitalize="none"
                            autoCorrect="off"
                        />
                    </div>
                </div>
            </div>

            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)]" role="tablist">
                <div className="mx-auto w-full max-w-content grid grid-cols-2">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'changes'}
                        onClick={() => handleTabChange('changes')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'changes' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        {t('session.files.tabChanges')}
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'changes' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'directories'}
                        onClick={() => handleTabChange('directories')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'directories' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        {t('session.files.tabDirectories')}
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'directories' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                </div>
            </div>

            {!gitLoading && gitStatus && !searchQuery && activeTab === 'changes' ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 border-b border-[var(--app-divider)]">
                        <div className="flex items-center gap-2 text-sm">
                            <GitBranchIcon className="text-[var(--app-hint)]" />
                            <span className="font-semibold">{branchLabel}</span>
                        </div>
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('session.files.changeCount', {
                                staged: gitStatus.totalStaged,
                                unstaged: gitStatus.totalUnstaged,
                                stagedLabel: t('projects.files.staged'),
                                unstagedLabel: t('projects.files.unstaged'),
                            })}
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {showGitErrorBanner && activeTab === 'changes' ? (
                        <div className="border-b border-[var(--app-divider)] bg-amber-500/10 px-3 py-2 text-xs text-[var(--app-hint)]">
                            {gitError}
                        </div>
                    ) : null}
                    {shouldSearch ? (
                        searchResults.isLoading ? (
                            <FileListSkeleton label={t('loading.files')} />
                        ) : searchResults.error ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">{searchResults.error}</div>
                        ) : searchResults.files.length === 0 ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">
                                {searchQuery ? t('session.files.searchNoMatch') : t('session.files.searchNoFiles')}
                            </div>
                        ) : (
                            <div className="border-t border-[var(--app-divider)]">
                                {searchResults.files.map((file, index) => (
                                    <SearchResultRow
                                        key={`${file.fullPath}-${index}`}
                                        file={file}
                                        rootLabel={t('session.files.projectRoot')}
                                        onOpen={() => handleOpenFile(file.fullPath)}
                                        showDivider={index < searchResults.files.length - 1}
                                    />
                                ))}
                            </div>
                        )
                    ) : activeTab === 'directories' ? (
                        <DirectoryTree
                            api={api}
                            sessionId={sessionId}
                            rootLabel={rootLabel}
                            onOpenFile={(path) => handleOpenFile(path)}
                        />
                    ) : gitLoading ? (
                        <FileListSkeleton label={t('loading.git')} />
                    ) : (
                        <div>
                            {gitStatus ? (
                                <GitChangeList
                                    stagedFiles={gitStatus.stagedFiles}
                                    unstagedFiles={gitStatus.unstagedFiles}
                                    stagedTitle={t('projects.diffs.staged')}
                                    unstagedTitle={t('projects.diffs.unstaged')}
                                    onOpenFile={handleOpenFile}
                                />
                            ) : null}

                            {!gitStatus ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('session.files.emptyWithHint', {
                                        message: t('projects.diffs.unavailable'),
                                        hint: t('session.files.emptyHint'),
                                    })}
                                </div>
                            ) : null}

                            {gitStatus && gitStatus.stagedFiles.length === 0 && gitStatus.unstagedFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('session.files.emptyWithHint', {
                                        message: t('projects.diffs.noChanges'),
                                        hint: t('session.files.emptyHint'),
                                    })}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
