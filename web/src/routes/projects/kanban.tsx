import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import type { PermissionMode, Task, TaskPriority, TaskStatus, TasksResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppContext } from '@/lib/app-context'
import { useCreateTask } from '@/hooks/mutations/useCreateTask'
import { useDeleteTask } from '@/hooks/mutations/useDeleteTask'
import { useUpdateTask } from '@/hooks/mutations/useUpdateTask'
import { useProject } from '@/hooks/queries/useProject'
import { useTasks } from '@/hooks/queries/useTasks'
import { KANBAN_COLUMNS } from '@/lib/task-status'
import { TaskCardMenuIcon } from '@/assets/icons'
import { getAgentFlavorLabel } from '@/lib/agentFlavorUtils'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import type { AgentType } from '@/components/NewSession/types'

const TASK_STATUS_VALUES: TaskStatus[] = KANBAN_COLUMNS.map((col) => col.status)

function asTaskStatus(value: string | undefined): TaskStatus | null {
    if (!value) return null
    if (TASK_STATUS_VALUES.includes(value as TaskStatus)) {
        return value as TaskStatus
    }
    return null
}

function getTaskPriorityLabelKey(priority: TaskPriority): string {
    return `projects.task.priority.${priority}`
}

function getTaskPriorityClass(priority: TaskPriority): string {
    switch (priority) {
        case 'high':
            return 'border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
        case 'medium':
            return 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
        case 'low':
            return 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
        default: {
            const _exhaustive: never = priority
            return _exhaustive
        }
    }
}

type KanbanStatusTheme = {
    accent1: string
    accent2: string
    wash1: string
    wash2: string
}

function getKanbanStatusTheme(status: TaskStatus): KanbanStatusTheme {
    switch (status) {
        case 'new':
            return {
                accent1: 'var(--app-kanban-new)',
                accent2: 'var(--app-kanban-new-2)',
                wash1: 'var(--app-kanban-new-bg)',
                wash2: 'var(--app-kanban-new-bg-2)'
            }
        case 'planned':
            return {
                accent1: 'var(--app-kanban-planned)',
                accent2: 'var(--app-kanban-planned-2)',
                wash1: 'var(--app-kanban-planned-bg)',
                wash2: 'var(--app-kanban-planned-bg-2)'
            }
        case 'in_progress':
            return {
                accent1: 'var(--app-kanban-in-progress)',
                accent2: 'var(--app-kanban-in-progress-2)',
                wash1: 'var(--app-kanban-in-progress-bg)',
                wash2: 'var(--app-kanban-in-progress-bg-2)'
            }
        case 'in_review':
            return {
                accent1: 'var(--app-kanban-in-review)',
                accent2: 'var(--app-kanban-in-review-2)',
                wash1: 'var(--app-kanban-in-review-bg)',
                wash2: 'var(--app-kanban-in-review-bg-2)'
            }
        case 'blocked':
            return {
                accent1: 'var(--app-kanban-blocked)',
                accent2: 'var(--app-kanban-blocked-2)',
                wash1: 'var(--app-kanban-blocked-bg)',
                wash2: 'var(--app-kanban-blocked-bg-2)'
            }
        case 'finished':
            return {
                accent1: 'var(--app-kanban-finished)',
                accent2: 'var(--app-kanban-finished-2)',
                wash1: 'var(--app-kanban-finished-bg)',
                wash2: 'var(--app-kanban-finished-bg-2)'
            }
        default: {
            const _exhaustive: never = status
            return _exhaustive
        }
    }
}

function getTaskOrderValue(task: Task): number {
    if (typeof task.sortKey === 'number' && Number.isFinite(task.sortKey)) {
        return task.sortKey
    }
    return task.updatedAt
}

function getTaskSubTaskProgress(task: Task): { completed: number; total: number } | null {
    const subTasks = Array.isArray(task.subTasks) ? task.subTasks : []
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

function sortTasksInColumn(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const av = getTaskOrderValue(a)
        const bv = getTaskOrderValue(b)
        if (av !== bv) {
            return bv - av
        }
        return b.updatedAt - a.updatedAt
    })
}

function computeInsertedSortKey(above: Task | null, below: Task | null): number {
    const aboveValue = above ? getTaskOrderValue(above) : null
    const belowValue = below ? getTaskOrderValue(below) : null

    if (aboveValue !== null && belowValue !== null) {
        return (aboveValue + belowValue) / 2
    }
    if (aboveValue !== null) {
        return aboveValue - 1
    }
    if (belowValue !== null) {
        return belowValue + 1
    }
    return Date.now()
}

