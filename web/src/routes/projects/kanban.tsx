import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { DEFAULT_AGENT_FLAVOR } from '@hopi/protocol'
import { productStorageKey } from '@hopi/protocol/brand'
import type { Task, TaskDependency, TaskPriority } from '@/types/api'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ScrollShadow } from '@/components/ui/scroll-shadow'
import { useAppContext } from '@/lib/app-context'
import { useDeleteTask } from '@/hooks/mutations/useDeleteTask'
import { useUpdateTask } from '@/hooks/mutations/useUpdateTask'
import { useProject } from '@/hooks/queries/useProject'
import { useTasks } from '@/hooks/queries/useTasks'
import { KANBAN_COLUMNS, type GoalTaskLane, getTaskLane } from '@/lib/task-status'
import { isMobileViewport } from '@/lib/device'
import { isOptimisticTaskId } from '@/lib/optimistic-task'
import { Tag } from '@/components/ui/tag'
import { getAgentFlavorLabel } from '@/lib/agentFlavorUtils'
import { buildTaskBlockedStatusSummary } from '@/lib/task-action-runtime'
import type { AgentType } from '@/components/NewSession/types'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@/assets/icons'

const KANBAN_LANE_VALUES: GoalTaskLane[] = KANBAN_COLUMNS.map((column) => column.status)
const KANBAN_COLLAPSED_COLUMNS_STORAGE_KEY = productStorageKey('kanban-collapsed-columns-v2')
const DEFAULT_COLLAPSED_COLUMNS: Record<GoalTaskLane, boolean> = {
    planned: false,
    in_progress: false,
    in_review: false,
    merging: false,
    done: true
}

type TaskMergeRuntimeTag = {
    label: string
    variant: 'default' | 'warning' | 'error'
    title: string | null
}

function getTaskMergeRuntimeTag(t: ReturnType<typeof useTranslation>['t'], task: Task): TaskMergeRuntimeTag | null {
    const runtime = task.mergeRuntime
    if (!runtime) {
        return null
    }

    const title = runtime.latestNote ?? runtime.blockedReason ?? null
    switch (runtime.status) {
        case 'queued':
        case 'waiting':
        case 'approval_pending':
        case 'running':
            return {
                label: t('projects.tasks.merge.running'),
                variant: 'default',
                title
            }
        case 'retrying':
            return {
                label: t('projects.tasks.merge.retrying', { count: runtime.retryCount ?? 0 }),
                variant: 'warning',
                title
            }
        case 'blocked':
        case 'canceled':
            return {
                label: t('projects.tasks.merge.blocked'),
                variant: 'error',
                title
            }
        case 'succeeded':
            return null
        default:
            return null
    }
}

type CollapsedColumns = Record<GoalTaskLane, boolean>

function getDefaultCollapsedColumns(): CollapsedColumns {
    const collapsed = { ...DEFAULT_COLLAPSED_COLUMNS }
    if (!isMobileViewport()) {
        collapsed.done = false
    }
    return collapsed
}

function loadCollapsedColumnsFromStorage(): CollapsedColumns {
    const collapsed = getDefaultCollapsedColumns()
    if (typeof window === 'undefined') return collapsed

    try {
        const raw = window.localStorage.getItem(KANBAN_COLLAPSED_COLUMNS_STORAGE_KEY)
        if (!raw) return collapsed
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return collapsed

        const parsedRecord = parsed as Record<string, unknown>
        for (const lane of KANBAN_LANE_VALUES) {
            const value = parsedRecord[lane]
            if (typeof value === 'boolean') {
                collapsed[lane] = value
            }
        }
    } catch {
        return collapsed
    }

    return collapsed
}

function saveCollapsedColumnsToStorage(collapsedColumns: CollapsedColumns): void {
    if (typeof window === 'undefined') return

    try {
        window.localStorage.setItem(KANBAN_COLLAPSED_COLUMNS_STORAGE_KEY, JSON.stringify(collapsedColumns))
    } catch {
        // Ignore browser storage errors.
    }
}

function getTaskPriorityLabelKey(priority: TaskPriority): string {
    return `projects.task.priority.${priority}`
}

type KanbanStatusTheme = {
    accent1: string
    accent2: string
}

