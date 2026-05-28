import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { useSessionDirectory } from '@/hooks/queries/useSessionDirectory'
import { ChevronRightIcon, FolderIcon } from '@/assets/icons'

function DirectorySkeleton(props: { depth: number; rows?: number }) {
    const rows = props.rows ?? 4
    const indent = 12 + props.depth * 14

    return (
        <div className="animate-pulse">
            {Array.from({ length: rows }).map((_, index) => (
                <div
                    key={`dir-skel-${props.depth}-${index}`}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{ paddingLeft: indent }}
                >
                    <div className="h-5 w-5 rounded bg-[var(--app-subtle-bg)]" />
                    <div className="h-3 w-40 rounded bg-[var(--app-subtle-bg)]" />
                </div>
            ))}
        </div>
    )
}

function DirectoryErrorRow(props: { depth: number; message: string }) {
    const indent = 12 + props.depth * 14
    return (
        <div
            className="px-3 py-2 text-xs text-[var(--app-hint)] bg-amber-500/10"
            style={{ paddingLeft: indent }}
        >
            {props.message}
        </div>
    )
}

function DirectoryNodeComponent(props: {
    api: ApiClient | null
    sessionId: string
    path: string
    label: string
    depth: number
    onOpenFile: (path: string) => void
    expandedState: Map<string, boolean>
    defaultExpanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(() => (
        props.expandedState.get(props.path) ?? props.defaultExpanded ?? false
    ))
    const { entries, error, isLoading } = useSessionDirectory(props.api, props.sessionId, props.path, {
        enabled: isExpanded
    })

    const directories = useMemo(() => entries.filter((entry) => entry.type === 'directory'), [entries])
    const files = useMemo(() => entries.filter((entry) => entry.type === 'file'), [entries])
    const childDepth = props.depth + 1

    const indent = 12 + props.depth * 14
    const childIndent = 12 + childDepth * 14

    const handleToggle = useCallback(() => {
        setIsExpanded((previous) => {
            const next = !previous
            props.expandedState.set(props.path, next)
            return next
        })
    }, [props.expandedState, props.path])

    return (
        <div>
            <button
                type="button"
                onClick={handleToggle}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors"
                style={{ paddingLeft: indent }}
            >
                <ChevronRightIcon className={`text-[var(--app-hint)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                <FolderIcon className="text-[var(--app-link)]" />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{props.label}</div>
                </div>
            </button>

            {isExpanded ? (
                isLoading ? (
                    <DirectorySkeleton depth={childDepth} />
                ) : error ? (
                    <DirectoryErrorRow depth={childDepth} message={error} />
                ) : (
                    <div>
                        {directories.map((entry) => {
                            const childPath = props.path ? `${props.path}/${entry.name}` : entry.name
                            return (
                                <DirectoryNode
                                    key={childPath}
                                    api={props.api}
                                    sessionId={props.sessionId}
                                    path={childPath}
                                    label={entry.name}
                                    depth={childDepth}
                                    onOpenFile={props.onOpenFile}
                                    expandedState={props.expandedState}
                                />
                            )
                        })}

                        {files.map((entry) => {
                            const filePath = props.path ? `${props.path}/${entry.name}` : entry.name
                            return (
                                <button
                                    key={filePath}
                                    type="button"
                                    onClick={() => props.onOpenFile(filePath)}
                                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors"
                                    style={{ paddingLeft: childIndent }}
                                >
                                    <span className="h-4 w-4" />
                                    <FileIcon fileName={entry.name} size={22} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{entry.name}</div>
                                    </div>
                                </button>
                            )
                        })}

                        {directories.length === 0 && files.length === 0 ? (
                            <div
                                className="px-3 py-2 text-sm text-[var(--app-hint)]"
                                style={{ paddingLeft: childIndent }}
                            >
                                Empty directory.
                            </div>
                        ) : null}
                    </div>
                )
            ) : null}
        </div>
    )
}

const DirectoryNode = memo(DirectoryNodeComponent)

export const DirectoryTree = memo(function DirectoryTree(props: {
    api: ApiClient | null
    sessionId: string
    rootLabel: string
    onOpenFile: (path: string) => void
}) {
    const expandedStateRef = useRef<Map<string, boolean>>(new Map([['', true]]))

    return (
        <div className="app-shadow-divider-t">
            <DirectoryNode
                api={props.api}
                sessionId={props.sessionId}
                path=""
                label={props.rootLabel}
                depth={0}
                onOpenFile={props.onOpenFile}
                expandedState={expandedStateRef.current}
                defaultExpanded
            />
        </div>
    )
})

DirectoryNode.displayName = 'DirectoryNode'
DirectoryTree.displayName = 'DirectoryTree'