function parseTaskDraft(value: string): { title: string; description?: string } {
    const normalized = value.replace(/\r\n/g, '\n')
    const [rawTitle = '', ...descriptionLines] = normalized.split('\n')
    const title = rawTitle.trim()
    const description = descriptionLines.join('\n').trim()
    return {
        title,
        description: description ? description : undefined
    }
}

function resolvePermissionModeForAgent(agent: AgentType, preferredMode: PermissionMode | null | undefined): PermissionMode {
    const options = getPermissionModeOptionsForFlavor(agent)
    if (preferredMode && options.some((option) => option.mode === preferredMode)) {
        return preferredMode
    }
    return options[0]?.mode ?? 'default'
}

type AnchorPoint = { x: number; y: number }

function TaskMoveMenu(props: {
    isOpen: boolean
    anchorPoint: AnchorPoint
    currentStatus: TaskStatus
    onClose: () => void
    onMove: (status: TaskStatus) => void
}) {
    const { t } = useTranslation()
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [position, setPosition] = useState<{ top: number; left: number; origin: string } | null>(null)

    useEffect(() => {
        if (!props.isOpen) {
            setPosition(null)
            return
        }

        const frame = requestAnimationFrame(() => {
            const el = menuRef.current
            if (!el) return
            const rect = el.getBoundingClientRect()
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight
            const padding = 8
            const gap = 8

            const spaceBelow = viewportHeight - props.anchorPoint.y
            const spaceAbove = props.anchorPoint.y
            const openAbove = spaceBelow < rect.height + gap && spaceAbove > spaceBelow

            let top = openAbove ? props.anchorPoint.y - rect.height - gap : props.anchorPoint.y + gap
            let left = props.anchorPoint.x - rect.width / 2
            const origin = openAbove ? 'bottom center' : 'top center'

            top = Math.min(Math.max(top, padding), viewportHeight - rect.height - padding)
            left = Math.min(Math.max(left, padding), viewportWidth - rect.width - padding)
            setPosition({ top, left, origin })
        })

        return () => cancelAnimationFrame(frame)
    }, [props.isOpen, props.anchorPoint])

    useEffect(() => {
        if (!props.isOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            props.onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                props.onClose()
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [props.isOpen, props.onClose])

    if (!props.isOpen) return null

    const style = position ? { top: position.top, left: position.left, transformOrigin: position.origin } : undefined
    const itemClassName = 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[220px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={style}
        >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                {t('projects.tasks.moveTo')}
            </div>
            <div className="flex flex-col gap-1">
                {KANBAN_COLUMNS.map((col) => {
                    const theme = getKanbanStatusTheme(col.status)
                    const isCurrent = col.status === props.currentStatus

                    return (
                        <button
                            key={col.status}
                            type="button"
                            className={itemClassName}
                            onClick={() => {
                                props.onMove(col.status)
                                props.onClose()
                            }}
                            disabled={isCurrent}
                        >
                            <span className="flex items-center gap-2 min-w-0">
                                <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{
                                        background: `linear-gradient(135deg, ${theme.accent1}, ${theme.accent2})`,
                                    }}
                                />
                                <span className="truncate">{t(col.titleKey)}</span>
                            </span>
                            {isCurrent ? (
                                <span className="text-[10px] text-[var(--app-hint)]">{t('projects.tasks.current')}</span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

type DragState = {
    taskId: string
    fromStatus: TaskStatus
}

type DropTarget = {
    status: TaskStatus
    index: number
}

export function ProjectKanbanBoard(props: { projectId: string }) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const { project } = useProject(api, props.projectId)
    const { tasks, isLoading, error } = useTasks(api, props.projectId)
    const { createTask, isPending: isCreatingTask } = useCreateTask(api)
    const { deleteTask } = useDeleteTask(api)
    const { updateTask } = useUpdateTask(api)

    const defaultTaskAgent: AgentType = (project?.defaultAgentFlavor as AgentType | null) ?? 'claude'
    const projectDefaultPermissionMode = (project?.defaultPermissionMode as PermissionMode | null) ?? null

    const [createOpen, setCreateOpen] = useState(false)
    const [newTaskDraft, setNewTaskDraft] = useState('')
    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority | ''>('')
    const [newTaskAgent, setNewTaskAgent] = useState<AgentType>(defaultTaskAgent)
    const [newTaskPermissionMode, setNewTaskPermissionMode] = useState<PermissionMode>(() => (
        resolvePermissionModeForAgent(defaultTaskAgent, projectDefaultPermissionMode)
    ))
    const [pendingGeneratedActionTaskId, setPendingGeneratedActionTaskId] = useState<string | null>(null)
    const parsedNewTaskDraft = useMemo(() => parseTaskDraft(newTaskDraft), [newTaskDraft])
    const newTaskPermissionOptions = useMemo(() => getPermissionModeOptionsForFlavor(newTaskAgent), [newTaskAgent])

    useEffect(() => {
        if (newTaskPermissionOptions.some((option) => option.mode === newTaskPermissionMode)) {
            return
        }
        setNewTaskPermissionMode(resolvePermissionModeForAgent(newTaskAgent, projectDefaultPermissionMode))
    }, [newTaskPermissionOptions, newTaskPermissionMode, newTaskAgent, projectDefaultPermissionMode])

    const [dragState, setDragState] = useState<DragState | null>(null)
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
    const boardScrollRef = useRef<HTMLDivElement | null>(null)
    const dragStateRef = useRef<DragState | null>(null)
    const dropTargetRef = useRef<DropTarget | null>(null)
    const suppressClickRef = useRef(false)
    const touchDragRef = useRef<{
        taskId: string
        touchId: number
        startX: number
        startY: number
        longPressTimer: ReturnType<typeof setTimeout> | null
        dragStarted: boolean
    } | null>(null)
    const touchCleanupRef = useRef<(() => void) | null>(null)

    const [menuState, setMenuState] = useState<{
        taskId: string
        anchorPoint: AnchorPoint
    } | null>(null)

    const setDragStateSynced = useCallback((next: DragState | null) => {
        dragStateRef.current = next
        setDragState(next)
    }, [])

    const setDropTargetSynced = useCallback((next: DropTarget | null) => {
        dropTargetRef.current = next
        setDropTarget(next)
    }, [])

    const tasksById = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of tasks) {
            map.set(task.id, task)
        }
        return map
    }, [tasks])

    const columns = useMemo(() => {
        const grouped: Record<TaskStatus, Task[]> = {
            new: [],
            planned: [],
            in_progress: [],
            in_review: [],
            blocked: [],
            finished: []
        }
        for (const task of tasks) {
            grouped[task.status].push(task)
        }
        return {
            new: sortTasksInColumn(grouped.new),
            planned: sortTasksInColumn(grouped.planned),
            in_progress: sortTasksInColumn(grouped.in_progress),
            in_review: sortTasksInColumn(grouped.in_review),
            blocked: sortTasksInColumn(grouped.blocked),
            finished: sortTasksInColumn(grouped.finished),
        }
    }, [tasks])

    const columnsRef = useRef(columns)
    useEffect(() => {
        columnsRef.current = columns
    }, [columns])

    const applyOptimisticTasks = useCallback((nextTasks: Task[]) => {
        queryClient.setQueryData<TasksResponse>(queryKeys.tasks(props.projectId), (prev) => {
            if (!prev) {
                return { tasks: nextTasks }
            }
            return { ...prev, tasks: nextTasks }
        })
    }, [props.projectId, queryClient])

    const moveTask = useCallback(async (taskId: string, toStatus: TaskStatus, toIndex: number) => {
        const task = tasksById.get(taskId)
        if (!task) return

        const fromStatus = task.status
        const fromList = columns[fromStatus]
        const toList = columns[toStatus]
        const fromIndex = fromList.findIndex((t) => t.id === taskId)

        let insertIndex = toIndex
        if (fromStatus === toStatus && fromIndex >= 0 && fromIndex < insertIndex) {
            insertIndex = Math.max(0, insertIndex - 1)
        }

        const nextToList = toList.filter((t) => t.id !== taskId)
        const clampedIndex = Math.min(Math.max(insertIndex, 0), nextToList.length)
        nextToList.splice(clampedIndex, 0, { ...task, status: toStatus })

        const above = clampedIndex > 0 ? nextToList[clampedIndex - 1] : null
        const below = clampedIndex < nextToList.length - 1 ? nextToList[clampedIndex + 1] : null
        const nextSortKey = computeInsertedSortKey(above, below)

        const previous = queryClient.getQueryData<TasksResponse>(queryKeys.tasks(props.projectId))
        const nextAll = tasks.map((t) => {
            if (t.id !== taskId) return t
            return {
                ...t,
                status: toStatus,
                sortKey: nextSortKey
            }
        })

        applyOptimisticTasks(nextAll)

        try {
            await updateTask({
                taskId,
                patch: {
                    status: toStatus,
                    sortKey: nextSortKey
                }
            })
        } catch (error) {
            if (previous) {
                queryClient.setQueryData(queryKeys.tasks(props.projectId), previous)
            }
            addToast({
                title: t('projects.tasks.moveFailed'),
                body: error instanceof Error ? error.message : 'Failed to move task',
                sessionId: '',
                url: ''
            })
        }
    }, [tasksById, columns, updateTask, addToast, t, queryClient, applyOptimisticTasks, tasks, props.projectId])

    const moveTaskRef = useRef(moveTask)
    useEffect(() => {
        moveTaskRef.current = moveTask
    }, [moveTask])

    const handleApproveGeneratedTask = useCallback(async (taskId: string) => {
        if (pendingGeneratedActionTaskId) return
        setPendingGeneratedActionTaskId(taskId)
        try {
            await moveTask(taskId, 'planned', 0)
        } finally {
            setPendingGeneratedActionTaskId((current) => current === taskId ? null : current)
        }
    }, [moveTask, pendingGeneratedActionTaskId])

    const handleRejectGeneratedTask = useCallback(async (taskId: string) => {
        if (pendingGeneratedActionTaskId) return
        setPendingGeneratedActionTaskId(taskId)
        try {
            await deleteTask({ taskId, projectId: props.projectId })
        } catch (error) {
            addToast({
                title: t('projects.tasks.rejectFailed'),
                body: error instanceof Error ? error.message : 'Failed to reject task',
                sessionId: '',
                url: ''
            })
        } finally {
            setPendingGeneratedActionTaskId((current) => current === taskId ? null : current)
        }
    }, [pendingGeneratedActionTaskId, deleteTask, props.projectId, addToast, t])

    const handleCreateTask = useCallback(async (
        title: string,
        description?: string,
        priority?: TaskPriority | null,
        agentFlavor?: AgentType,
        permissionMode?: PermissionMode
    ) => {
        const trimmed = title.trim()
        if (!trimmed) return

        const sortKey = (() => {
            const top = columns.new[0]
            if (!top) return Date.now()
            return getTaskOrderValue(top) + 1
        })()

        try {
            const created = await createTask({
                projectId: props.projectId,
                title: trimmed,
                description: description?.trim() ? description.trim() : undefined,
                priority: priority ?? undefined,
                status: 'new',
                agentFlavor: agentFlavor ?? defaultTaskAgent,
                permissionMode,
                sortKey
            })
            addToast({ title: t('projects.tasks.created'), body: created.title, sessionId: '', url: '' })
            return created
        } catch (error) {
            addToast({
                title: t('projects.tasks.createFailed'),
                body: error instanceof Error ? error.message : 'Failed to create task',
                sessionId: '',
                url: ''
            })
            return null
        }
    }, [createTask, props.projectId, addToast, t, columns.new, defaultTaskAgent])

    const computeDropTargetFromPoint = useCallback((clientX: number, clientY: number): DropTarget | null => {
        const hit = document.elementFromPoint(clientX, clientY)
        if (!hit || !(hit instanceof HTMLElement)) return null

        const cardEl = hit.closest('[data-kanban-task-id]') as HTMLElement | null
        const columnEl = hit.closest('[data-kanban-column-status]') as HTMLElement | null
        const status = asTaskStatus(columnEl?.dataset.kanbanColumnStatus)
        if (!status) return null

        if (cardEl) {
            const indexValue = cardEl.dataset.kanbanTaskIndex
            const index = indexValue ? Number.parseInt(indexValue, 10) : Number.NaN
            if (!Number.isFinite(index)) {
                return { status, index: columnsRef.current[status].length }
            }
            const rect = cardEl.getBoundingClientRect()
            const before = clientY < rect.top + rect.height / 2
            return { status, index: before ? index : index + 1 }
        }

        return { status, index: columnsRef.current[status].length }
    }, [])

    const handleBoardAutoScroll = useCallback((clientX: number) => {
        const el = boardScrollRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const edge = 80
        const speed = 24
        if (clientX < rect.left + edge) {
            el.scrollLeft -= speed
        } else if (clientX > rect.right - edge) {
            el.scrollLeft += speed
        }
    }, [])

    const clearTouchDrag = useCallback(() => {
        const state = touchDragRef.current
        if (state?.longPressTimer) {
            clearTimeout(state.longPressTimer)
        }
        touchDragRef.current = null
    }, [])

    const clearTouchListeners = useCallback(() => {
        touchCleanupRef.current?.()
        touchCleanupRef.current = null
    }, [])

    const beginTouchDrag = useCallback((taskId: string, fromStatus: TaskStatus, touchId: number, initialTarget: DropTarget) => {
        setDragStateSynced({ taskId, fromStatus })
        setDropTargetSynced(initialTarget)

        const handleTouchMove = (event: TouchEvent) => {
            const touch = Array.from(event.touches).find((t) => t.identifier === touchId)
            if (!touch) return

            event.preventDefault()
            handleBoardAutoScroll(touch.clientX)

            const target = computeDropTargetFromPoint(touch.clientX, touch.clientY)
            setDropTargetSynced(target)
        }

        const finish = (options: { shouldMove: boolean }) => {
            clearTouchListeners()
            clearTouchDrag()

            if (options.shouldMove) {
                const drag = dragStateRef.current
                const target = dropTargetRef.current
                if (drag && target) {
                    const isSameSpot = target.status === initialTarget.status && target.index === initialTarget.index
                    if (!isSameSpot) {
                        void moveTaskRef.current(drag.taskId, target.status, target.index)
                    }
                }
            }

            setDragStateSynced(null)
            setDropTargetSynced(null)
            suppressClickRef.current = true
        }

        const handleTouchEnd = (event: TouchEvent) => {
            const ended = Array.from(event.changedTouches).some((t) => t.identifier === touchId)
            if (!ended) return

            event.preventDefault()
            finish({ shouldMove: true })
        }

        const handleTouchCancel = (event: TouchEvent) => {
            const canceled = Array.from(event.changedTouches).some((t) => t.identifier === touchId)
            if (!canceled) return

            finish({ shouldMove: false })
        }

        document.addEventListener('touchmove', handleTouchMove, { passive: false })
        document.addEventListener('touchend', handleTouchEnd, { passive: false })
        document.addEventListener('touchcancel', handleTouchCancel, { passive: false })

        touchCleanupRef.current = () => {
            document.removeEventListener('touchmove', handleTouchMove)
            document.removeEventListener('touchend', handleTouchEnd)
            document.removeEventListener('touchcancel', handleTouchCancel)
        }
    }, [
        clearTouchDrag,
        clearTouchListeners,
        computeDropTargetFromPoint,
        handleBoardAutoScroll,
        setDragStateSynced,
        setDropTargetSynced
    ])

    const openCreateModal = () => {
        setNewTaskDraft('')
        setNewTaskPriority('')
        setNewTaskAgent(defaultTaskAgent)
        setNewTaskPermissionMode(resolvePermissionModeForAgent(defaultTaskAgent, projectDefaultPermissionMode))
        setCreateOpen(true)
    }

    const handleCreateModal = async () => {
        if (isCreatingTask || !parsedNewTaskDraft.title) return
        const created = await handleCreateTask(
            parsedNewTaskDraft.title,
            parsedNewTaskDraft.description,
            newTaskPriority || null,
            newTaskAgent,
            newTaskPermissionMode
        )
        if (created) {
            setCreateOpen(false)
        }
    }

    const handleBoardDragOver = useCallback((event: React.DragEvent) => {
        if (!dragState) return
        const el = boardScrollRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const edge = 80
        const speed = 24
        if (event.clientX < rect.left + edge) {
            el.scrollLeft -= speed
        } else if (event.clientX > rect.right - edge) {
            el.scrollLeft += speed
        }
    }, [dragState])

    useEffect(() => {
        return () => {
            clearTouchListeners()
            clearTouchDrag()
        }
    }, [clearTouchDrag, clearTouchListeners])

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
            <div
                ref={boardScrollRef}
                className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
                onDragOver={handleBoardDragOver}
            >
                <div className="h-full flex gap-3 p-3">
                    {KANBAN_COLUMNS.map((col) => {
                        const colTasks = columns[col.status]
                        const theme = getKanbanStatusTheme(col.status)
                        const columnStyle = {
                            '--kanban-accent-1': theme.accent1,
                            '--kanban-accent-2': theme.accent2,
                            '--kanban-wash-1': theme.wash1,
                            '--kanban-wash-2': theme.wash2,
                            background: [
                                'radial-gradient(120% 70% at 50% 0%, var(--kanban-wash-1) 0%, transparent 70%)',
                                'radial-gradient(120% 70% at 0% 0%, var(--kanban-wash-2) 0%, transparent 72%)',
                                'var(--app-secondary-bg)'
                            ].join(', ')
                        } as React.CSSProperties
                        const columnClass = 'flex flex-col h-full w-[280px] shrink-0 rounded-2xl overflow-hidden shadow-sm ring-1 ring-inset ring-[var(--app-divider)]'

                        return (
                            <div
                                key={col.status}
                                className={columnClass}
                                style={columnStyle}
                                data-kanban-column-status={col.status}
                                onDragOver={(event) => {
                                    event.preventDefault()
                                    if (!dragState) return
                                    if (event.target !== event.currentTarget) return
                                    setDropTargetSynced({ status: col.status, index: colTasks.length })
                                }}
                                onDrop={() => {
                                    const drag = dragStateRef.current
                                    if (!drag) return

                                    const targetFromHover = dropTargetRef.current
                                    const target = targetFromHover?.status === col.status
                                        ? targetFromHover
                                        : { status: col.status, index: colTasks.length }

                                    void moveTask(drag.taskId, target.status, target.index)
                                    setDragStateSynced(null)
                                    setDropTargetSynced(null)
                                }}
                            >
                                <div
                                    className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between gap-2 backdrop-blur-sm"
                                    style={{
                                        background: [
                                            'radial-gradient(120% 140% at 0% 0%, var(--kanban-wash-1) 0%, transparent 65%)',
                                            'radial-gradient(120% 140% at 100% 0%, var(--kanban-wash-2) 0%, transparent 62%)',
                                            'rgba(0,0,0,0)'
                                        ].join(', ')
                                    }}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div
                                            className="h-2 w-2 rounded-full shrink-0 opacity-90"
                                            style={{
                                                background: 'linear-gradient(135deg, var(--kanban-accent-1), var(--kanban-accent-2))'
                                            }}
                                        />
                                        <div className="text-xs font-semibold truncate">
                                            {t(col.titleKey)}
                                        </div>
                                    </div>
                                    <div className="shrink-0 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--kanban-accent-1)]">
                                        {colTasks.length}
                                    </div>
                                </div>

                                <div
                                    className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2"
                                    onDragOver={(event) => {
                                        event.preventDefault()
                                        if (!dragState) return
                                        if (event.target !== event.currentTarget) return
                                        setDropTargetSynced({ status: col.status, index: colTasks.length })
                                    }}
                                >
                                    {colTasks.map((task, index) => {
                                        const isDragging = dragState?.taskId === task.id
                                        const isGeneratedNew = task.source === 'improvements_scan' && task.status === 'new'
                                        const isGeneratedActionPending = pendingGeneratedActionTaskId === task.id
                                        const cardAgentFlavor: AgentType = (task.agentFlavor as AgentType | null) ?? defaultTaskAgent
                                        const usesProjectDefaultAgent = !task.agentFlavor
                                        const useArchiveStyle = task.status === 'finished'
                                        const subTaskProgress = getTaskSubTaskProgress(task)
                                        const cardBackground = useArchiveStyle
                                            ? [
                                                'radial-gradient(150% 120% at 0% 0%, var(--app-kanban-archive-bg) 0%, transparent 64%)',
                                                'radial-gradient(140% 120% at 100% 0%, var(--app-kanban-archive-bg-2) 0%, transparent 62%)',
                                                'var(--app-bg)'
                                            ].join(', ')
                                            : [
                                                'radial-gradient(140% 120% at 0% 0%, var(--kanban-wash-1) 0%, transparent 62%)',
                                                'radial-gradient(130% 110% at 100% 0%, var(--kanban-wash-2) 0%, transparent 58%)',
                                                'var(--app-bg)'
                                            ].join(', ')

                                        return (
                                            <div key={task.id} className="relative">
                                                <div
                                                    draggable
                                                    data-kanban-task-id={task.id}
                                                    data-kanban-task-index={index}
                                                    data-kanban-column-status={col.status}
                                                    onDragStart={(event) => {
                                                        event.dataTransfer.setData('text/plain', task.id)
                                                        setDragStateSynced({ taskId: task.id, fromStatus: task.status })
                                                        setDropTargetSynced({ status: task.status, index })
                                                    }}
                                                    onDragEnd={() => {
                                                        setDragStateSynced(null)
                                                        setDropTargetSynced(null)
                                                    }}
                                                    onDragOver={(event) => {
                                                        event.preventDefault()
                                                        event.stopPropagation()
                                                        if (!dragState) return
                                                        const rect = event.currentTarget.getBoundingClientRect()
                                                        const before = event.clientY < rect.top + rect.height / 2
                                                        setDropTargetSynced({
                                                            status: col.status,
                                                            index: before ? index : index + 1
                                                        })
                                                    }}
                                                    onDoubleClick={() => {
                                                        if (suppressClickRef.current) {
                                                            suppressClickRef.current = false
                                                            return
                                                        }
                                                        const to = task.activeSessionId
                                                            ? '/projects/$projectId/tasks/$taskId/chat'
                                                            : '/projects/$projectId/tasks/$taskId'
                                                        void navigate({
                                                            to,
                                                            params: { projectId: props.projectId, taskId: task.id }
                                                        })
                                                    }}
                                                    onClick={() => {
                                                        if (suppressClickRef.current) {
                                                            suppressClickRef.current = false
                                                            return
                                                        }
                                                        const to = task.activeSessionId
                                                            ? '/projects/$projectId/tasks/$taskId/chat'
                                                            : '/projects/$projectId/tasks/$taskId'
                                                        void navigate({
                                                            to,
                                                            params: { projectId: props.projectId, taskId: task.id }
                                                        })
                                                    }}
                                                    onTouchStart={(event) => {
                                                        if (event.touches.length !== 1) return
                                                        if (dragStateRef.current) return
                                                        if (touchDragRef.current) return

                                                        const target = event.target as HTMLElement
                                                        if (target.closest('button')) return

                                                        const touch = event.touches[0]
                                                        const touchId = touch.identifier

                                                        const timer = setTimeout(() => {
                                                            const state = touchDragRef.current
                                                            if (!state) return
                                                            if (state.touchId !== touchId) return
                                                            state.dragStarted = true
                                                            beginTouchDrag(task.id, task.status, touchId, { status: col.status, index })
                                                        }, 180)

                                                        touchDragRef.current = {
                                                            taskId: task.id,
                                                            touchId,
                                                            startX: touch.clientX,
                                                            startY: touch.clientY,
                                                            longPressTimer: timer,
                                                            dragStarted: false
                                                        }
                                                    }}
                                                    onTouchMove={(event) => {
                                                        const state = touchDragRef.current
                                                        if (!state) return
                                                        if (state.taskId !== task.id) return
                                                        if (state.dragStarted) return

                                                        const touch = Array.from(event.touches).find((t) => t.identifier === state.touchId)
                                                        if (!touch) return

                                                        const dx = touch.clientX - state.startX
                                                        const dy = touch.clientY - state.startY
                                                        const distance = Math.hypot(dx, dy)
                                                        if (distance < 10) return

                                                        clearTouchDrag()
                                                    }}
                                                    onTouchEnd={() => {
                                                        const state = touchDragRef.current
                                                        if (!state) return
                                                        if (state.taskId !== task.id) return
                                                        if (state.dragStarted) return
                                                        clearTouchDrag()
                                                    }}
                                                    onTouchCancel={() => {
                                                        const state = touchDragRef.current
                                                        if (!state) return
                                                        if (state.taskId !== task.id) return
                                                        if (state.dragStarted) return
                                                        clearTouchDrag()
                                                    }}
                                                    onContextMenu={(event) => {
                                                        event.preventDefault()
                                                        setMenuState({ taskId: task.id, anchorPoint: { x: event.clientX, y: event.clientY } })
                                                    }}
                                                    className={`group relative rounded-xl bg-[var(--app-bg)] p-3 text-left shadow-sm ring-1 ring-inset transition-[transform,box-shadow] duration-150 hover:shadow-md hover:-translate-y-[1px] cursor-pointer ${useArchiveStyle
                                                            ? 'ring-[var(--app-kanban-archive-border)] hover:ring-[var(--app-kanban-archive)]'
                                                            : 'ring-[var(--app-divider)] hover:ring-[var(--kanban-wash-1)]'
                                                        } ${isDragging ? 'opacity-60' : ''
                                                        }`}
                                                    style={{
                                                        background: cardBackground
                                                    }}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-sm font-medium break-words leading-snug">
                                                                {task.title}
                                                            </div>
                                                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                                {task.activeSessionId ? (
                                                                    <div className="text-[10px] text-[var(--app-hint)]">
                                                                        {t('projects.tasks.hasSession')}
                                                                    </div>
                                                                ) : null}
                                                                <span className="inline-flex items-center rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--app-fg)]">
                                                                    {getAgentFlavorLabel(cardAgentFlavor)}
                                                                    {usesProjectDefaultAgent ? ` · ${t('projects.task.agent.projectDefault')}` : ''}
                                                                </span>
                                                                {task.priority ? (
                                                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${getTaskPriorityClass(task.priority)}`}>
                                                                        {t(getTaskPriorityLabelKey(task.priority))}
                                                                    </span>
                                                                ) : null}
                                                                {subTaskProgress ? (
                                                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${subTaskProgress.completed === subTaskProgress.total
                                                                        ? 'border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]'
                                                                        : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                                                                        }`}>
                                                                        {t('projects.tasks.subtasksProgress', {
                                                                            completed: subTaskProgress.completed,
                                                                            total: subTaskProgress.total
                                                                        })}
                                                                    </span>
                                                                ) : null}
                                                                {isGeneratedNew ? (
                                                                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]">
                                                                        {t('projects.tasks.generated')}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            {isGeneratedNew ? (
                                                                <div className="mt-2 flex items-center gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        draggable={false}
                                                                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-1 text-[11px] font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                                                        onClick={(event) => {
                                                                            event.preventDefault()
                                                                            event.stopPropagation()
                                                                            void handleApproveGeneratedTask(task.id)
                                                                        }}
                                                                        disabled={isGeneratedActionPending}
                                                                    >
                                                                        {t('projects.tasks.approve')}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        draggable={false}
                                                                        className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-2 py-1 text-[11px] font-medium text-[var(--app-badge-error-text)] hover:opacity-90 disabled:opacity-50"
                                                                        onClick={(event) => {
                                                                            event.preventDefault()
                                                                            event.stopPropagation()
                                                                            void handleRejectGeneratedTask(task.id)
                                                                        }}
                                                                        disabled={isGeneratedActionPending}
                                                                    >
                                                                        {t('projects.tasks.reject')}
                                                                    </button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="shrink-0 rounded-md p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                setMenuState({ taskId: task.id, anchorPoint: { x: event.clientX, y: event.clientY } })
                                                            }}
                                                            aria-label={t('projects.tasks.moveTo')}
                                                        >
                                                            <TaskCardMenuIcon />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            <button
                type="button"
                onClick={openCreateModal}
                className="absolute z-40 right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] h-12 w-12 rounded-full bg-[var(--app-link)] text-[var(--app-bg)] shadow-lg text-2xl leading-none cursor-pointer transition-[transform,box-shadow,opacity] duration-150 hover:opacity-90 hover:shadow-xl hover:-translate-y-[1px] active:opacity-80 active:translate-y-0 active:shadow-lg"
                aria-label={t('projects.tasks.create')}
            >
                +
            </button>

            <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('projects.tasks.create')}</DialogTitle>
                        <DialogDescription>{t('projects.tasks.createHint')}</DialogDescription>
                    </DialogHeader>

                    <form
                        className="mt-4"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void handleCreateModal()
                        }}
                    >
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('projects.tasks.details')}
                                </label>
                                <textarea
                                    value={newTaskDraft}
                                    onChange={(e) => setNewTaskDraft(e.target.value)}
                                    disabled={isCreatingTask}
                                    rows={6}
                                    placeholder={t('projects.tasks.detailsPlaceholder')}
                                    className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('projects.task.priority')}
                                </label>
                                <select
                                    value={newTaskPriority}
                                    onChange={(e) => setNewTaskPriority((e.target.value as TaskPriority) || '')}
                                    disabled={isCreatingTask}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    <option value="">{t('projects.task.priority.none')}</option>
                                    <option value="high">{t('projects.task.priority.high')}</option>
                                    <option value="medium">{t('projects.task.priority.medium')}</option>
                                    <option value="low">{t('projects.task.priority.low')}</option>
                                </select>
                            </div>
                            <AgentSelector
                                agent={newTaskAgent}
                                isDisabled={isCreatingTask}
                                onAgentChange={setNewTaskAgent}
                            />
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('misc.permissionMode')}
                                </label>
                                <select
                                    value={newTaskPermissionMode}
                                    onChange={(e) => setNewTaskPermissionMode(e.target.value as PermissionMode)}
                                    disabled={isCreatingTask}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    {newTaskPermissionOptions.map((option) => (
                                        <option key={option.mode} value={option.mode}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {newTaskPermissionMode === 'plan' ? (
                                    <div className="text-xs text-[var(--app-hint)]">
                                        {t('projects.tasks.planModeHint')}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={isCreatingTask}>
                                {t('button.cancel')}
                            </Button>
                            <Button type="submit" variant="secondary" disabled={isCreatingTask || !parsedNewTaskDraft.title}>
                                {isCreatingTask ? t('projects.tasks.creating') : t('projects.tasks.create')}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <TaskMoveMenu
                isOpen={Boolean(menuState)}
                anchorPoint={menuState?.anchorPoint ?? { x: 0, y: 0 }}
                currentStatus={(menuState && tasksById.get(menuState.taskId)?.status) ?? 'new'}
                onClose={() => setMenuState(null)}
                onMove={(status) => {
                    const taskId = menuState?.taskId
                    if (!taskId) return
                    void moveTask(taskId, status, 0)
                }}
            />
        </div>
    )
}