function getKanbanStatusTheme(status: GoalTaskLane): KanbanStatusTheme {
    switch (status) {
        case 'planned':
            return {
                accent1: 'var(--app-kanban-planned)',
                accent2: 'var(--app-kanban-planned-2)'
            }
        case 'in_progress':
            return {
                accent1: 'var(--app-kanban-in-progress)',
                accent2: 'var(--app-kanban-in-progress-2)'
            }
        case 'in_review':
            return {
                accent1: 'var(--app-kanban-in-review)',
                accent2: 'var(--app-kanban-in-review-2)'
            }
        case 'merging':
            return {
                accent1: 'var(--app-kanban-blocked)',
                accent2: 'var(--app-kanban-blocked-2)'
            }
        case 'done':
            return {
                accent1: 'var(--app-kanban-finished)',
                accent2: 'var(--app-kanban-finished-2)'
            }
        default:
            return {
                accent1: 'var(--app-kanban-planned)',
                accent2: 'var(--app-kanban-planned-2)'
            }
    }
}

function getTaskOrderValue(task: Task): number {
    if (typeof task.sortKey === 'number' && Number.isFinite(task.sortKey)) {
        return task.sortKey
    }
    return task.updatedAt
}

type KanbanTaskSubTask = {
    id: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    priority: 'high' | 'medium' | 'low'
}

function getSubTaskStatusLabelKey(status: KanbanTaskSubTask['status']): string {
    switch (status) {
        case 'completed':
            return 'projects.task.subtasks.status.completed'
        case 'in_progress':
            return 'projects.task.subtasks.status.inProgress'
        case 'pending':
            return 'projects.task.subtasks.status.pending'
        default:
            return 'projects.task.subtasks.status.pending'
    }
}

function getSubTaskStatusIconColor(status: KanbanTaskSubTask['status']): string {
    switch (status) {
        case 'completed':
            return 'var(--app-kanban-finished)'
        case 'in_progress':
            return 'var(--app-kanban-in-progress)'
        case 'pending':
            return 'var(--app-hint)'
        default:
            return 'var(--app-hint)'
    }
}

function getTaskSubTasks(task: Task): KanbanTaskSubTask[] {
    if (!Array.isArray(task.subTasks)) return []
    return task.subTasks.filter((item: unknown): item is KanbanTaskSubTask => {
        if (!item || typeof item !== 'object') return false
        const subTask = item as Record<string, unknown>
        if (typeof subTask.id !== 'string') return false
        if (typeof subTask.content !== 'string') return false
        if (subTask.status !== 'pending' && subTask.status !== 'in_progress' && subTask.status !== 'completed') return false
        if (subTask.priority !== 'high' && subTask.priority !== 'medium' && subTask.priority !== 'low') return false
        return true
    })
}

function getTaskSubTaskProgress(subTasks: KanbanTaskSubTask[]): { completed: number; total: number } | null {
    if (subTasks.length === 0) {
        return null
    }

    let completed = 0
    for (const subTask of subTasks) {
        if (subTask.status === 'completed') {
            completed += 1
        }
    }

    return { completed, total: subTasks.length }
}

function getTaskDependencies(task: Task): TaskDependency[] {
    return Array.isArray(task.dependencyTaskList)
        ? task.dependencyTaskList.filter((dependency) => dependency.ref.trim())
        : []
}

function sortTasksInLane(tasks: Task[]): Task[] {
    return [...tasks].sort((left, right) => {
        const leftValue = getTaskOrderValue(left)
        const rightValue = getTaskOrderValue(right)
        if (leftValue !== rightValue) {
            return rightValue - leftValue
        }
        return right.updatedAt - left.updatedAt
    })
}

type KanbanColumnsByStatus = Record<GoalTaskLane, Task[]>

function buildKanbanColumns(tasks: Task[]): KanbanColumnsByStatus {
    const grouped = Object.fromEntries(
        KANBAN_COLUMNS.map((column) => [column.status, [] as Task[]])
    ) as KanbanColumnsByStatus

    for (const task of tasks) {
        grouped[getTaskLane(task)].push(task)
    }

    for (const lane of KANBAN_LANE_VALUES) {
        grouped[lane] = sortTasksInLane(grouped[lane])
    }

    return grouped
}

type KanbanTaskCardProps = {
    task: Task
    isSelectedTask: boolean
    isGeneratedActionPending: boolean
    defaultTaskAgent: AgentType
    onActivateTask: (task: Task) => void
    onApproveGeneratedTask: (taskId: string) => void | Promise<void>
    onRejectGeneratedTask: (taskId: string) => void | Promise<void>
}

