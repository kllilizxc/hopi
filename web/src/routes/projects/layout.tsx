import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { normalizeModelName, resolveClaudeModelMode } from '@hopi/protocol'
import type { Machine, PermissionMode, TaskPriority } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { getMachineDisplayTitle } from '@/lib/displayNames'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { CheckIcon, ChevronRightIcon, FolderIcon } from '@/assets/icons'
import { LoadingState } from '@/components/LoadingState'
import { BackIcon, ProjectIcon, SessionIcon } from '@/components/icons'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { Checkbox } from '@/components/ui/checkbox'
import { CompactTabs } from '@/components/ui/CompactTabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Pressable } from '@/components/ui/pressable'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProject } from '@/hooks/queries/useProject'
import { useProjects } from '@/hooks/queries/useProjects'
import { useCreateProject } from '@/hooks/mutations/useCreateProject'
import { useCreateTask } from '@/hooks/mutations/useCreateTask'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'
import { useWorkflowStrategies } from '@/hooks/queries/useWorkflowStrategies'
import { useRecentProjects } from '@/hooks/useRecentProjects'
import { useRecentProjectTabs } from '@/hooks/useRecentProjectTabs'
import { ProjectKanbanBoard } from '@/routes/projects/kanban'
import { NewTaskDialog } from '@/routes/projects/kanban-new-task-dialog'
import type { AgentType } from '@/components/NewSession/types'

