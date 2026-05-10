import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { DEFAULT_AGENT_FLAVOR, normalizeModelName, resolveClaudeModelMode } from '@hopi/protocol'
import type { AgentOutputLanguage, AutomationLaneLimits, Goal, Machine, PermissionMode, TaskPriority } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { getMachineDisplayTitle } from '@/lib/displayNames'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { BackIcon, ProjectIcon, SessionIcon } from '@/components/icons'
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CompactTabs } from '@/components/ui/CompactTabs'
import { IconButton } from '@/components/ui/icon-button'
import { Pressable } from '@/components/ui/pressable'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProject } from '@/hooks/queries/useProject'
import { useProjects } from '@/hooks/queries/useProjects'
import { useGoals } from '@/hooks/queries/useGoals'
import { useCreateProject } from '@/hooks/mutations/useCreateProject'
import { useCreateGoal } from '@/hooks/mutations/useCreateGoal'
import { useCreateTask } from '@/hooks/mutations/useCreateTask'
import { useGoalAutomationControl } from '@/hooks/mutations/useGoalAutomationControl'
import { useStartTaskSession } from '@/hooks/mutations/useStartTaskSession'
import { useWorkflowStrategies } from '@/hooks/queries/useWorkflowStrategies'
import { useRecentProjects } from '@/hooks/useRecentProjects'
import { useRecentProjectTabs } from '@/hooks/useRecentProjectTabs'
import { ProjectKanbanBoard } from '@/routes/projects/kanban'
import { NewTaskDialog } from '@/routes/projects/kanban-new-task-dialog'
import { GoalSwitcher } from '@/routes/projects/goal-switcher'
import { CreateGoalDialog } from '@/routes/projects/create-goal-dialog'
import { GoalPlanningPage } from '@/routes/projects/goal-planning-page'
import { useSelectedProjectGoal } from '@/routes/projects/selected-goal-storage'
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
                                    className="app-interactive-card w-full rounded-lg app-shadow-border bg-[var(--app-bg)] p-3 text-left"
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
    goals: Goal[]
    selectedGoalId: string | null
    isGoalsLoading: boolean
    onBackToProjects: () => void
    onOpenSettings: () => void
    onSelectGoal: (goalId: string) => void
    onOpenCreateGoal: () => void
    onOpenNewTask: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { project } = useProject(api, props.projectId)
    const { projects } = useProjects(api, { includeArchived: false })
    const {
        pauseGoalAutomation,
        resumeGoalAutomation,
        isPending: isGoalAutomationTogglePending
    } = useGoalAutomationControl(api)
    const { recentProjectIds, markProjectUsed } = useRecentProjects()
    const planningMatch = matchRoute({ to: '/projects/$projectId/planning' })
    const isPlanningRoute = Boolean(planningMatch && planningMatch.projectId === props.projectId)
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

    const projectViewTabs = useMemo(() => [
        {
            id: 'board',
            label: t('projects.tabs.board'),
            title: t('projects.tabs.board')
        },
        {
            id: 'planning',
            label: t('projects.tabs.planning'),
            title: t('projects.tabs.planning')
        }
    ], [t])

    const handleProjectViewTab = useCallback((tabId: string) => {
        if (tabId === 'planning') {
            void navigate({ to: '/projects/$projectId/planning', params: { projectId: props.projectId } })
            return
        }

        void navigate({ to: '/projects/$projectId', params: { projectId: props.projectId } })
    }, [navigate, props.projectId])

    const handleToggleGoalAutomationPause = useCallback((goalId: string) => {
        if (isGoalAutomationTogglePending) return
        const goal = props.goals.find((candidate) => candidate.id === goalId)
        if (!goal) return

        void (async () => {
            try {
                if (goal.automationPausedAt) {
                    const updated = await resumeGoalAutomation(goal.id)
                    addToast({ title: t('projects.toast.automationResumed'), body: updated.title, sessionId: '', url: '' })
                    return
                }

                const updated = await pauseGoalAutomation(goal.id)
                addToast({ title: t('projects.toast.automationPaused'), body: updated.title, sessionId: '', url: '' })
            } catch (error) {
                addToast({
                    title: t('projects.toast.automationToggleFailed'),
                    body: error instanceof Error ? error.message : 'Failed to update goal automation',
                    sessionId: '',
                    url: ''
                })
            }
        })()
    }, [
        addToast,
        isGoalAutomationTogglePending,
        pauseGoalAutomation,
        props.goals,
        resumeGoalAutomation,
        t
    ])

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
                                className="max-w-[min(72vw,56rem)]"
                            />
                        ) : null}
                    </>
                }
                right={
                    <Button type="button" variant="secondary" onClick={props.onOpenSettings} className="gap-2">
                        <ProjectIcon className="h-4 w-4" />
                        {t('projects.actions.projectSettings')}
                    </Button>
                }
            />

            <GoalSwitcher
                goals={props.goals}
                selectedGoalId={props.selectedGoalId}
                isLoading={props.isGoalsLoading}
                onToggleGoalAutomationPause={handleToggleGoalAutomationPause}
                isAutomationTogglePending={isGoalAutomationTogglePending}
                onSelectGoal={props.onSelectGoal}
                onCreateGoal={props.onOpenCreateGoal}
                leading={(
                    <CompactTabs
                        items={projectViewTabs}
                        selectedId={isPlanningRoute ? 'planning' : 'board'}
                        onSelect={handleProjectViewTab}
                        ariaLabel={t('projects.tabs.label')}
                        distribution="equal"
                        className="lg:w-56 xl:w-64"
                    />
                )}
            />

            {isPlanningRoute ? (
                <div className="flex-1 min-h-0">
                    <GoalPlanningPage
                        projectId={props.projectId}
                        goalId={props.selectedGoalId}
                        isGoalsLoading={props.isGoalsLoading}
                    />
                </div>
            ) : (
                <>
                    <div className="flex-1 min-h-0">
                        <ProjectKanbanBoard
                            projectId={props.projectId}
                            goalId={props.selectedGoalId}
                            onOpenNewTask={props.onOpenNewTask}
                        />
                    </div>
                </>
            )}
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
    const [isRightPanelVisible, setIsRightPanelVisible] = useState(false)
    const [shouldRenderRightPanelContent, setShouldRenderRightPanelContent] = useState(false)

    useEffect(() => {
        if (!shouldShowRightPanel) {
            setIsRightPanelVisible(false)
            setShouldRenderRightPanelContent(false)
            return
        }

        setIsRightPanelVisible(false)
        setShouldRenderRightPanelContent(false)
        let secondFrameId = 0
        let contentTimerId = 0
        const frameId = window.requestAnimationFrame(() => {
            secondFrameId = window.requestAnimationFrame(() => {
                setIsRightPanelVisible(true)
                contentTimerId = window.setTimeout(() => {
                    setShouldRenderRightPanelContent(true)
                }, 80)
            })
        })

        return () => {
            window.cancelAnimationFrame(frameId)
            if (secondFrameId) {
                window.cancelAnimationFrame(secondFrameId)
            }
            if (contentTimerId) {
                window.clearTimeout(contentTimerId)
            }
        }
    }, [shouldShowRightPanel])

    const rightPanelStateClass = shouldShowRightPanel && isRightPanelVisible
        ? 'translate-x-0 opacity-100 pointer-events-auto'
        : 'translate-x-full opacity-0 pointer-events-none'

    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { createProject, isPending: isCreating, error: createError } = useCreateProject(api)
    const { createGoal, isPending: isCreatingGoal, error: createGoalError } = useCreateGoal(api)
    const { createTask, isPending: isCreatingTask } = useCreateTask(api)
    const { startTaskSession } = useStartTaskSession(api)

    const [createOpen, setCreateOpen] = useState(false)
    const [createGoalOpen, setCreateGoalOpen] = useState(false)
    const [newTaskOpen, setNewTaskOpen] = useState(false)

    const { project } = useProject(api, selectedProjectId ?? '')
    const { goals, isLoading: isGoalsLoading } = useGoals(api, selectedProjectId)
    const { strategies: workflowStrategies } = useWorkflowStrategies(api)
    const defaultTaskAgent: AgentType = (project?.defaultAgentFlavor as AgentType | null) ?? DEFAULT_AGENT_FLAVOR
    const projectDefaultPermissionMode = (project?.defaultPermissionMode as PermissionMode | null) ?? null
    const { selectedGoalId, selectGoal } = useSelectedProjectGoal(selectedProjectId, goals)

    const handleCreateProject = useCallback(async (input: {
        machineId: string
        name: string
        description?: string
        workspaces: Array<{ path: string; label?: string }>
        defaultSessionType?: 'simple' | 'worktree'
        worktreeTargetBranch?: string
        worktreeAutoCommitMode?: 'off' | 'per_conversation'
        worktreeCleanupAfterMerge?: boolean
        agentOutputLanguage?: AgentOutputLanguage
        autoRunEnabled?: boolean
        automationLaneLimits?: AutomationLaneLimits
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
        if (!selectedGoalId) {
            addToast({ title: t('projects.goals.empty'), body: '', sessionId: '', url: '' })
            return
        }

        const model = normalizeModelName(data.model)
        void (async () => {
            try {
                const created = await createTask({
                    projectId: selectedProjectId,
                    goalId: selectedGoalId,
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
                })

                setNewTaskOpen(false)
                addToast({ title: t('projects.tasks.created'), body: created.title, sessionId: '', url: '' })

                const workflowProfile = (created.workflowProfile ?? data.workflowProfile).trim().toLowerCase()
                if (workflowProfile !== 'gsd') {
                    return
                }

                try {
                    const started = await startTaskSession({
                        taskId: created.id,
                        projectId: selectedProjectId
                    })
                    addToast({ title: t('projects.sessions.started'), body: '', sessionId: started.sessionId, url: '' })
                } catch (error) {
                    addToast({
                        title: t('projects.sessions.startFailed'),
                        body: error instanceof Error ? error.message : 'Failed to start session',
                        sessionId: '',
                        url: ''
                    })
                }

                void navigate({
                    to: '/projects/$projectId/tasks/$taskId',
                    params: { projectId: selectedProjectId, taskId: created.id }
                })
            } catch (error) {
                addToast({
                    title: t('projects.tasks.createFailed'),
                    body: error instanceof Error ? error.message : 'Failed to create task',
                    sessionId: '',
                    url: ''
                })
            }
        })()
    }, [selectedProjectId, selectedGoalId, createTask, addToast, navigate, startTaskSession, t])

    const handleCreateGoal = useCallback(async (input: {
        title: string
        description: string | null
        successCriteria: string | null
        autopilotEnabled: boolean
        deployRequiresApproval: boolean
    }): Promise<boolean> => {
        if (!selectedProjectId) return false
        try {
            const created = await createGoal({
                projectId: selectedProjectId,
                title: input.title,
                description: input.description,
                successCriteria: input.successCriteria,
                autopilotEnabled: input.autopilotEnabled,
                deployRequiresApproval: input.deployRequiresApproval
            })
            selectGoal(created.id)
            setCreateGoalOpen(false)
            return true
        } catch (error) {
            addToast({
                title: t('projects.goals.createFailed'),
                body: error instanceof Error ? error.message : 'Failed to create goal',
                sessionId: '',
                url: ''
            })
            return false
        }
    }, [addToast, createGoal, selectGoal, selectedProjectId, t])

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
        if (!selectedGoalId) {
            addToast({ title: t('projects.goals.empty'), body: '', sessionId: '', url: '' })
            return
        }
        setNewTaskOpen(true)
    }, [addToast, selectedGoalId, t])

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
                } lg:static lg:z-auto lg:flex-1 lg:w-auto lg:translate-x-0 lg:shadow-[1px_0_0_var(--app-divider)] lg:pointer-events-auto`}
            >
                {selectedProjectId ? (
                    <ProjectBoardPanel
                        projectId={selectedProjectId}
                        goals={goals}
                        selectedGoalId={selectedGoalId}
                        isGoalsLoading={isGoalsLoading}
                        onBackToProjects={handleBackToProjects}
                        onOpenSettings={handleOpenProjectSettings}
                        onSelectGoal={selectGoal}
                        onOpenCreateGoal={() => setCreateGoalOpen(true)}
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
                className={`absolute inset-0 z-20 min-w-0 flex flex-col bg-[var(--app-bg)] overflow-hidden transform-gpu transition-[transform,opacity] duration-300 ease-out will-change-transform ${rightPanelStateClass} lg:left-auto lg:w-[480px] lg:min-w-[480px] lg:shadow-[-1px_0_0_var(--app-divider)]`}
            >
                <div className="flex-1 min-h-0 w-full">
                    {shouldRenderRightPanelContent ? (
                        <Outlet />
                    ) : (
                        <div className="flex h-full items-center justify-center p-4">
                            <LoadingState label={t('loading')} className="text-sm" />
                        </div>
                    )}
                </div>
            </div>

            <CreateProjectDialog
                api={api}
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
                    isCreating={isCreatingTask}
                    onCreate={handleCreateTask}
                />
            ) : null}

            <CreateGoalDialog
                isOpen={createGoalOpen}
                onOpenChange={setCreateGoalOpen}
                onCreate={handleCreateGoal}
                isPending={isCreatingGoal}
                error={createGoalError}
            />
        </div>
    )
}