const KanbanTaskCard = memo(function KanbanTaskCard(props: KanbanTaskCardProps) {
    const { t } = useTranslation()
    const [isSubTasksExpanded, setIsSubTasksExpanded] = useState(false)

    const isGeneratedPending = props.task.source === 'improvements_scan'
    const isCreatingTask = isOptimisticTaskId(props.task.id)
    const cardAgentFlavor: AgentType = (props.task.agentFlavor as AgentType | null) ?? props.defaultTaskAgent
    const usesProjectDefaultAgent = !props.task.agentFlavor
    const subTasks = useMemo(() => getTaskSubTasks(props.task), [props.task.subTasks])
    const subTaskProgress = useMemo(() => getTaskSubTaskProgress(subTasks), [subTasks])
    const dependencies = useMemo(() => getTaskDependencies(props.task), [props.task.dependencyTaskList])
    const mergeRuntimeTag = getTaskMergeRuntimeTag(t, props.task)
    const blockedSummary = buildTaskBlockedStatusSummary(props.task)
    const blockedTagLabelKey = props.task.blockedSource === 'decision'
        ? 'projects.tasks.blockedByDecision'
        : 'projects.tasks.blocked'
    const taskTag = typeof props.task.tag === 'string' && props.task.tag.trim()
        ? props.task.tag.trim()
        : null
    const canExpandSubTasks = subTasks.length > 0
    const cardStyle = {
        '--app-card-hover-bg': 'color-mix(in srgb, var(--app-bg) 90%, #000 10%)',
        '--app-card-hover-glow': 'color-mix(in srgb, var(--kanban-accent-1) 42%, transparent)',
        '--app-card-hover-shadow-1': 'color-mix(in srgb, var(--kanban-accent-1) 24%, rgba(15, 23, 42, 0.32))',
        '--app-card-hover-shadow-2': 'color-mix(in srgb, var(--kanban-accent-2) 18%, rgba(15, 23, 42, 0.22))',
        '--app-card-selected-bg': 'color-mix(in srgb, var(--app-bg) 94%, var(--kanban-accent-1) 6%)',
        '--app-card-selected-glow': 'color-mix(in srgb, var(--kanban-accent-1) 24%, transparent)',
        '--app-card-selected-shadow-1': 'color-mix(in srgb, var(--kanban-accent-1) 22%, rgba(15, 23, 42, 0.3))',
        '--app-card-selected-shadow-2': 'color-mix(in srgb, var(--kanban-accent-2) 16%, rgba(15, 23, 42, 0.22))'
    } as CSSProperties

    useEffect(() => {
        if (!canExpandSubTasks) {
            setIsSubTasksExpanded(false)
        }
    }, [canExpandSubTasks])

    return (
        <div className="relative">
            <div
                data-kanban-task-id={props.task.id}
                onDoubleClick={() => {
                    if (isCreatingTask) return
                    props.onActivateTask(props.task)
                }}
                onClick={() => {
                    if (isCreatingTask) return
                    props.onActivateTask(props.task)
                }}
                className={`group app-interactive-card task-card-hover rounded-xl bg-[var(--app-bg)] p-3 text-left app-shadow-surface ${isCreatingTask ? 'cursor-progress' : 'cursor-pointer'} ${props.isSelectedTask ? 'app-interactive-card-selected' : ''}`}
                style={cardStyle}
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium break-words leading-snug">
                            {props.task.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {props.task.activeSessionId ? (
                                <div className="text-[10px] text-[var(--app-hint)]">
                                    {t('projects.tasks.hasSession')}
                                </div>
                            ) : null}
                            {isCreatingTask ? (
                                <Tag size="xs" variant="default">
                                    {t('projects.tasks.creating')}
                                </Tag>
                            ) : null}
                            <Tag size="xs" variant="default">
                                {getAgentFlavorLabel(cardAgentFlavor)}
                                {usesProjectDefaultAgent ? ` · ${t('projects.task.agent.projectDefault')}` : ''}
                            </Tag>
                            {props.task.priority ? (
                                <Tag size="xs" variant={props.task.priority === 'high' ? 'error' : props.task.priority === 'medium' ? 'warning' : 'default'}>
                                    {t(getTaskPriorityLabelKey(props.task.priority))}
                                </Tag>
                            ) : null}
                            {taskTag ? (
                                <Tag size="xs" variant={taskTag === 'ready' ? 'success' : 'default'}>
                                    {taskTag}
                                </Tag>
                            ) : null}
                            {props.task.workflowPhase ? (
                                <Tag size="xs" variant="default">
                                    {props.task.workflowPhase}
                                </Tag>
                            ) : null}
                            {subTaskProgress ? (
                                <Tag size="xs" variant={subTaskProgress.completed === subTaskProgress.total ? 'success' : 'default'}>
                                    {t('projects.tasks.subtasksProgress', {
                                        completed: subTaskProgress.completed,
                                        total: subTaskProgress.total
                                    })}
                                </Tag>
                            ) : null}
                            {mergeRuntimeTag ? (
                                <Tag size="xs" variant={mergeRuntimeTag.variant} title={mergeRuntimeTag.title ?? undefined}>
                                    {mergeRuntimeTag.label}
                                </Tag>
                            ) : null}
                            {blockedSummary ? (
                                <Tag size="xs" variant="error">
                                    {t(blockedTagLabelKey)}
                                </Tag>
                            ) : null}
                            {isGeneratedPending ? (
                                <Tag size="xs" variant="warning">
                                    {t('projects.tasks.generated')}
                                </Tag>
                            ) : null}
                        </div>
                        {blockedSummary?.detail ? (
                            <div className="mt-2 rounded-md bg-[var(--app-badge-error-bg)] px-2 py-1.5 text-[11px] leading-snug text-[var(--app-badge-error-text)] shadow-[inset_0_0_0_1px_var(--app-badge-error-border)]">
                                {blockedSummary.detail}
                            </div>
                        ) : null}
                        {dependencies.length > 0 ? (
                            <div
                                data-testid={`task-dependencies-${props.task.id}`}
                                className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-[var(--app-hint)]"
                            >
                                <span className="font-medium text-[var(--app-muted-fg)]">
                                    {t('projects.tasks.dependencies')}
                                </span>
                                {dependencies.map((dependency) => {
                                    const label = dependency.title?.trim() || dependency.ref
                                    return (
                                        <Tag
                                            key={dependency.ref}
                                            size="xs"
                                            variant={dependency.status === 'done' || dependency.status === 'finished' ? 'success' : 'default'}
                                            title={dependency.ref}
                                        >
                                            {label}
                                        </Tag>
                                    )
                                })}
                            </div>
                        ) : null}
                        {isGeneratedPending ? (
                            <div className="mt-2 flex items-center gap-1.5">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 px-2 py-1 text-[11px]"
                                    onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        props.onApproveGeneratedTask(props.task.id)
                                    }}
                                    disabled={props.isGeneratedActionPending}
                                >
                                    {t('projects.tasks.approve')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 px-2 py-1 text-[11px]"
                                    onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        props.onRejectGeneratedTask(props.task.id)
                                    }}
                                    disabled={props.isGeneratedActionPending}
                                >
                                    {t('projects.tasks.reject')}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
                {canExpandSubTasks ? (
                    <div className="mt-2 w-full">
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] cursor-pointer"
                            onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setIsSubTasksExpanded((current) => !current)
                            }}
                            aria-label={isSubTasksExpanded ? t('projects.tasks.subtasks.collapse') : t('projects.tasks.subtasks.expand')}
                            title={isSubTasksExpanded ? t('projects.tasks.subtasks.collapse') : t('projects.tasks.subtasks.expand')}
                        >
                            {isSubTasksExpanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
                            <span>{isSubTasksExpanded ? t('projects.tasks.subtasks.collapse') : t('projects.tasks.subtasks.expand')}</span>
                        </button>
                        {isSubTasksExpanded ? (
                            <div className="mt-1.5 w-full flex flex-col gap-1 rounded-md app-shadow-control bg-[var(--app-secondary-bg)] p-2">
                                {subTasks.map((subTask) => {
                                    const statusLabel = t(getSubTaskStatusLabelKey(subTask.status))
                                    return (
                                        <div key={subTask.id} className="w-full flex items-start gap-2 text-xs">
                                            <span
                                                aria-hidden
                                                className="mt-[4px] h-2 w-2 shrink-0 rounded-full"
                                                style={{ backgroundColor: getSubTaskStatusIconColor(subTask.status) }}
                                                title={statusLabel}
                                            />
                                            <span className="sr-only">{statusLabel}</span>
                                            <span className={`min-w-0 flex-1 break-words leading-tight ${subTask.status === 'completed' ? 'text-[var(--app-hint)] line-through' : ''}`}>
                                                {subTask.content}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    )
})

export const ProjectKanbanBoard = memo(function ProjectKanbanBoard(props: {
    projectId: string
    goalId: string | null
    onOpenNewTask: () => void
}) {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const matchRoute = useMatchRoute()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const { project } = useProject(api, props.projectId)
    const { tasks, isLoading, error } = useTasks(api, props.goalId ? props.projectId : null, props.goalId)
    const { deleteTask } = useDeleteTask(api)
    const { updateTask } = useUpdateTask(api)

    const taskRouteMatch = matchRoute({ to: '/projects/$projectId/tasks/$taskId', fuzzy: true })
    const selectedTaskId = taskRouteMatch && taskRouteMatch.projectId === props.projectId
        ? taskRouteMatch.taskId
        : null

    const defaultTaskAgent: AgentType = (project?.defaultAgentFlavor as AgentType | null) ?? DEFAULT_AGENT_FLAVOR
    const [pendingGeneratedActionTaskId, setPendingGeneratedActionTaskId] = useState<string | null>(null)
    const [collapsedColumns, setCollapsedColumns] = useState<CollapsedColumns>(() => loadCollapsedColumnsFromStorage())
    const pendingGeneratedActionTaskIdRef = useRef<string | null>(null)

    useEffect(() => {
        saveCollapsedColumnsToStorage(collapsedColumns)
    }, [collapsedColumns])

    const columns = useMemo(() => buildKanbanColumns(tasks), [tasks])

    const toggleColumnCollapsed = useCallback((status: GoalTaskLane) => {
        setCollapsedColumns((current) => ({
            ...current,
            [status]: !current[status]
        }))
    }, [])

    const handleApproveGeneratedTask = useCallback(async (taskId: string) => {
        if (pendingGeneratedActionTaskIdRef.current) return
        pendingGeneratedActionTaskIdRef.current = taskId
        setPendingGeneratedActionTaskId(taskId)
        try {
            await updateTask({
                taskId,
                patch: {
                    source: 'manual'
                }
            })
        } catch (approveError) {
            addToast({
                title: t('projects.tasks.moveFailed'),
                body: approveError instanceof Error ? approveError.message : 'Failed to approve task',
                sessionId: '',
                url: ''
            })
        } finally {
            pendingGeneratedActionTaskIdRef.current = null
            setPendingGeneratedActionTaskId((current) => current === taskId ? null : current)
        }
    }, [updateTask, addToast, t])

    const handleRejectGeneratedTask = useCallback(async (taskId: string) => {
        if (pendingGeneratedActionTaskIdRef.current) return
        pendingGeneratedActionTaskIdRef.current = taskId
        setPendingGeneratedActionTaskId(taskId)
        try {
            await deleteTask({ taskId, projectId: props.projectId })
        } catch (rejectError) {
            addToast({
                title: t('projects.tasks.rejectFailed'),
                body: rejectError instanceof Error ? rejectError.message : 'Failed to reject task',
                sessionId: '',
                url: ''
            })
        } finally {
            pendingGeneratedActionTaskIdRef.current = null
            setPendingGeneratedActionTaskId((current) => current === taskId ? null : current)
        }
    }, [deleteTask, props.projectId, addToast, t])

    const handleTaskActivate = useCallback((task: Task) => {
        if (isOptimisticTaskId(task.id)) {
            return
        }
        const to = task.activeSessionId
            ? '/projects/$projectId/tasks/$taskId/chat'
            : '/projects/$projectId/tasks/$taskId'
        void navigate({
            to,
            params: { projectId: props.projectId, taskId: task.id }
        })
    }, [navigate, props.projectId])

    if (!props.goalId) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                {t('projects.goals.empty')}
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-red-600">
                {error}
            </div>
        )
    }

    return (
        <div className="relative h-full min-h-0 flex flex-col">
            <div className="px-3 pt-3 text-xs text-[var(--app-hint)]">
                {t('projects.board.projectedHint')}
            </div>

            <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
                <div className="h-full w-max mx-auto flex gap-3 p-3">
                    {KANBAN_COLUMNS.map((column) => {
                        const columnTasks = columns[column.status] ?? []
                        const isCollapsed = collapsedColumns[column.status]
                        const theme = getKanbanStatusTheme(column.status)
                        const columnStyle = {
                            '--kanban-accent-1': theme.accent1,
                            '--kanban-accent-2': theme.accent2,
                            '--kanban-column-bg': 'var(--app-secondary-bg)',
                            background: 'var(--kanban-column-bg)'
                        } as CSSProperties
                        const columnClass = `kanban-column flex flex-col h-full shrink-0 rounded-2xl overflow-hidden transition-[width] duration-200 ${isCollapsed ? 'w-[72px]' : 'w-full'}`
                        const columnWidth = isCollapsed ? undefined : { minWidth: '280px', maxWidth: '360px', width: 'clamp(280px, calc((100vw - 96px) / 5), 360px)' }
                        const headerClass = isCollapsed
                            ? 'px-2 py-2 flex flex-col items-center gap-2 backdrop-blur-sm'
                            : 'px-3 py-2 flex items-center justify-between gap-2 backdrop-blur-sm'
                        const columnToggleLabel = isCollapsed ? t('projects.columns.expand') : t('projects.columns.collapse')

                        return (
                            <div
                                key={column.status}
                                className={columnClass}
                                style={{ ...columnStyle, ...columnWidth }}
                                data-kanban-column-status={column.status}
                            >
                                <div className={headerClass}>
                                    <div className={isCollapsed ? 'flex flex-col items-center gap-1 min-w-0' : 'flex items-center gap-2 min-w-0'}>
                                        <div
                                            className="h-2 w-2 rounded-full shrink-0 opacity-90"
                                            style={{
                                                background: 'linear-gradient(135deg, var(--kanban-accent-1), var(--kanban-accent-2))'
                                            }}
                                        />
                                        <div className={isCollapsed ? 'text-[11px] font-semibold text-center leading-tight break-words' : 'text-xs font-semibold truncate'}>
                                            {t(column.titleKey)}
                                        </div>
                                    </div>
                                    <div className={isCollapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1.5'}>
                                        <div className="shrink-0 rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--kanban-accent-1)]">
                                            {columnTasks.length}
                                        </div>
                                        <IconButton
                                            type="button"
                                            variant="ghost"
                                            size="xs"
                                            className="shrink-0 rounded-md"
                                            onClick={(event) => {
                                                event.preventDefault()
                                                event.stopPropagation()
                                                toggleColumnCollapsed(column.status)
                                            }}
                                            aria-label={columnToggleLabel}
                                            title={columnToggleLabel}
                                        >
                                            {isCollapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                                        </IconButton>
                                    </div>
                                </div>

                                {isCollapsed ? null : (
                                    <ScrollShadow
                                        className="flex-1 min-h-0"
                                        viewportClassName="h-full overflow-y-auto px-2 py-2 flex flex-col gap-2"
                                        style={{ '--scroll-shadow-bg': 'var(--kanban-column-bg)' } as CSSProperties}
                                    >
                                        {columnTasks.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-[var(--app-divider)] px-3 py-4 text-xs text-[var(--app-hint)]">
                                                {t('projects.board.emptyLane')}
                                            </div>
                                        ) : null}
                                        {columnTasks.map((task) => (
                                            <KanbanTaskCard
                                                key={task.id}
                                                task={task}
                                                isSelectedTask={selectedTaskId === task.id}
                                                isGeneratedActionPending={pendingGeneratedActionTaskId === task.id}
                                                defaultTaskAgent={defaultTaskAgent}
                                                onActivateTask={handleTaskActivate}
                                                onApproveGeneratedTask={handleApproveGeneratedTask}
                                                onRejectGeneratedTask={handleRejectGeneratedTask}
                                            />
                                        ))}
                                    </ScrollShadow>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            <IconButton
                type="button"
                variant="accent"
                size="md"
                onClick={props.onOpenNewTask}
                className="absolute z-40 right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] h-12 w-12 bg-[var(--app-button)] text-[var(--app-button-text)] shadow-lg text-2xl leading-none cursor-pointer transition-[transform,box-shadow] duration-150 hover:bg-[var(--app-button)] hover:shadow-xl hover:-translate-y-[1px] active:opacity-90 active:translate-y-0 active:shadow-lg"
                aria-label={t('projects.tasks.create')}
            >
                <PlusIcon className="h-6 w-6" />
            </IconButton>
        </div>
    )
})
