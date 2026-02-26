import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router'
import type { Machine } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { BackIcon, ProjectIcon, SessionIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProject } from '@/hooks/queries/useProject'
import { useProjects } from '@/hooks/queries/useProjects'
import { useCreateProject } from '@/hooks/mutations/useCreateProject'
import { ProjectKanbanBoard } from '@/routes/projects/kanban'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

function TopBar(props: {
    title: string
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
                    <div className="text-sm font-semibold truncate">{props.title}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {props.right}
                </div>
            </div>
        </div>
    )
}

function CreateProjectDialog(props: {
    isOpen: boolean
    onClose: () => void
    machines: Machine[]
    isMachinesLoading: boolean
    onCreate: (input: { machineId: string; name: string; description?: string }) => Promise<string | null>
    isPending: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    const [machineId, setMachineId] = useState<string>('')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')

    useEffect(() => {
        if (!props.isOpen) return
        if (machineId) return
        const first = props.machines[0]?.id
        if (first) {
            setMachineId(first)
        }
    }, [props.isOpen, props.machines, machineId])

    const canSubmit = Boolean(machineId && name.trim() && !props.isPending)

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            props.onClose()
        }
    }

    const handleSubmit = async () => {
        if (!canSubmit) return
        const createdId = await props.onCreate({
            machineId,
            name: name.trim(),
            description: description.trim() ? description.trim() : undefined
        })
        if (createdId) {
            setName('')
            setDescription('')
            props.onClose()
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('projects.create.title')}</DialogTitle>
                    <DialogDescription>{t('projects.create.description')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('misc.machine')}
                        </label>
                        <select
                            value={machineId}
                            onChange={(e) => setMachineId(e.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        >
                            {props.isMachinesLoading ? (
                                <option value="">{t('loading.machines')}</option>
                            ) : null}
                            {!props.isMachinesLoading && props.machines.length === 0 ? (
                                <option value="">{t('misc.noMachines')}</option>
                            ) : null}
                            {props.machines.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {getMachineTitle(m)}
                                    {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
                                </option>
                            ))}
                        </select>
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
                <label className="flex items-center gap-2 text-xs text-[var(--app-hint)]">
                    <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                    />
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
                            const machineLabel = machine ? getMachineTitle(machine) : project.machineId.slice(0, 8)
                            const machineVariant = machine?.active ? 'success' : 'default'

                            return (
                                <button
                                    key={project.id}
                                    type="button"
                                    onClick={() => props.onSelectProject(project.id)}
                                    className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-left hover:bg-[var(--app-subtle-bg)] transition-colors"
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
                                            <Badge variant={machineVariant}>
                                                {machineLabel}
                                            </Badge>
                                            <div className="text-[10px] text-[var(--app-hint)]">
                                                {t('projects.workspaceCount', { n: project.workspaceCount })}
                                            </div>
                                            {project.archivedAt ? (
                                                <Badge variant="warning">{t('projects.archived')}</Badge>
                                            ) : null}
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ProjectBoardPanel(props: {
    projectId: string
    onBackToProjects: () => void
    onOpenSettings: () => void
    onGoToSessions: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { project } = useProject(api, props.projectId)

    return (
        <div className="flex h-full min-h-0 flex-col">
            <TopBar
                title={project?.name ?? t('projects.board.title')}
                fullWidth
                left={
                    <button
                        type="button"
                        onClick={props.onBackToProjects}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        aria-label={t('projects.actions.back')}
                        title={t('projects.actions.back')}
                    >
                        <BackIcon className="h-5 w-5" />
                    </button>
                }
                right={
                    <>
                        <Button type="button" variant="secondary" onClick={props.onOpenSettings} className="gap-2">
                            <ProjectIcon className="h-4 w-4" />
                            {t('projects.actions.projectSettings')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={props.onGoToSessions} className="gap-2">
                            <SessionIcon className="h-4 w-4" />
                            {t('projects.actions.sessions')}
                        </Button>
                    </>
                }
            />

            <div className="flex-1 min-h-0">
                <ProjectKanbanBoard projectId={props.projectId} />
            </div>
        </div>
    )
}

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

    const [createOpen, setCreateOpen] = useState(false)

    const handleCreateProject = useCallback(async (input: { machineId: string; name: string; description?: string }): Promise<string | null> => {
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

    return (
        <div className="flex h-full min-h-0">
            <div
                className={`${shouldShowLeftOnMobile ? 'flex' : 'hidden lg:flex'} min-w-0 w-full flex-col bg-[var(--app-bg)] lg:flex-1 lg:w-auto lg:border-r lg:border-[var(--app-divider)]`}
            >
                {selectedProjectId ? (
                    <ProjectBoardPanel
                        projectId={selectedProjectId}
                        onBackToProjects={() => navigate({ to: '/projects' })}
                        onOpenSettings={() => navigate({ to: '/projects/$projectId/settings', params: { projectId: selectedProjectId } })}
                        onGoToSessions={() => navigate({ to: '/sessions' })}
                    />
                ) : (
                    <ProjectsListPanel
                        onSelectProject={(projectId) => navigate({ to: '/projects/$projectId', params: { projectId } })}
                        onOpenCreate={() => setCreateOpen(true)}
                        onGoToSessions={() => navigate({ to: '/sessions' })}
                        onGoToSettings={() => navigate({ to: '/settings' })}
                    />
                )}
            </div>

            <div
                className={`${shouldShowRightPanel ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)] overflow-hidden transition-all duration-200 ease-out lg:flex-none lg:w-full ${
                    shouldShowRightPanel
                        ? 'lg:max-w-content lg:opacity-100 lg:translate-x-0'
                        : 'lg:max-w-[0px] lg:opacity-0 lg:translate-x-2 lg:pointer-events-none'
                }`}
            >
                {shouldShowRightPanel ? (
                    <div className="flex-1 min-h-0">
                        <Outlet />
                    </div>
                ) : null}
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
        </div>
    )
}
