import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { getModelModesForFlavor, getPermissionModeOptionsForFlavor, isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { AgentFlavor, ModelMode, PermissionMode, Workspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DirectorySection } from '@/components/NewSession/DirectorySection'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { useSessions } from '@/hooks/queries/useSessions'
import { useProject } from '@/hooks/queries/useProject'
import { useWorkspaces } from '@/hooks/queries/useWorkspaces'
import { useArchiveProject } from '@/hooks/mutations/useArchiveProject'
import { useCreateWorkspaces } from '@/hooks/mutations/useCreateWorkspaces'
import { useDeleteWorkspace } from '@/hooks/mutations/useDeleteWorkspace'
import { useUpdateProject } from '@/hooks/mutations/useUpdateProject'
import { useUpdateWorkspace } from '@/hooks/mutations/useUpdateWorkspace'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function estimateHumanSize(bytes: number): string {
    if (!Number.isFinite(bytes)) return '0B'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
    return `${Math.round(bytes / 1024 / 1024)}MB`
}

function WorkspacesBadge(props: { ok: boolean; label: string }) {
    return (
        <Badge variant={props.ok ? 'success' : 'warning'}>
            {props.label}
        </Badge>
    )
}

type PendingWorkspace = {
    path: string
    label?: string
}

function AddWorkspacesDialog(props: {
    isOpen: boolean
    onClose: () => void
    machineId: string
    existingPaths: Set<string>
    maxNew: number
    onSave: (workspaces: PendingWorkspace[]) => Promise<void>
    isPending: boolean
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { sessions } = useSessions(api)
    const { getRecentPaths } = useRecentPaths()

    const [directory, setDirectory] = useState('')
    const [label, setLabel] = useState('')
    const [pending, setPending] = useState<PendingWorkspace[]>([])
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})

    const recentPaths = useMemo(() => getRecentPaths(props.machineId), [getRecentPaths, props.machineId])
    const allPaths = useDirectorySuggestions(props.machineId, sessions, recentPaths)

    const pathsToCheck = useMemo(() => {
        const pendingPaths = pending.map((item) => item.path)
        return Array.from(new Set([...allPaths, ...pendingPaths])).slice(0, 1000)
    }, [allPaths, pending])

    useEffect(() => {
        let cancelled = false

        if (!api || !props.machineId || pathsToCheck.length === 0) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        void api.checkMachinePathsExists(props.machineId, pathsToCheck)
            .then((result) => {
                if (cancelled) return
                setPathExistence(result.exists ?? {})
            })
            .catch(() => {
                if (cancelled) return
                setPathExistence({})
            })

        return () => {
            cancelled = true
        }
    }, [api, props.machineId, pathsToCheck])

    const verifiedPaths = useMemo(() => allPaths.filter((path) => pathExistence[path]), [allPaths, pathExistence])

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return verifiedPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [verifiedPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )

    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (!suggestion) return
        setDirectory(suggestion.text)
        clearSuggestions()
        setSuppressSuggestions(true)
    }, [suggestions, clearSuggestions])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    const handleAdd = useCallback(() => {
        const path = directory.trim()
        if (!path) return
        if (props.existingPaths.has(path)) {
            return
        }
        if (pending.some((item) => item.path === path)) {
            return
        }
        if (pending.length >= props.maxNew) {
            return
        }

        setPending((prev) => [...prev, {
            path,
            label: label.trim() ? label.trim() : undefined
        }])
        setDirectory('')
        setLabel('')
        clearSuggestions()
        setSuppressSuggestions(false)
    }, [directory, label, pending, props.existingPaths, props.maxNew, clearSuggestions])

    const handleRemovePending = useCallback((path: string) => {
        setPending((prev) => prev.filter((item) => item.path !== path))
    }, [])

    const canSave = pending.length > 0 && !props.isPending

    const handleSave = async () => {
        if (!canSave) return
        await props.onSave(pending)
        setPending([])
        setDirectory('')
        setLabel('')
        clearSuggestions()
        props.onClose()
    }

    const remaining = props.maxNew - pending.length

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('projects.workspaces.add.title')}</DialogTitle>
                    <DialogDescription>{t('projects.workspaces.add.description')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <DirectorySection
                        directory={directory}
                        suggestions={suggestions}
                        selectedIndex={selectedIndex}
                        isDisabled={props.isPending}
                        recentPaths={recentPaths}
                        onDirectoryChange={(value) => {
                            setSuppressSuggestions(false)
                            setDirectory(value)
                        }}
                        onDirectoryFocus={handleDirectoryFocus}
                        onDirectoryBlur={handleDirectoryBlur}
                        onDirectoryKeyDown={handleDirectoryKeyDown}
                        onSuggestionSelect={handleSuggestionSelect}
                        onPathClick={(path) => setDirectory(path)}
                    />

                    <div className="px-3 space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.label')}
                        </label>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            placeholder={t('projects.workspaces.fields.labelPlaceholder')}
                        />
                    </div>

                    <div className="px-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('projects.workspaces.add.remaining', { n: remaining })}
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleAdd}
                            disabled={!directory.trim() || props.isPending || pending.length >= props.maxNew}
                        >
                            {t('projects.workspaces.add.add')}
                        </Button>
                    </div>

                    {pending.length > 0 ? (
                        <div className="px-3">
                            <div className="text-xs font-medium text-[var(--app-hint)] mb-2">
                                {t('projects.workspaces.add.pending')}
                            </div>
                            <div className="flex flex-col gap-2">
                                {pending.map((item) => {
                                    const ok = Boolean(pathExistence[item.path])
                                    return (
                                        <div
                                            key={item.path}
                                            className="flex items-start justify-between gap-3 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2"
                                        >
                                            <div className="min-w-0">
                                                <div className="text-xs font-medium truncate">{item.label ?? t('projects.workspaces.unnamed')}</div>
                                                <div className="text-xs text-[var(--app-hint)] truncate" title={item.path}>{item.path}</div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <WorkspacesBadge ok={ok} label={ok ? t('projects.workspaces.pathOk') : t('projects.workspaces.pathMissing')} />
                                                <Button type="button" variant="secondary" onClick={() => handleRemovePending(item.path)} disabled={props.isPending}>
                                                    {t('projects.workspaces.add.remove')}
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.isPending}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={handleSave} disabled={!canSave}>
                        {props.isPending ? t('projects.workspaces.add.saving') : t('projects.workspaces.add.save')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function WorkspaceRow(props: {
    workspace: Workspace
    isDefault: boolean
    exists: boolean | null
    onSetDefault: () => void
    onSave: (patch: { path: string; label: string | null }) => Promise<void>
    onDelete: () => void
    isPending: boolean
}) {
    const { t } = useTranslation()
    const [path, setPath] = useState(props.workspace.path)
    const [label, setLabel] = useState(props.workspace.label ?? '')

    useEffect(() => {
        setPath(props.workspace.path)
        setLabel(props.workspace.label ?? '')
    }, [props.workspace.id, props.workspace.path, props.workspace.label])

    const dirty = path.trim() !== props.workspace.path || (label.trim() || null) !== (props.workspace.label ?? null)

    return (
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-[var(--app-hint)]">
                            <input
                                type="radio"
                                checked={props.isDefault}
                                onChange={props.onSetDefault}
                                disabled={props.isPending}
                            />
                            {t('projects.workspaces.default')}
                        </label>
                        {props.exists === null ? (
                            <Badge variant="default">{t('projects.workspaces.pathUnknown')}</Badge>
                        ) : (
                            <WorkspacesBadge ok={props.exists} label={props.exists ? t('projects.workspaces.pathOk') : t('projects.workspaces.pathMissing')} />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.label')}
                        </label>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.path')}
                        </label>
                        <input
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => props.onSave({ path: path.trim(), label: label.trim() ? label.trim() : null })}
                        disabled={props.isPending || !dirty || !path.trim()}
                    >
                        {t('button.save')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={props.onDelete}
                        disabled={props.isPending}
                    >
                        {t('projects.workspaces.remove')}
                    </Button>
                </div>
            </div>
        </div>
    )
}

export function ProjectSettingsPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { api } = useAppContext()
    const { projectId } = useParams({ from: '/projects/$projectId/settings' })

    const { project, isLoading: projectLoading, error: projectError } = useProject(api, projectId)
    const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspaces(api, projectId)
    const { updateProject, isPending: isSavingProject } = useUpdateProject(api)
    const { createWorkspaces, isPending: isCreatingWorkspaces } = useCreateWorkspaces(api)
    const { updateWorkspace, isPending: isUpdatingWorkspace } = useUpdateWorkspace(api)
    const { deleteWorkspace, isPending: isDeletingWorkspace } = useDeleteWorkspace(api)
    const { archiveProject, isPending: isArchivingProject } = useArchiveProject(api)

    const isPending = isSavingProject || isCreatingWorkspaces || isUpdatingWorkspace || isDeletingWorkspace || isArchivingProject

    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [defaultAgentFlavor, setDefaultAgentFlavor] = useState<AgentFlavor>('claude')
    const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode>('default')
    const [defaultModelMode, setDefaultModelMode] = useState<ModelMode>('default')
    const [autoRunEnabled, setAutoRunEnabled] = useState(false)
    const [maxRunningSessions, setMaxRunningSessions] = useState(5)
    const [improvementsEnabled, setImprovementsEnabled] = useState(false)
    const [improvementsMaxGeneratedNew, setImprovementsMaxGeneratedNew] = useState(5)

    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)

    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})

    useEffect(() => {
        if (!project) return
        setName(project.name ?? '')
        setDescription(project.description ?? '')
        setDefaultAgentFlavor((project.defaultAgentFlavor as AgentFlavor | null) ?? 'claude')
        setDefaultPermissionMode((project.defaultPermissionMode as PermissionMode | null) ?? 'default')
        setDefaultModelMode((project.defaultModelMode as ModelMode | null) ?? 'default')
        setAutoRunEnabled(Boolean(project.autoRunEnabled))
        setMaxRunningSessions(project.maxRunningSessions ?? 5)
        setImprovementsEnabled(Boolean(project.improvementsEnabled))
        setImprovementsMaxGeneratedNew(project.improvementsMaxGeneratedNew ?? 5)
    }, [project])

    const permissionOptions = useMemo(() => {
        return getPermissionModeOptionsForFlavor(defaultAgentFlavor)
    }, [defaultAgentFlavor])

    const modelModes = useMemo(() => {
        return getModelModesForFlavor(defaultAgentFlavor)
    }, [defaultAgentFlavor])

    useEffect(() => {
        if (!isPermissionModeAllowedForFlavor(defaultPermissionMode, defaultAgentFlavor)) {
            setDefaultPermissionMode('default')
        }
        if (defaultAgentFlavor !== 'claude') {
            setDefaultModelMode('default')
        }
        if (defaultAgentFlavor === 'claude' && defaultModelMode && !isModelModeAllowedForFlavor(defaultModelMode, defaultAgentFlavor)) {
            setDefaultModelMode('default')
        }
    }, [defaultAgentFlavor, defaultPermissionMode, defaultModelMode])

    const existingPaths = useMemo(() => new Set(workspaces.map((w) => w.path)), [workspaces])

    useEffect(() => {
        let cancelled = false

        if (!api || !project?.machineId) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        const paths = workspaces.map((w) => w.path).filter((p) => Boolean(p)).slice(0, 1000)
        if (paths.length === 0) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        void api.checkMachinePathsExists(project.machineId, paths)
            .then((result) => {
                if (cancelled) return
                setPathExistence(result.exists ?? {})
            })
            .catch(() => {
                if (cancelled) return
                setPathExistence({})
            })

        return () => {
            cancelled = true
        }
    }, [api, project?.machineId, workspaces])

    const handleSaveBasics = useCallback(async () => {
        if (!project) return

        await updateProject({
            projectId: project.id,
            patch: {
                name: name.trim() || project.name,
                description: description.trim() ? description.trim() : null,
                defaultAgentFlavor,
                defaultPermissionMode,
                defaultModelMode: defaultAgentFlavor === 'claude' ? defaultModelMode : null,
                autoRunEnabled,
                maxRunningSessions,
                improvementsEnabled,
                improvementsMaxGeneratedNew
            }
        })
        addToast({ title: t('projects.toast.saved'), body: '', sessionId: '', url: '' })
    }, [
        project,
        updateProject,
        addToast,
        t,
        name,
        description,
        defaultAgentFlavor,
        defaultPermissionMode,
        defaultModelMode,
        autoRunEnabled,
        maxRunningSessions,
        improvementsEnabled,
        improvementsMaxGeneratedNew
    ])

    const handleAddWorkspaces = useCallback(async (newWorkspaces: PendingWorkspace[]) => {
        if (!project) return
        if (newWorkspaces.length === 0) return

        await createWorkspaces({
            projectId: project.id,
            workspaces: newWorkspaces.map((ws) => ({
                path: ws.path,
                label: ws.label
            }))
        })
        addToast({
            title: t('projects.workspaces.toast.added'),
            body: t('projects.workspaces.toast.addedBody', { n: newWorkspaces.length }),
            sessionId: '',
            url: ''
        })
    }, [project, createWorkspaces, addToast, t])

    const handleSetDefaultWorkspace = useCallback(async (workspaceId: string) => {
        if (!project) return
        await updateProject({
            projectId: project.id,
            patch: { defaultWorkspaceId: workspaceId }
        })
        addToast({ title: t('projects.workspaces.toast.defaultSet'), body: '', sessionId: '', url: '' })
    }, [project, updateProject, addToast, t])

    const handleSaveWorkspace = useCallback(async (workspace: Workspace, patch: { path: string; label: string | null }) => {
        if (!project) return

        await updateWorkspace({
            projectId: project.id,
            workspaceId: workspace.id,
            patch: { path: patch.path, label: patch.label }
        })
        addToast({ title: t('projects.workspaces.toast.saved'), body: workspace.label ?? workspace.path, sessionId: '', url: '' })
    }, [project, updateWorkspace, addToast, t])

    const handleDeleteWorkspace = useCallback(async (workspace: Workspace) => {
        if (!project) return

        if (project.autoRunEnabled && workspaces.length <= 1) {
            addToast({
                title: t('projects.workspaces.toast.cannotRemoveLast.title'),
                body: t('projects.workspaces.toast.cannotRemoveLast.body'),
                sessionId: '',
                url: ''
            })
            return
        }

        const deletingDefault = (project.defaultWorkspaceId ?? null) === workspace.id
        if (deletingDefault) {
            const nextDefault = workspaces.find((w) => w.id !== workspace.id)?.id ?? null
            await updateProject({
                projectId: project.id,
                patch: { defaultWorkspaceId: nextDefault }
            })
        }

        await deleteWorkspace({ projectId: project.id, workspaceId: workspace.id })
        addToast({ title: t('projects.workspaces.toast.removed'), body: workspace.label ?? workspace.path, sessionId: '', url: '' })
    }, [project, workspaces, updateProject, deleteWorkspace, addToast, t])

    const handleArchiveProject = useCallback(async () => {
        if (!project) return
        await archiveProject(project.id)
        addToast({ title: t('projects.toast.archived'), body: project.name, sessionId: '', url: '' })
        void navigate({ to: '/projects' })
    }, [project, archiveProject, addToast, t, navigate])

    const header = (
        <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)] border-b border-[var(--app-divider)]">
            <div className="mx-auto w-full max-w-content flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/projects/$projectId', params: { projectId } })}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        aria-label={t('projects.actions.back')}
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{t('projects.settings.title')}</div>
                        <div className="text-[10px] text-[var(--app-hint)] truncate">
                            {project?.name ?? projectId}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    if (projectLoading || workspacesLoading) {
        return (
            <div className="h-full flex flex-col">
                {header}
                <div className="flex-1 flex items-center justify-center p-4">
                    <LoadingState label={t('loading')} className="text-sm" />
                </div>
            </div>
        )
    }

    if (projectError || workspacesError || !project) {
        return (
            <div className="h-full flex flex-col">
                {header}
                <div className="p-4 text-sm text-red-600">
                    {projectError ?? workspacesError ?? t('projects.settings.loadError')}
                </div>
            </div>
        )
    }

    const maxNew = Math.max(0, 50 - workspaces.length)

    return (
        <div className="h-full flex flex-col">
            {header}

            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4 space-y-6">
                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t('projects.settings.basics')}</div>
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.settings.basicsHint')}</div>
                            </div>
                            <Button type="button" variant="secondary" onClick={handleSaveBasics} disabled={isPending || !name.trim()}>
                                {isPending ? t('projects.settings.saving') : t('projects.settings.save')}
                            </Button>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.fields.name')}</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={isPending}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.fields.description')}</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={isPending}
                                rows={4}
                                className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.defaults.agent')}</label>
                                <select
                                    value={defaultAgentFlavor}
                                    onChange={(e) => setDefaultAgentFlavor(e.target.value as AgentFlavor)}
                                    disabled={isPending}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    <option value="claude">Claude</option>
                                    <option value="codex">Codex</option>
                                    <option value="gemini">Gemini</option>
                                    <option value="opencode">Opencode</option>
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('misc.permissionMode')}</label>
                                <select
                                    value={defaultPermissionMode}
                                    onChange={(e) => setDefaultPermissionMode(e.target.value as PermissionMode)}
                                    disabled={isPending}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    {permissionOptions.map((option) => (
                                        <option key={option.mode} value={option.mode}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.defaults.modelMode')}</label>
                                <select
                                    value={defaultModelMode}
                                    onChange={(e) => setDefaultModelMode(e.target.value as ModelMode)}
                                    disabled={isPending || defaultAgentFlavor !== 'claude'}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    <option value="default">Default</option>
                                    {modelModes.map((mode) => (
                                        <option key={mode} value={mode}>
                                            {mode}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('projects.automation.title')}</div>

                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={autoRunEnabled}
                                    onChange={(e) => setAutoRunEnabled(e.target.checked)}
                                    disabled={isPending}
                                />
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
                                        disabled={isPending}
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={improvementsEnabled}
                                    onChange={(e) => setImprovementsEnabled(e.target.checked)}
                                    disabled={isPending}
                                />
                                {t('projects.automation.improvements')}
                            </label>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.maxGeneratedNew')}</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={improvementsMaxGeneratedNew}
                                        onChange={(e) => setImprovementsMaxGeneratedNew(Number(e.target.value))}
                                        disabled={isPending}
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t('projects.workspaces.title')}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('projects.workspaces.hint')}
                                </div>
                            </div>
                            <Button type="button" variant="secondary" onClick={() => setAddDialogOpen(true)} disabled={isPending || maxNew <= 0}>
                                {t('projects.workspaces.add.open')}
                            </Button>
                        </div>

                        {workspaces.length === 0 ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                {t('projects.workspaces.empty')}
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-3">
                            {workspaces.map((workspace) => (
                                <WorkspaceRow
                                    key={workspace.id}
                                    workspace={workspace}
                                    isDefault={(project.defaultWorkspaceId ?? null) === workspace.id}
                                    exists={workspace.path in pathExistence ? Boolean(pathExistence[workspace.path]) : null}
                                    onSetDefault={() => handleSetDefaultWorkspace(workspace.id)}
                                    onSave={(patch) => handleSaveWorkspace(workspace, patch)}
                                    onDelete={() => handleDeleteWorkspace(workspace)}
                                    isPending={isPending}
                                />
                            ))}
                        </div>
                    </section>

                    <section className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.archive.sectionTitle')}</div>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.archive.sectionHint')}</div>
                        <Button type="button" variant="destructive" onClick={() => setArchiveConfirmOpen(true)} disabled={isPending}>
                            {t('projects.archive.confirm')}
                        </Button>
                    </section>
                </div>
            </div>

            <AddWorkspacesDialog
                isOpen={addDialogOpen}
                onClose={() => setAddDialogOpen(false)}
                machineId={project.machineId}
                existingPaths={existingPaths}
                maxNew={maxNew}
                onSave={handleAddWorkspaces}
                isPending={isCreatingWorkspaces}
            />

            <ConfirmDialog
                isOpen={archiveConfirmOpen}
                onClose={() => setArchiveConfirmOpen(false)}
                title={t('projects.archive.title')}
                description={t('projects.archive.description')}
                confirmLabel={t('projects.archive.confirm')}
                confirmingLabel={t('projects.archive.confirming')}
                onConfirm={handleArchiveProject}
                isPending={isArchivingProject}
                destructive
            />
        </div>
    )
}
