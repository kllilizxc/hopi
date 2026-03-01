import { FileIcon } from '@/components/FileIcon'
import type { GitFileStatus } from '@/types/api'

type GitChangeListProps = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    stagedTitle: string
    unstagedTitle: string
    onOpenFile: (path: string, staged: boolean) => void
    rootLabel?: string
}

function getStatusBadge(status: GitFileStatus['status']) {
    switch (status) {
        case 'added':
            return { label: 'A', color: 'var(--app-git-staged-color)' }
        case 'deleted':
            return { label: 'D', color: 'var(--app-git-deleted-color)' }
        case 'renamed':
            return { label: 'R', color: 'var(--app-git-renamed-color)' }
        case 'untracked':
            return { label: '?', color: 'var(--app-git-untracked-color)' }
        case 'conflicted':
            return { label: 'U', color: 'var(--app-git-deleted-color)' }
        default:
            return { label: 'M', color: 'var(--app-git-unstaged-color)' }
    }
}

function StatusBadge(props: { status: GitFileStatus['status'] }) {
    const badge = getStatusBadge(props.status)

    return (
        <span
            className="inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color: badge.color, borderColor: badge.color }}
        >
            {badge.label}
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

function GitChangeRow(props: {
    file: GitFileStatus
    rootLabel: string
    onOpenFile: (path: string, staged: boolean) => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || props.rootLabel

    return (
        <button
            type="button"
            onClick={() => props.onOpenFile(props.file.fullPath, props.file.isStaged)}
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

export function GitChangeList(props: GitChangeListProps) {
    const rootLabel = props.rootLabel ?? 'project root'
    const hasUnstagedFiles = props.unstagedFiles.length > 0

    return (
        <div>
            {props.stagedFiles.length ? (
                <div>
                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-staged-color)]">
                        {props.stagedTitle} ({props.stagedFiles.length})
                    </div>
                    {props.stagedFiles.map((file, index) => (
                        <GitChangeRow
                            key={`staged-${file.fullPath}-${index}`}
                            file={file}
                            rootLabel={rootLabel}
                            onOpenFile={props.onOpenFile}
                            showDivider={index < props.stagedFiles.length - 1 || hasUnstagedFiles}
                        />
                    ))}
                </div>
            ) : null}

            {props.unstagedFiles.length ? (
                <div>
                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-unstaged-color)]">
                        {props.unstagedTitle} ({props.unstagedFiles.length})
                    </div>
                    {props.unstagedFiles.map((file, index) => (
                        <GitChangeRow
                            key={`unstaged-${file.fullPath}-${index}`}
                            file={file}
                            rootLabel={rootLabel}
                            onOpenFile={props.onOpenFile}
                            showDivider={index < props.unstagedFiles.length - 1}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
