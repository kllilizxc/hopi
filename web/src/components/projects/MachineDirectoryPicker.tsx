import { memo, useCallback, useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { CheckIcon, ChevronRightIcon, FolderIcon } from '@/assets/icons'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'
import { useTranslation } from '@/lib/use-translation'

export type MachineDirectoryPickerProps = {
    api: ApiClient | null
    machineId: string
    selectedPath: string
    onSelect: (path: string) => void
}

export function useMachineDirectoryTreeState(initialExpandedPaths: string[] = ['']) {
    const [expandedPaths, setExpandedPaths] = useState(() => new Set(initialExpandedPaths))

    const isExpanded = useCallback((path: string) => expandedPaths.has(path), [expandedPaths])

    const togglePath = useCallback((path: string) => {
        setExpandedPaths((previous) => {
            const next = new Set(previous)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }, [])

    return {
        isExpanded,
        togglePath,
    }
}

function joinDirectoryPath(basePath: string, name: string): string {
    if (!basePath) return name
    const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/'

    if (basePath === '/' || basePath.endsWith('/') || basePath.endsWith('\\')) {
        return `${basePath}${name}`
    }

    return `${basePath}${separator}${name}`
}

function getPathLabel(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) {
        return path || '/'
    }
    return parts[parts.length - 1] ?? path
}

function DirectoryPickerSkeleton(props: { depth: number; rows?: number }) {
    const rows = props.rows ?? 4
    const indent = 12 + props.depth * 14

    return (
        <div className="animate-pulse">
            {Array.from({ length: rows }).map((_, index) => (
                <div
                    key={`machine-dir-skel-${props.depth}-${index}`}
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

function DirectoryPickerErrorRow(props: { depth: number; message: string }) {
    const indent = 12 + props.depth * 14

    return (
        <div
            className="bg-amber-500/10 px-3 py-2 text-xs text-[var(--app-hint)]"
            style={{ paddingLeft: indent }}
        >
            {props.message}
        </div>
    )
}

const MachineDirectoryNode = memo(function MachineDirectoryNode(props: {
    api: ApiClient | null
    machineId: string
    path: string
    depth: number
    selectedPath: string
    onSelect: (path: string) => void
    isExpanded: (path: string) => boolean
    onToggle: (path: string) => void
}) {
    const { t } = useTranslation()
    const expanded = props.isExpanded(props.path)
    const { currentPath, entries, error, isLoading } = useMachineDirectory(props.api, props.machineId, props.path, {
        enabled: expanded,
    })

    const directories = useMemo(
        () => entries.filter((entry) => entry.type === 'directory'),
        [entries]
    )

    const resolvedPath = currentPath ?? props.path
    const indent = 12 + props.depth * 14
    const childDepth = props.depth + 1
    const childIndent = 12 + childDepth * 14
    const isSelected = Boolean(resolvedPath) && props.selectedPath === resolvedPath

    return (
        <div>
            <div
                className={`flex items-center gap-1 px-2 py-1 ${isSelected ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                style={{ paddingLeft: indent }}
            >
                <button
                    type="button"
                    onClick={() => props.onToggle(props.path)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
                    aria-label={expanded ? t('projects.workspaces.picker.collapse') : t('projects.workspaces.picker.expand')}
                >
                    <ChevronRightIcon className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (resolvedPath) {
                            props.onSelect(resolvedPath)
                        }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--app-subtle-bg)]"
                >
                    <FolderIcon className="shrink-0 text-[var(--app-link)]" />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{getPathLabel(resolvedPath)}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{resolvedPath || t('misc.loading')}</div>
                    </div>
                    {isSelected ? <CheckIcon className="h-4 w-4 shrink-0 text-[var(--app-link)]" /> : null}
                </button>
            </div>

            {expanded ? (
                isLoading ? (
                    <DirectoryPickerSkeleton depth={childDepth} />
                ) : error ? (
                    <DirectoryPickerErrorRow depth={childDepth} message={error} />
                ) : directories.length > 0 ? (
                    <div>
                        {directories.map((entry) => {
                            const childPath = resolvedPath
                                ? joinDirectoryPath(resolvedPath, entry.name)
                                : entry.name

                            return (
                                <MachineDirectoryNode
                                    key={childPath}
                                    api={props.api}
                                    machineId={props.machineId}
                                    path={childPath}
                                    depth={childDepth}
                                    selectedPath={props.selectedPath}
                                    onSelect={props.onSelect}
                                    isExpanded={props.isExpanded}
                                    onToggle={props.onToggle}
                                />
                            )
                        })}
                    </div>
                ) : (
                    <div
                        className="px-3 py-2 text-xs text-[var(--app-hint)]"
                        style={{ paddingLeft: childIndent }}
                    >
                        {t('projects.workspaces.picker.emptyDirectory')}
                    </div>
                )
            ) : null}
        </div>
    )
})

export function MachineDirectoryPicker(props: MachineDirectoryPickerProps) {
    const tree = useMachineDirectoryTreeState()

    return (
        <div className="overflow-hidden rounded-md app-shadow-border bg-[var(--app-bg)]">
            <MachineDirectoryNode
                api={props.api}
                machineId={props.machineId}
                path=""
                depth={0}
                selectedPath={props.selectedPath}
                onSelect={props.onSelect}
                isExpanded={tree.isExpanded}
                onToggle={tree.togglePath}
            />
        </div>
    )
}
