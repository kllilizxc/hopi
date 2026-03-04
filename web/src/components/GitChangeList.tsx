import { FileIcon } from '@/components/FileIcon'
import type { GitFileStatus } from '@/types/api'
import { Pressable } from '@/components/ui/pressable'

export type GitChangeSection = {
    key: string
    title: string
    titleClassName?: string
    files: GitFileStatus[]
    onOpenFile: (file: GitFileStatus) => void
}

type GitChangeListProps = {
    sections?: GitChangeSection[]
    stagedFiles?: GitFileStatus[]
    unstagedFiles?: GitFileStatus[]
    stagedTitle?: string
    unstagedTitle?: string
    onOpenFile?: (path: string, staged: boolean) => void
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
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || props.rootLabel

    return (
        <Pressable
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
        </Pressable>
    )
}

function resolveSections(props: GitChangeListProps): GitChangeSection[] {
    if (props.sections) {
        return props.sections
    }
    if (!props.stagedFiles || !props.unstagedFiles || !props.stagedTitle || !props.unstagedTitle || !props.onOpenFile) {
        return []
    }
    const openFile = props.onOpenFile
    return [
        {
            key: 'staged',
            title: props.stagedTitle,
            titleClassName: 'text-[var(--app-git-staged-color)]',
            files: props.stagedFiles,
            onOpenFile: (file) => openFile(file.fullPath, true)
        },
        {
            key: 'unstaged',
            title: props.unstagedTitle,
            titleClassName: 'text-[var(--app-git-unstaged-color)]',
            files: props.unstagedFiles,
            onOpenFile: (file) => openFile(file.fullPath, false)
        },
    ]
}

export function GitChangeList(props: GitChangeListProps) {
    const rootLabel = props.rootLabel ?? 'project root'
    const sections = resolveSections(props).filter((section) => section.files.length > 0)

    return (
        <div>
            {sections.map((section) => (
                <div key={section.key}>
                    <div className={`border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold ${section.titleClassName ?? 'text-[var(--app-hint)]'}`}>
                        {section.title} ({section.files.length})
                    </div>
                    {section.files.map((file, index) => (
                        <GitChangeRow
                            key={`${section.key}-${file.fullPath}-${index}`}
                            file={file}
                            rootLabel={rootLabel}
                            onOpen={() => section.onOpenFile(file)}
                            showDivider={index < section.files.length - 1}
                        />
                    ))}
                </div>
            ))}
        </div>
    )
}