function TopBar(props: {
    title?: string
    left?: React.ReactNode
    right?: React.ReactNode
    fullWidth?: boolean
}) {
    return (
        <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
            <div
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 ${
                    props.fullWidth ? '' : 'mx-auto max-w-content'
                }`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {props.left}
                    {props.title ? (
                        <div className="text-sm font-semibold truncate">{props.title}</div>
                    ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {props.right}
                </div>
            </div>
        </div>
    )
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
    machineId: string
    path: string
    depth: number
    selectedPath: string
    onSelect: (path: string) => void
    expandedState: Map<string, boolean>
    defaultExpanded?: boolean
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const [isExpanded, setIsExpanded] = useState(() => (
        props.expandedState.get(props.path) ?? props.defaultExpanded ?? false
    ))
    const { currentPath, entries, error, isLoading } = useMachineDirectory(api, props.machineId, props.path, {
        enabled: isExpanded
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

    const handleToggle = useCallback(() => {
        setIsExpanded((previous) => {
            const next = !previous
            props.expandedState.set(props.path, next)
            return next
        })
    }, [props.expandedState, props.path])

    return (
        <div>
            <div
                className={`flex items-center gap-1 px-2 py-1 ${isSelected ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                style={{ paddingLeft: indent }}
            >
                <button
                    type="button"
                    onClick={handleToggle}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
                    aria-label={isExpanded ? t('projects.workspaces.picker.collapse') : t('projects.workspaces.picker.expand')}
                >
                    <ChevronRightIcon className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
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
                    {isSelected ? <CheckIcon className="shrink-0 text-[var(--app-link)]" /> : null}
                </button>
            </div>

            {isExpanded ? (
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
                                    machineId={props.machineId}
                                    path={childPath}
                                    depth={childDepth}
                                    selectedPath={props.selectedPath}
                                    onSelect={props.onSelect}
                                    expandedState={props.expandedState}
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

function MachineDirectoryPicker(props: {
    machineId: string
    selectedPath: string
    onSelect: (path: string) => void
}) {
    const expandedStateRef = useRef<Map<string, boolean>>(new Map([['', true]]))

    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            <MachineDirectoryNode
                machineId={props.machineId}
                path=""
                depth={0}
                selectedPath={props.selectedPath}
                onSelect={props.onSelect}
                expandedState={expandedStateRef.current}
                defaultExpanded
            />
        </div>
    )
}

function CreateProjectDialog(props: {
    isOpen: boolean
    onClose: () => void
    machines: Machine[]
    isMachinesLoading: boolean
    onCreate: (input: {
        machineId: string
        name: string
        description?: string
        workspaces: Array<{ path: string; label?: string }>
        defaultSessionType?: 'simple' | 'worktree'
        worktreeTargetBranch?: string
        worktreeAutoCommitMode?: 'off' | 'per_conversation'
        worktreeCleanupAfterMerge?: boolean
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }) => Promise<string | null>
    isPending: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    const [machineId, setMachineId] = useState<string>('')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [workspacePath, setWorkspacePath] = useState('')
    const [workspaceLabel, setWorkspaceLabel] = useState('')
    const [workspaces, setWorkspaces] = useState<Array<{ path: string; label?: string }>>([])
    const [defaultSessionType, setDefaultSessionType] = useState<'simple' | 'worktree'>('simple')
    const [worktreeTargetBranch, setWorktreeTargetBranch] = useState('')
    const [worktreeAutoCommitMode, setWorktreeAutoCommitMode] = useState<'off' | 'per_conversation'>('off')
    const [worktreeCleanupAfterMerge, setWorktreeCleanupAfterMerge] = useState(false)
    const [autoRunEnabled, setAutoRunEnabled] = useState(false)
    const [maxRunningSessions, setMaxRunningSessions] = useState(5)
    const [improvementsEnabled, setImprovementsEnabled] = useState(false)
    const [improvementsMaxPendingTasks, setImprovementsMaxPendingTasks] = useState(5)

    const machineOptions = useMemo(() => {
        if (props.isMachinesLoading) {
            return [{ value: '', label: t('loading.machines'), disabled: true }]
        }
        if (props.machines.length === 0) {
            return [{ value: '', label: t('misc.noMachines'), disabled: true }]
        }
        return props.machines.map((m) => ({
            value: m.id,
            label: `${getMachineDisplayTitle(m)}${m.metadata?.platform ? ` (${m.metadata.platform})` : ''}`,
        }))
    }, [props.isMachinesLoading, props.machines, t])

    useEffect(() => {
        if (!props.isOpen) return
        if (machineId) return
        const first = props.machines[0]?.id
        if (first) {
            setMachineId(first)
        }
    }, [props.isOpen, props.machines, machineId])

    useEffect(() => {
        if (!props.isOpen) return
        setWorkspacePath('')
    }, [machineId, props.isOpen])

    const canSubmit = Boolean(machineId && name.trim() && workspaces.length > 0 && !props.isPending)

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            props.onClose()
        }
    }

    const handleSubmit = async () => {
        if (!canSubmit) return
        const normalizedTargetBranch = worktreeTargetBranch.trim()
        const createdId = await props.onCreate({
            machineId,
            name: name.trim(),
            description: description.trim() ? description.trim() : undefined,
            workspaces,
            defaultSessionType,
            worktreeTargetBranch: defaultSessionType === 'worktree' && normalizedTargetBranch ? normalizedTargetBranch : undefined,
            worktreeAutoCommitMode: defaultSessionType === 'worktree' ? worktreeAutoCommitMode : undefined,
            worktreeCleanupAfterMerge: defaultSessionType === 'worktree' ? worktreeCleanupAfterMerge : undefined,
            autoRunEnabled,
            maxRunningSessions,
            improvementsEnabled,
            improvementsMaxPendingTasks
        })
        if (createdId) {
            setName('')
            setDescription('')
            setWorkspacePath('')
            setWorkspaceLabel('')
            setWorkspaces([])
            setDefaultSessionType('simple')
            setWorktreeTargetBranch('')
            setWorktreeAutoCommitMode('off')
            setWorktreeCleanupAfterMerge(false)
            setAutoRunEnabled(false)
            setMaxRunningSessions(5)
            setImprovementsEnabled(false)
            setImprovementsMaxPendingTasks(5)
            props.onClose()
        }
    }

    const handleAddWorkspace = () => {
        const path = workspacePath.trim()
        if (!path) return
        if (workspaces.some((workspace) => workspace.path === path)) return

        setWorkspaces((prev) => [...prev, {
            path,
            label: workspaceLabel.trim() ? workspaceLabel.trim() : undefined
        }])
        setWorkspacePath('')
        setWorkspaceLabel('')
    }

    const handleRemoveWorkspace = (path: string) => {
        setWorkspaces((prev) => prev.filter((workspace) => workspace.path !== path))
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('projects.create.title')}</DialogTitle>
                    <DialogDescription>{t('projects.create.description')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('misc.machine')}
                        </label>
                        <AdaptiveSelectField
                            title={t('misc.machine')}
                            value={machineId}
                            options={machineOptions}
                            onValueChange={setMachineId}
                            disabled={props.isPending || props.isMachinesLoading || props.machines.length === 0}
                            align="start"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.fields.name')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.fields.description')}
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={props.isPending}
                            rows={4}
                            className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.path')}
                        </label>
                        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm text-[var(--app-fg)]">
                            {workspacePath || t('projects.workspaces.picker.emptySelection')}
                        </div>
                        {machineId ? (
                            <MachineDirectoryPicker
                                key={machineId}
                                machineId={machineId}
                                selectedPath={workspacePath}
                                onSelect={setWorkspacePath}
                            />
                        ) : (
                            <div className="rounded-md border border-dashed border-[var(--app-border)] px-3 py-4 text-xs text-[var(--app-hint)]">
                                {t('projects.workspaces.picker.selectMachine')}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.label')}
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={workspaceLabel}
                                onChange={(e) => setWorkspaceLabel(e.target.value)}
                                disabled={props.isPending}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                placeholder={t('projects.workspaces.fields.labelPlaceholder')}
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleAddWorkspace}
                                disabled={props.isPending || !workspacePath.trim()}
                            >
                                {t('projects.workspaces.add.add')}
                            </Button>
                        </div>
                    </div>

                    {workspaces.length > 0 ? (
                        <div className="space-y-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.workspaces.add.pending')}
                            </div>
                            <div className="flex flex-col gap-2">
                                {workspaces.map((workspace, index) => (
                                    <div
                                        key={workspace.path}
                                        className="flex items-start justify-between gap-3 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-xs font-medium truncate">
                                                {workspace.label ?? t('projects.workspaces.unnamed')}
                                                {index === 0 ? ` · ${t('projects.workspaces.default')}` : ''}
                                            </div>
                                            <div className="text-xs text-[var(--app-hint)] truncate" title={workspace.path}>
                                                {workspace.path}
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => handleRemoveWorkspace(workspace.path)}
                                            disabled={props.isPending}
                                        >
                                            {t('projects.workspaces.add.remove')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('projects.create.workspaceRequired')}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.automation.title')}</div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox checked={autoRunEnabled} onCheckedChange={setAutoRunEnabled} disabled={props.isPending} />
                            {t('projects.automation.autoRun')}
                        </label>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.maxRunning')}</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={maxRunningSessions}
                                    onChange={(e) => setMaxRunningSessions(Number(e.target.value))}
                                    disabled={props.isPending}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                />
                            </div>
                        </div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox checked={improvementsEnabled} onCheckedChange={setImprovementsEnabled} disabled={props.isPending} />
                            {t('projects.automation.improvements')}
                        </label>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.maxPendingTasks')}</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={improvementsMaxPendingTasks}
                                    onChange={(e) => setImprovementsMaxPendingTasks(Number(e.target.value))}
                                    disabled={props.isPending}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.worktree.title')}</div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={defaultSessionType === 'worktree'}
                                onCheckedChange={(enabled) => {
                                    setDefaultSessionType(enabled ? 'worktree' : 'simple')
                                    if (!enabled) {
                                        setWorktreeAutoCommitMode('off')
                                    }
                                }}
                                disabled={props.isPending}
                            />
                            {t('projects.worktree.enable')}
                        </label>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.worktree.targetBranch')}</label>
                            <input
                                type="text"
                                value={worktreeTargetBranch}
                                onChange={(e) => setWorktreeTargetBranch(e.target.value)}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                                placeholder={t('projects.worktree.targetBranchPlaceholder')}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.targetBranchHint')}</div>
                        </div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={worktreeAutoCommitMode === 'per_conversation'}
                                onCheckedChange={(enabled) => setWorktreeAutoCommitMode(enabled ? 'per_conversation' : 'off')}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                            />
                            {t('projects.worktree.autoCommit')}
                        </label>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.autoCommitHint')}</div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={worktreeCleanupAfterMerge}
                                onCheckedChange={setWorktreeCleanupAfterMerge}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                            />
                            {t('projects.worktree.cleanup')}
                        </label>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.cleanupHint')}</div>
                    </div>

                    {props.error ? (
                        <div className="text-sm text-red-600">
                            {props.error}
                        </div>
                    ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={props.onClose}
                        disabled={props.isPending}
                    >
                        {t('button.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {props.isPending ? t('projects.create.creating') : t('projects.create.create')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function ProjectsListPanel(props: {
    onSelectProject: (projectId: string) => void
    onOpenCreate: () => void
    onGoToSessions: () => void
    onGoToSettings: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { projects, isLoading, error } = useProjects(api, { includeArchived: true })
    const { machines } = useMachines(api, true)
    const [showArchived, setShowArchived] = useState(false)

    const visibleProjects = useMemo(() => {
        if (showArchived) return projects
        return projects.filter((project) => !project.archivedAt)
    }, [projects, showArchived])

    const machineById = useMemo(() => {
        const map = new Map<string, Machine>()
        for (const machine of machines) {
            map.set(machine.id, machine)
        }
        return map
    }, [machines])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <TopBar
                title={t('projects.title')}
                right={
                    <>
                        <Button type="button" variant="secondary" onClick={props.onGoToSettings}>
                            {t('projects.actions.settings')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={props.onGoToSessions} className="gap-2">
                            <SessionIcon className="h-4 w-4" />
                            {t('projects.actions.sessions')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={props.onOpenCreate}>
                            {t('projects.actions.create')}
                        </Button>
                    </>
                }
            />

            <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--app-hint)]">
                    {t('projects.count', { n: visibleProjects.length })}
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--app-hint)] cursor-pointer select-none">
                    <Checkbox checked={showArchived} onCheckedChange={setShowArchived} />
                    {t('projects.actions.showArchived')}
                </label>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto desktop-scrollbar-left">
                {error ? (
                    <div className="mx-auto w-full max-w-content px-3 py-2 text-sm text-red-600">
                        {error}
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="mx-auto w-full max-w-content px-3 py-10 flex justify-center">
                        <LoadingState label={t('loading')} className="text-sm" />
                    </div>
                ) : null}

                {!isLoading && visibleProjects.length === 0 ? (
                    <div className="mx-auto w-full max-w-content px-3 py-10 text-sm text-[var(--app-hint)] space-y-3">
                        <div>{t('projects.empty')}</div>
                        <Button type="button" variant="secondary" onClick={props.onOpenCreate}>
                            {t('projects.actions.create')}
                        </Button>
                    </div>
                ) : null}

                <div className="mx-auto w-full max-w-content px-2 pb-4">
                    <div className="flex flex-col gap-2">
                        {visibleProjects.map((project) => {
                            const machine = machineById.get(project.machineId) ?? null
                            const machineLabel = machine ? getMachineDisplayTitle(machine) : project.machineId.slice(0, 8)
                            const machineVariant = machine?.active ? 'success' : 'default'

                            return (
                                <Pressable
                                    key={project.id}
                                    onClick={() => props.onSelectProject(project.id)}
                                    className="app-interactive-card w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-left"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold truncate">{project.name}</div>
                                            {project.description ? (
                                                <div className="mt-0.5 text-xs text-[var(--app-hint)] line-clamp-2">
                                                    {project.description}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <Tag variant={machineVariant}>
                                                {machineLabel}
                                            </Tag>
                                            <div className="text-[10px] text-[var(--app-hint)]">
                                                {t('projects.workspaceCount', { n: project.workspaceCount })}
                                            </div>
                                            {project.archivedAt ? (
                                                <Tag variant="warning">{t('projects.archived')}</Tag>
                                            ) : null}
                                        </div>
                                    </div>
                                </Pressable>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

const ProjectBoardPanel = memo(function ProjectBoardPanel(props: {
    projectId: string
    onBackToProjects: () => void
    onOpenSettings: () => void
    onOpenNewTask: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { project } = useProject(api, props.projectId)
    const { projects } = useProjects(api, { includeArchived: false })
    const { recentProjectIds, markProjectUsed } = useRecentProjects()

    const recentProjects = useRecentProjectTabs({
        projects,
        currentProjectId: props.projectId,
        currentProject: project,
        recentProjectIds,
        maxTabs: 5,
    })
    const recentProjectTabs = useMemo(() => (
        recentProjects.map((p) => ({
            id: p.id,
            label: p.name,
            title: p.name
        }))
    ), [recentProjects])

    useEffect(() => {
        markProjectUsed(props.projectId)
    }, [props.projectId, markProjectUsed])

    const handleProjectClick = useCallback((projectId: string) => {
        if (projectId !== props.projectId) {
            void navigate({ to: '/projects/$projectId', params: { projectId } })
        }
    }, [props.projectId, navigate])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <TopBar
                fullWidth
                left={
                    <>
                        <IconButton
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={props.onBackToProjects}
                            aria-label={t('projects.actions.back')}
                            title={t('projects.actions.back')}
                        >
                            <BackIcon className="h-5 w-5" />
                        </IconButton>
                        {recentProjects.length > 0 ? (
                            <CompactTabs
                                items={recentProjectTabs}
                                selectedId={props.projectId}
                                onSelect={handleProjectClick}
                                ariaLabel={t('projects.title')}
                                className="max-w-md"
                            />
                        ) : null}
                    </>
                }
                right={
                    <>
                        <Button type="button" variant="secondary" onClick={props.onOpenSettings} className="gap-2">
                            <ProjectIcon className="h-4 w-4" />
                            {t('projects.actions.projectSettings')}
                        </Button>
                    </>
                }
            />

            <div className="flex-1 min-h-0">
                <ProjectKanbanBoard projectId={props.projectId} onOpenNewTask={props.onOpenNewTask} />
            </div>
        </div>
    )
})

export default function ProjectsPage() {
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { api } = useAppContext()

    const projectMatch = matchRoute({ to: '/projects/$projectId', fuzzy: true })
    const taskMatch = matchRoute({ to: '/projects/$projectId/tasks/$taskId', fuzzy: true })
    const settingsMatch = matchRoute({ to: '/projects/$projectId/settings' })

    const selectedProjectId = projectMatch ? projectMatch.projectId : null
    const isTaskRoute = Boolean(taskMatch)
    const isProjectSettingsRoute = Boolean(settingsMatch)

    const isProjectsIndex = pathname === '/projects' || pathname === '/projects/'
    const shouldShowLeftOnMobile = isProjectsIndex || (!isTaskRoute && !isProjectSettingsRoute)
    const shouldShowRightPanel = isTaskRoute || isProjectSettingsRoute

    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { createProject, isPending: isCreating, error: createError } = useCreateProject(api)
    const { createTask } = useCreateTask(api)

    const [createOpen, setCreateOpen] = useState(false)
    const [newTaskOpen, setNewTaskOpen] = useState(false)

    const { project } = useProject(api, selectedProjectId ?? '')
    const { strategies: workflowStrategies } = useWorkflowStrategies(api)
    const defaultTaskAgent: AgentType = (project?.defaultAgentFlavor as AgentType | null) ?? 'claude'
    const projectDefaultPermissionMode = (project?.defaultPermissionMode as PermissionMode | null) ?? null

    const handleCreateProject = useCallback(async (input: {
        machineId: string
        name: string
        description?: string
        workspaces: Array<{ path: string; label?: string }>
        defaultSessionType?: 'simple' | 'worktree'
        worktreeTargetBranch?: string
        worktreeAutoCommitMode?: 'off' | 'per_conversation'
        worktreeCleanupAfterMerge?: boolean
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }): Promise<string | null> => {
        try {
            const created = await createProject(input)
            addToast({ title: t('projects.toast.created'), body: created.name, sessionId: '', url: '' })
            void navigate({ to: '/projects/$projectId', params: { projectId: created.id } })
            return created.id
        } catch (error) {
            addToast({
                title: t('projects.toast.createFailed'),
                body: error instanceof Error ? error.message : 'Failed to create project',
                sessionId: '',
                url: ''
            })
            return null
        }
    }, [createProject, addToast, t, navigate])

    const handleCreateTask = useCallback((data: {
        title: string
        description: string | undefined
        priority: TaskPriority | ''
        agent: AgentType
        permissionMode: PermissionMode
        model: string
        workflowProfile: string
    }) => {
        if (!selectedProjectId) return

        const model = normalizeModelName(data.model)
        setNewTaskOpen(false)

        void createTask({
            projectId: selectedProjectId,
            title: data.title,
            description: data.description,
            priority: data.priority || undefined,
            status: 'planned',
            agentFlavor: data.agent,
            permissionMode: data.permissionMode,
            model: model ?? undefined,
            modelMode: data.agent === 'claude' ? resolveClaudeModelMode(model) ?? undefined : undefined,
            workflowProfile: data.workflowProfile,
            sortKey: Date.now()
        }).then((created) => {
            addToast({ title: t('projects.tasks.created'), body: created.title, sessionId: '', url: '' })
        }).catch((error) => {
            addToast({
                title: t('projects.tasks.createFailed'),
                body: error instanceof Error ? error.message : 'Failed to create task',
                sessionId: '',
                url: ''
            })
        })
    }, [selectedProjectId, createTask, addToast, t])

    const handleBackToProjects = useCallback(() => {
        void navigate({ to: '/projects' })
    }, [navigate])

    const handleOpenProjectSettings = useCallback(() => {
        if (!selectedProjectId) return
        void navigate({ to: '/projects/$projectId/settings', params: { projectId: selectedProjectId } })
    }, [navigate, selectedProjectId])

    const handleGoToSessions = useCallback(() => {
        void navigate({ to: '/sessions' })
    }, [navigate])

    const handleOpenNewTaskDialog = useCallback(() => {
        setNewTaskOpen(true)
    }, [])

    const handleSelectProject = useCallback((projectId: string) => {
        void navigate({ to: '/projects/$projectId', params: { projectId } })
    }, [navigate])

    const handleOpenCreateDialog = useCallback(() => {
        setCreateOpen(true)
    }, [])

    const handleGoToSettings = useCallback(() => {
        void navigate({ to: '/settings' })
    }, [navigate])

    return (
        <div className="relative flex h-full min-h-0 overflow-hidden">
            <div
                className={`absolute inset-0 z-10 min-w-0 w-full flex flex-col bg-[var(--app-bg)] transition-transform duration-200 ease-out ${
                    shouldShowLeftOnMobile
                        ? 'translate-x-0'
                        : '-translate-x-full pointer-events-none'
                } lg:static lg:z-auto lg:flex-1 lg:w-auto lg:translate-x-0 lg:border-r lg:border-[var(--app-divider)] lg:pointer-events-auto`}
            >
                {selectedProjectId ? (
                    <ProjectBoardPanel
                        projectId={selectedProjectId}
                        onBackToProjects={handleBackToProjects}
                        onOpenSettings={handleOpenProjectSettings}
                        onOpenNewTask={handleOpenNewTaskDialog}
                    />
                ) : (
                    <ProjectsListPanel
                        onSelectProject={handleSelectProject}
                        onOpenCreate={handleOpenCreateDialog}
                        onGoToSessions={handleGoToSessions}
                        onGoToSettings={handleGoToSettings}
                    />
                )}
            </div>

            <div
                className={`absolute inset-0 z-20 min-w-0 flex flex-1 flex-col bg-[var(--app-bg)] overflow-hidden transition-[transform,opacity,max-width] duration-200 ease-out ${
                    shouldShowRightPanel
                        ? 'translate-x-0 opacity-100 pointer-events-auto lg:max-w-content lg:translate-x-0 lg:opacity-100'
                        : 'translate-x-full opacity-100 pointer-events-none lg:max-w-[0px] lg:translate-x-2 lg:opacity-0 lg:pointer-events-none'
                } lg:static lg:z-auto lg:flex-none lg:w-full`}
            >
                <div className="flex-1 min-h-0 lg:w-[480px] lg:min-w-[480px]">
                    <Outlet />
                </div>
            </div>

            <CreateProjectDialog
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                machines={machines}
                isMachinesLoading={machinesLoading}
                onCreate={handleCreateProject}
                isPending={isCreating}
                error={createError}
            />

            {selectedProjectId && project ? (
                <NewTaskDialog
                    open={newTaskOpen}
                    onOpenChange={setNewTaskOpen}
                    defaultAgent={defaultTaskAgent}
                    defaultPermissionMode={projectDefaultPermissionMode}
                    workflowStrategies={workflowStrategies}
                    isCreating={false}
                    onCreate={handleCreateTask}
                />
            ) : null}
        </div>
    )
}
