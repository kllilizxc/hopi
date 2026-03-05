import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getModelModesForFlavor, isModelModeAllowedForFlavor, MODEL_MODE_LABELS } from '@hapi/protocol'
import { useMatchRoute, useNavigate, useParams } from '@tanstack/react-router'
import { TASK_STATUS_ORDER } from '@hapi/protocol/tasks'
import type { AgentFlavor, ModelMode, PermissionMode, Task, TaskAttachment, TaskPriority, TaskStatus, TodoItem, Workspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { TASK_STATUS_TITLE_KEY_BY_STATUS } from '@/lib/task-status'
import { getAgentFlavorLabel } from '@/lib/agentFlavorUtils'
import { getSessionDisplayTitle } from '@/lib/displayNames'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Pressable } from '@/components/ui/pressable'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useArchiveTask } from '@/hooks/mutations/useArchiveTask'
import { useAttachTaskSession } from '@/hooks/mutations/useAttachTaskSession'
import { useStartTaskSession } from '@/hooks/mutations/useStartTaskSession'
import { useUpdateTask } from '@/hooks/mutations/useUpdateTask'
import { useProject } from '@/hooks/queries/useProject'
import { useSessions } from '@/hooks/queries/useSessions'
import { useTask, useTaskActiveSessionId } from '@/hooks/queries/useTask'
import { useWorkspaces } from '@/hooks/queries/useWorkspaces'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import { YoloToggle } from '@/components/NewSession/YoloToggle'
import type { AgentType } from '@/components/NewSession/types'
import { TaskSessionChat } from '@/routes/projects/task-session-chat'
import { TaskSessionDiffs } from '@/routes/projects/task-session-diffs'
import { TaskSessionFiles } from '@/routes/projects/task-session-files'
import { SessionTerminal } from '@/routes/sessions/terminal'
import { CopyIcon } from '@/assets/icons'
import { getTaskPermissionModeOptionsForFlavor, resolveTaskPermissionModeForFlavor } from '@/lib/taskPermissionMode'

const MAX_TASK_ATTACHMENTS_BYTES = 10 * 1024 * 1024

type TaskWorkbenchTab = 'task' | 'chat' | 'terminal' | 'diffs' | 'files'
const TASK_AGENT_OPTIONS: AgentType[] = ['claude', 'codex', 'gemini', 'opencode']

function getTaskPriorityLabelKey(priority: TaskPriority): string {
    return `projects.task.priority.${priority}`
}

function getTaskPriorityTagVariant(priority: TaskPriority): 'default' | 'warning' | 'error' {
    switch (priority) {
        case 'high':
            return 'error'
        case 'medium':
            return 'warning'
        case 'low':
            return 'default'
        default: {
            const _exhaustive: never = priority
            return _exhaustive
        }
    }
}

function getAttachmentsSizeBytes(attachments: TaskAttachment[]): number {
    return attachments.reduce((total, att) => total + (Number.isFinite(att.size) ? att.size : 0), 0)
}

function normalizeTaskSubTasks(subTasks: Task['subTasks']): TodoItem[] {
    if (!Array.isArray(subTasks)) return []
    return subTasks.filter((item): item is TodoItem => {
        if (!item || typeof item !== 'object') return false
        if (typeof item.id !== 'string') return false
        if (typeof item.content !== 'string') return false
        if (item.status !== 'pending' && item.status !== 'in_progress' && item.status !== 'completed') return false
        if (item.priority !== 'high' && item.priority !== 'medium' && item.priority !== 'low') return false
        return true
    })
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${Math.round(bytes / 1024 / 1024)} MB`
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })
}

function StartSessionDialog(props: {
    isOpen: boolean
    onClose: () => void
    projectId: string
    taskId: string
    machineId: string
    taskAgentFlavor: AgentType | null
    taskPermissionMode: PermissionMode | null
    taskModelMode: ModelMode | null
    projectDefaults: {
        agent: AgentType
        permissionMode: PermissionMode
        modelMode: ModelMode | null
    }
    workspaces: Workspace[]
    defaultWorkspaceId: string | null
    taskWorkspaceId: string | null
    onStarted: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { api } = useAppContext()
    const { startTaskSession, isPending, error } = useStartTaskSession(api)

    const initialWorkspaceId = props.taskWorkspaceId ?? props.defaultWorkspaceId ?? props.workspaces[0]?.id ?? ''
    const initialAgent = props.taskAgentFlavor ?? props.projectDefaults.agent
    const initialModel = (() => {
        const mode = props.taskModelMode ?? props.projectDefaults.modelMode
        if (initialAgent === 'claude' && (mode === 'sonnet' || mode === 'opus')) {
            return mode
        }
        return 'auto'
    })()
    const initialPermissionMode = useMemo(() => {
        return resolveTaskPermissionModeForFlavor(initialAgent, props.taskPermissionMode ?? props.projectDefaults.permissionMode)
    }, [initialAgent, props.taskPermissionMode, props.projectDefaults.permissionMode])

    const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId)
    const [agent, setAgent] = useState<AgentType>(initialAgent)
    const [model, setModel] = useState(initialModel)
    const [yolo, setYolo] = useState(false)
    const [permissionMode, setPermissionMode] = useState<PermissionMode>(initialPermissionMode)

    useEffect(() => {
        if (!props.isOpen) return
        setWorkspaceId(initialWorkspaceId)
        setAgent(initialAgent)
        setModel(initialModel)
        setYolo(false)
        setPermissionMode(initialPermissionMode)
    }, [props.isOpen, initialWorkspaceId, initialAgent, initialModel, initialPermissionMode])

    const permissionOptions = useMemo(() => getTaskPermissionModeOptionsForFlavor(agent), [agent])

    useEffect(() => {
        if (permissionOptions.some((option) => option.mode === permissionMode)) {
            return
        }
        setPermissionMode(resolveTaskPermissionModeForFlavor(agent, props.taskPermissionMode ?? props.projectDefaults.permissionMode))
    }, [permissionOptions, permissionMode, agent, props.taskPermissionMode, props.projectDefaults.permissionMode])

    const canStart = Boolean(workspaceId && agent && !isPending)

    const handleStart = async () => {
        if (!canStart) return
        const resolvedModel = model !== 'auto' ? model : undefined
        const modelMode = agent === 'claude' && (model === 'sonnet' || model === 'opus')
            ? (model as 'sonnet' | 'opus')
            : undefined

        const result = await startTaskSession({
            taskId: props.taskId,
            projectId: props.projectId,
            payload: {
                workspaceId,
                agent: agent as AgentFlavor,
                model: resolvedModel,
                yolo,
                permissionMode,
                modelMode
            }
        })
        addToast({ title: t('projects.sessions.started'), body: '', sessionId: result.sessionId, url: '' })
        props.onStarted(result.sessionId)
        props.onClose()
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('projects.sessions.startTitle')}</DialogTitle>
                    <DialogDescription>{t('projects.sessions.startHint')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <div className="px-3 space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.sessions.workspace')}
                        </label>
                        <AdaptiveSelectField
                            title={t('projects.sessions.workspace')}
                            value={workspaceId}
                            options={props.workspaces.map((ws) => ({
                                value: ws.id,
                                label: (ws.label ?? ws.path) || ws.id,
                            }))}
                            onValueChange={setWorkspaceId}
                            disabled={isPending}
                            align="start"
                        />
                    </div>

                    <AgentSelector agent={agent} isDisabled={isPending} onAgentChange={setAgent} />
                    <ModelSelector agent={agent} model={model} isDisabled={isPending} onModelChange={setModel} />

                    <div className="px-3 space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('misc.permissionMode')}
                        </label>
                        <AdaptiveSelectField
                            title={t('misc.permissionMode')}
                            value={permissionMode}
                            options={permissionOptions.map((opt) => ({
                                value: opt.mode as PermissionMode,
                                label: opt.label,
                            }))}
                            onValueChange={(value) => setPermissionMode(value as PermissionMode)}
                            disabled={isPending}
                            align="start"
                        />
                    </div>

                    <YoloToggle yoloMode={yolo} isDisabled={isPending} onToggle={setYolo} />

                    {error ? (
                        <div className="px-3 text-sm text-red-600">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={handleStart} disabled={!canStart}>
                        {isPending ? t('projects.sessions.starting') : t('projects.sessions.start')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function AttachSessionDialog(props: {
    isOpen: boolean
    onClose: () => void
    projectId: string
    taskId: string
    machineId: string
    onAttached: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { addToast } = useToast()
    const { sessions, isLoading, error } = useSessions(api)
    const { attachTaskSession, isPending } = useAttachTaskSession(api)

    const [unassignedOnly, setUnassignedOnly] = useState(true)

    const filtered = useMemo(() => {
        const machineSessions = sessions.filter((s) => s.metadata?.machineId === props.machineId)
        const visible = unassignedOnly
            ? machineSessions.filter((s) => !s.metadata?.taskId)
            : machineSessions
        return visible
    }, [sessions, props.machineId, unassignedOnly])

    const handleAttach = async (sessionId: string) => {
        const updated = await attachTaskSession({
            taskId: props.taskId,
            projectId: props.projectId,
            sessionId
        })
        addToast({ title: t('projects.sessions.attached'), body: '', sessionId, url: '' })
        props.onAttached(updated.activeSessionId ?? sessionId)
        props.onClose()
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('projects.sessions.attachTitle')}</DialogTitle>
                    <DialogDescription>{t('projects.sessions.attachHint')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 px-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <Checkbox checked={unassignedOnly} onCheckedChange={setUnassignedOnly} disabled={isPending} />
                        {t('projects.sessions.unassignedOnly')}
                    </label>
                </div>

                <div className="mt-3 max-h-[50vh] overflow-y-auto border-t border-[var(--app-divider)]">
                    {isLoading ? (
                        <div className="p-4">
                            <LoadingState label={t('loading')} className="text-sm" />
                        </div>
                    ) : null}

                    {error ? (
                        <div className="p-4 text-sm text-red-600">
                            {error}
                        </div>
                    ) : null}

                    {!isLoading && filtered.length === 0 ? (
                        <div className="p-4 text-sm text-[var(--app-hint)]">
                            {t('projects.sessions.noSessions')}
                        </div>
                    ) : null}

                    <div className="divide-y divide-[var(--app-divider)]">
                        {filtered.map((session) => {
                            const title = getSessionDisplayTitle(session)
                            const linked = Boolean(session.metadata?.taskId)

                            return (
                                <Pressable
                                    key={session.id}
                                    onClick={() => handleAttach(session.id)}
                                    disabled={isPending}
                                    className="w-full px-4 py-3 text-left hover:bg-[var(--app-subtle-bg)] transition-colors disabled:opacity-50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium truncate">{title}</div>
                                            <div className="text-xs text-[var(--app-hint)] truncate">
                                                {session.metadata?.path ?? ''}
                                            </div>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-2">
                                            {linked ? <Tag variant="warning">{t('projects.sessions.linked')}</Tag> : null}
                                            <Tag variant={session.active ? 'success' : 'default'}>
                                                {session.active ? t('misc.online') : t('misc.offline')}
                                            </Tag>
                                        </div>
                                    </div>
                                </Pressable>
                            )
                        })}
                    </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                        {t('button.close')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

const TaskOverviewSection = memo(function TaskOverviewSection(props: {
    title: string
    description: string
    effectiveWorkspaceLabel: string
    effectiveAgentFlavor: AgentType
    canEditModelMode: boolean
    modelMode: ModelMode
    taskPriority: TaskPriority | null
    hasSession: boolean
    isUpdatingTask: boolean
    copied: boolean
    onTitleChange: (value: string) => void
    onDescriptionChange: (value: string) => void
    onTitleBlur: () => void
    onDescriptionBlur: () => void
    onCopyLink: () => void
}) {
    const { t } = useTranslation()

    return (
        <section className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <input
                        type="text"
                        value={props.title}
                        onChange={(e) => props.onTitleChange(e.target.value)}
                        onBlur={props.onTitleBlur}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        disabled={props.isUpdatingTask}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                        <Tag variant="default">{t('projects.task.workspace.label')}: {props.effectiveWorkspaceLabel}</Tag>
                        <Tag variant="default">{t('newSession.agent')}: {getAgentFlavorLabel(props.effectiveAgentFlavor)}</Tag>
                        {props.canEditModelMode && props.modelMode !== 'default' ? (
                            <Tag variant="default">{t('newSession.model')}: {MODEL_MODE_LABELS[props.modelMode]}</Tag>
                        ) : null}
                        {props.taskPriority ? (
                            <Tag variant={getTaskPriorityTagVariant(props.taskPriority)}>
                                {t(getTaskPriorityLabelKey(props.taskPriority))}
                            </Tag>
                        ) : null}
                        {props.hasSession ? <Tag variant="success">{t('projects.task.sessionLinked')}</Tag> : <Tag variant="warning">{t('projects.task.noSession')}</Tag>}
                    </div>
                </div>

                <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={props.onCopyLink}
                    className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]"
                    title={t('projects.task.copyLink')}
                    aria-label={t('projects.task.copyLink')}
                >
                    <CopyIcon className={props.copied ? 'text-[var(--app-link)]' : undefined} />
                </IconButton>
            </div>

            <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    {t('projects.task.description')}
                </label>
                <textarea
                    value={props.description}
                    onChange={(e) => props.onDescriptionChange(e.target.value)}
                    onBlur={props.onDescriptionBlur}
                    rows={8}
                    disabled={props.isUpdatingTask}
                    className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
            </div>
        </section>
    )
})

const TaskSubTasksSection = memo(function TaskSubTasksSection(props: {
    subTasks: TodoItem[]
    newSubTaskContent: string
    newSubTaskPriority: TaskPriority
    isUpdatingTask: boolean
    onToggleSubTask: (id: string, checked: boolean) => void
    onSubTaskContentChange: (id: string, value: string) => void
    onSubTaskContentBlur: (id: string) => void
    onSubTaskPriorityChange: (id: string, value: TaskPriority) => void
    onRemoveSubTask: (id: string) => void
    onNewSubTaskContentChange: (value: string) => void
    onNewSubTaskPriorityChange: (value: TaskPriority) => void
    onAddSubTask: () => void
}) {
    const { t } = useTranslation()
    const priorityOptions = useMemo(() => ([
        { value: 'high', label: t('projects.task.priority.high') },
        { value: 'medium', label: t('projects.task.priority.medium') },
        { value: 'low', label: t('projects.task.priority.low') },
    ]), [t])

    return (
        <section className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div>
                <div className="text-sm font-semibold">{t('projects.task.subtasks.title')}</div>
                <div className="text-xs text-[var(--app-hint)]">{t('projects.task.subtasks.hint')}</div>
            </div>

            {props.subTasks.length === 0 ? (
                <div className="text-sm text-[var(--app-hint)]">
                    {t('projects.task.subtasks.empty')}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {props.subTasks.map((subTask) => (
                        <div key={subTask.id} className="flex flex-col gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 md:flex-row md:items-center">
                            <label className="flex items-center gap-2 md:w-auto cursor-pointer select-none">
                                <Checkbox
                                    checked={subTask.status === 'completed'}
                                    onCheckedChange={(checked) => {
                                        props.onToggleSubTask(subTask.id, checked)
                                    }}
                                    disabled={props.isUpdatingTask}
                                />
                                <span className="text-xs text-[var(--app-hint)]">
                                    {subTask.status === 'completed'
                                        ? t('projects.task.subtasks.status.completed')
                                        : subTask.status === 'in_progress'
                                            ? t('projects.task.subtasks.status.inProgress')
                                            : t('projects.task.subtasks.status.pending')}
                                </span>
                            </label>

                            <input
                                type="text"
                                value={subTask.content}
                                onChange={(e) => props.onSubTaskContentChange(subTask.id, e.target.value)}
                                onBlur={() => {
                                    props.onSubTaskContentBlur(subTask.id)
                                }}
                                disabled={props.isUpdatingTask}
                                className={`w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50 ${subTask.status === 'completed' ? 'text-[var(--app-hint)] line-through' : ''}`}
                            />

                            <div className="flex items-center gap-2 md:w-auto">
                                <AdaptiveSelectField
                                    title={t('projects.task.priority')}
                                    value={subTask.priority}
                                    options={priorityOptions}
                                    onValueChange={(value) => {
                                        props.onSubTaskPriorityChange(subTask.id, value as TaskPriority)
                                    }}
                                    disabled={props.isUpdatingTask}
                                    align="end"
                                    size="sm"
                                    triggerClassName="min-w-[120px]"
                                />

                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                        props.onRemoveSubTask(subTask.id)
                                    }}
                                    disabled={props.isUpdatingTask}
                                >
                                    {t('projects.task.subtasks.remove')}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                <input
                    type="text"
                    value={props.newSubTaskContent}
                    onChange={(e) => props.onNewSubTaskContentChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            props.onAddSubTask()
                        }
                    }}
                    disabled={props.isUpdatingTask}
                    placeholder={t('projects.task.subtasks.placeholder')}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <AdaptiveSelectField
                    title={t('projects.task.priority')}
                    value={props.newSubTaskPriority}
                    options={priorityOptions}
                    onValueChange={(value) => props.onNewSubTaskPriorityChange(value as TaskPriority)}
                    disabled={props.isUpdatingTask}
                    align="end"
                    size="sm"
                    triggerClassName="min-w-[120px]"
                />
                <Button
                    type="button"
                    variant="secondary"
                    onClick={props.onAddSubTask}
                    disabled={props.isUpdatingTask || !props.newSubTaskContent.trim()}
                >
                    {t('projects.task.subtasks.add')}
                </Button>
            </div>
        </section>
    )
})

const TaskAttachmentsSection = memo(function TaskAttachmentsSection(props: {
    attachments: TaskAttachment[]
    totalBytes: number
    overLimit: boolean
    attachmentsBusy: boolean
    isUpdatingTask: boolean
    onAddFiles: (files: FileList | null) => void
    onRemoveAttachment: (id: string) => void
}) {
    const { t } = useTranslation()
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    return (
        <section className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">{t('projects.task.attachments.title')}</div>
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('projects.task.attachments.budget', { used: formatBytes(props.totalBytes), max: formatBytes(MAX_TASK_ATTACHMENTS_BYTES) })}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        disabled={props.isUpdatingTask || props.attachmentsBusy}
                        onChange={(e) => {
                            props.onAddFiles(e.target.files)
                            e.currentTarget.value = ''
                        }}
                        className="hidden"
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={props.isUpdatingTask || props.attachmentsBusy}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {t('projects.task.attachments.add')}
                    </Button>
                </div>
            </div>

            {props.overLimit ? (
                <div className="rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">
                    {t('projects.task.attachments.overLimit')}
                </div>
            ) : null}

            {props.attachments.length === 0 ? (
                <div className="text-sm text-[var(--app-hint)]">
                    {t('projects.task.attachments.empty')}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {props.attachments.map((att) => (
                        <div key={att.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                            <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{att.filename}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {formatBytes(att.size)} · {att.mimeType}
                                </div>
                            </div>
                            <Button type="button" variant="secondary" onClick={() => props.onRemoveAttachment(att.id)} disabled={props.isUpdatingTask || props.attachmentsBusy}>
                                {t('projects.task.attachments.remove')}
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
})

const TaskDetailsSidebar = memo(function TaskDetailsSidebar(props: {
    status: TaskStatus
    statusOptions: Array<{ value: TaskStatus; label: string }>
    priority: TaskPriority | ''
    priorityOptions: Array<{ value: '' | TaskPriority; label: string }>
    workspaceId: string
    workspaceOptions: Array<{ value: string; label: string }>
    agentFlavor: AgentType | ''
    agentOptions: Array<{ value: '' | AgentType; label: string }>
    canEditModelMode: boolean
    modelMode: ModelMode
    modelModeOptions: Array<{ value: ModelMode; label: string }>
    sessionId: string | null
    overLimit: boolean
    isUpdatingTask: boolean
    isArchiving: boolean
    onStatusChange: (value: string) => void
    onPriorityChange: (value: string) => void
    onWorkspaceChange: (value: string) => void
    onAgentFlavorChange: (value: string) => void
    onModelModeChange: (value: string) => void
    onOpenChat: () => void
    onOpenStart: () => void
    onOpenAttach: () => void
    onOpenArchive: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="space-y-4">
            <section className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
                <div className="text-sm font-semibold">{t('projects.tasks.details')}</div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        {t('projects.task.status')}
                    </label>
                    <AdaptiveSelectField
                        title={t('projects.task.status')}
                        value={props.status}
                        options={props.statusOptions}
                        onValueChange={props.onStatusChange}
                        disabled={props.isUpdatingTask}
                        align="start"
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        {t('projects.task.priority')}
                    </label>
                    <AdaptiveSelectField
                        title={t('projects.task.priority')}
                        value={props.priority}
                        options={props.priorityOptions}
                        onValueChange={props.onPriorityChange}
                        disabled={props.isUpdatingTask}
                        align="start"
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        {t('projects.task.workspace')}
                    </label>
                    <AdaptiveSelectField
                        title={t('projects.task.workspace')}
                        value={props.workspaceId}
                        options={props.workspaceOptions}
                        onValueChange={props.onWorkspaceChange}
                        disabled={props.isUpdatingTask}
                        align="start"
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        {t('newSession.agent')}
                    </label>
                    <AdaptiveSelectField
                        title={t('newSession.agent')}
                        value={props.agentFlavor}
                        options={props.agentOptions}
                        onValueChange={props.onAgentFlavorChange}
                        disabled={props.isUpdatingTask}
                        align="start"
                    />
                </div>

                {props.canEditModelMode ? (
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('newSession.model')}
                        </label>
                        <AdaptiveSelectField
                            title={t('newSession.model')}
                            value={props.modelMode}
                            options={props.modelModeOptions}
                            onValueChange={props.onModelModeChange}
                            disabled={props.isUpdatingTask}
                            align="start"
                        />
                    </div>
                ) : null}
            </section>

            <section className="space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
                <div className="text-sm font-semibold">{t('projects.sessions.title')}</div>

                {props.sessionId ? (
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={props.onOpenChat}>
                            {t('projects.sessions.openChat')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={props.onOpenStart}>
                            {t('projects.sessions.startNew')}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={props.onOpenStart} disabled={props.isUpdatingTask || props.overLimit}>
                            {t('projects.sessions.start')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={props.onOpenAttach} disabled={props.isUpdatingTask}>
                            {t('projects.sessions.attach')}
                        </Button>
                    </div>
                )}

                {props.overLimit ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('projects.task.attachments.mustFix')}
                    </div>
                ) : null}
            </section>

            <section className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/20 p-3">
                <div className="text-sm font-semibold">{t('projects.task.archive.title')}</div>
                <div className="text-xs text-[var(--app-hint)]">{t('projects.task.archive.hint')}</div>
                <Button type="button" variant="destructive" onClick={props.onOpenArchive} disabled={props.isUpdatingTask || props.isArchiving}>
                    {t('projects.task.archive.action')}
                </Button>
            </section>
        </div>
    )
})

function TaskDetailsPanel(props: {
    projectId: string
    taskId: string
    task: Task
    workspaces: Workspace[]
    projectDefaultWorkspaceId: string | null
    projectMachineId: string
    projectDefaults: {
        agent: AgentType
        permissionMode: PermissionMode
        modelMode: ModelMode | null
    }
}) {
    const navigate = useNavigate()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { api } = useAppContext()
    const { copy, copied } = useCopyToClipboard()
    const { updateTask, isPending: isUpdatingTask } = useUpdateTask(api)
    const { archiveTask, isPending: isArchiving } = useArchiveTask(api)

    const [title, setTitle] = useState(props.task.title)
    const [description, setDescription] = useState(props.task.description ?? '')
    const [status, setStatus] = useState<TaskStatus>(props.task.status)
    const [priority, setPriority] = useState<TaskPriority | ''>(props.task.priority ?? '')
    const [workspaceId, setWorkspaceId] = useState<string>(props.task.workspaceId ?? '')
    const [agentFlavor, setAgentFlavor] = useState<AgentType | ''>((props.task.agentFlavor as AgentType | null) ?? '')
    const [modelMode, setModelMode] = useState<ModelMode>((props.task.modelMode as ModelMode | null) ?? 'default')
    const [subTasks, setSubTasks] = useState<TodoItem[]>(normalizeTaskSubTasks(props.task.subTasks))
    const [newSubTaskContent, setNewSubTaskContent] = useState('')
    const [newSubTaskPriority, setNewSubTaskPriority] = useState<TaskPriority>('medium')
    const [attachments, setAttachments] = useState<TaskAttachment[]>(Array.isArray(props.task.attachments) ? props.task.attachments : [])
    const [attachmentsBusy, setAttachmentsBusy] = useState(false)
    const [startOpen, setStartOpen] = useState(false)
    const [attachOpen, setAttachOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const sessionId = props.task.activeSessionId ?? null

    useEffect(() => {
        setTitle(props.task.title)
        setDescription(props.task.description ?? '')
        setStatus(props.task.status)
        setPriority(props.task.priority ?? '')
        setWorkspaceId(props.task.workspaceId ?? '')
        setAgentFlavor((props.task.agentFlavor as AgentType | null) ?? '')
        setModelMode((props.task.modelMode as ModelMode | null) ?? 'default')
        setSubTasks(normalizeTaskSubTasks(props.task.subTasks))
        setNewSubTaskContent('')
        setNewSubTaskPriority('medium')
        setAttachments(Array.isArray(props.task.attachments) ? props.task.attachments : [])
    }, [props.task.id, props.task.updatedAt])

    const effectiveAgentFlavor: AgentType = (agentFlavor || props.projectDefaults.agent) as AgentType
    const modelModeOptions = useMemo<Array<{ value: ModelMode; label: string }>>(() => {
        const modes = getModelModesForFlavor(effectiveAgentFlavor)
        return modes.map((mode) => ({
            value: mode as ModelMode,
            label: MODEL_MODE_LABELS[mode as ModelMode] ?? mode,
        }))
    }, [effectiveAgentFlavor])
    const canEditModelMode = modelModeOptions.length > 0

    const statusOptions = useMemo<Array<{ value: TaskStatus; label: string }>>(() => TASK_STATUS_ORDER.map((taskStatus) => ({
        value: taskStatus,
        label: t(TASK_STATUS_TITLE_KEY_BY_STATUS[taskStatus]),
    })), [t])

    const priorityOptions = useMemo<Array<{ value: '' | TaskPriority; label: string }>>(() => ([
        { value: '', label: t('projects.task.priority.none') },
        { value: 'high', label: t('projects.task.priority.high') },
        { value: 'medium', label: t('projects.task.priority.medium') },
        { value: 'low', label: t('projects.task.priority.low') },
    ]), [t])

    const workspaceOptions = useMemo<Array<{ value: string; label: string }>>(() => ([
        { value: '', label: t('projects.task.workspace.projectDefault') },
        ...props.workspaces.map((ws) => ({
            value: ws.id,
            label: (ws.label ?? ws.path) || ws.id,
        })),
    ]), [props.workspaces, t])

    const agentOptions = useMemo<Array<{ value: '' | AgentType; label: string }>>(() => ([
        { value: '', label: t('projects.task.agent.projectDefault') },
        ...TASK_AGENT_OPTIONS.map((agent) => ({
            value: agent,
            label: getAgentFlavorLabel(agent),
        })),
    ]), [t])

    const totalBytes = useMemo(() => getAttachmentsSizeBytes(attachments), [attachments])
    const overLimit = totalBytes > MAX_TASK_ATTACHMENTS_BYTES

    const effectiveWorkspaceLabel = useMemo(() => {
        const resolvedWorkspaceId = workspaceId || props.projectDefaultWorkspaceId
        if (!resolvedWorkspaceId) {
            return t('projects.task.workspace.none')
        }
        const ws = props.workspaces.find((w) => w.id === resolvedWorkspaceId)
        return ws?.label ?? ws?.path ?? resolvedWorkspaceId
    }, [workspaceId, props.projectDefaultWorkspaceId, props.workspaces, t])

    const savePatch = useCallback(async (patch: Parameters<typeof updateTask>[0]['patch']) => {
        try {
            return await updateTask({ taskId: props.taskId, patch })
        } catch (error) {
            addToast({
                title: t('projects.task.saveFailed'),
                body: error instanceof Error ? error.message : 'Failed to save task',
                sessionId: '',
                url: ''
            })
            return null
        }
    }, [updateTask, props.taskId, addToast, t])

    const handleArchive = useCallback(async () => {
        await archiveTask({ taskId: props.taskId, projectId: props.projectId })
        addToast({ title: t('projects.task.archived'), body: title, sessionId: '', url: '' })
        void navigate({ to: '/projects/$projectId', params: { projectId: props.projectId } })
    }, [archiveTask, props.taskId, props.projectId, addToast, t, title, navigate])

    const handleTitleBlur = useCallback(() => {
        if (title.trim() && title.trim() !== props.task.title) {
            void savePatch({ title: title.trim() })
        }
    }, [props.task.title, savePatch, title])

    const handleDescriptionBlur = useCallback(() => {
        const next = description.trim() ? description.trim() : ''
        const prev = (props.task.description ?? '').trim()
        if (next !== prev) {
            void savePatch({ description: next ? next : null })
        }
    }, [description, props.task.description, savePatch])

    const handleCopyLink = useCallback(() => {
        void copy(window.location.href)
    }, [copy])

    const handleStatusChange = useCallback((value: string) => {
        const next = value as TaskStatus
        setStatus(next)
        void savePatch({ status: next, sortKey: Date.now() })
    }, [savePatch])

    const handlePriorityChange = useCallback((value: string) => {
        const next = (value as TaskPriority) || ''
        setPriority(next)
        void savePatch({ priority: next || null })
    }, [savePatch])

    const handleWorkspaceChange = useCallback((value: string) => {
        const next = value as string
        setWorkspaceId(next)
        void savePatch({ workspaceId: next || null })
    }, [savePatch])

    const handleAgentFlavorChange = useCallback((value: string) => {
        const next = value as AgentType | ''
        const resolvedNextAgent = (next || props.projectDefaults.agent) as AgentType

        setAgentFlavor(next)
        void savePatch({ agentFlavor: next || null })

        if (resolvedNextAgent !== 'claude' && modelMode !== 'default') {
            setModelMode('default')
            void savePatch({ modelMode: null })
            return
        }

        if (resolvedNextAgent === 'claude' && !isModelModeAllowedForFlavor(modelMode, resolvedNextAgent)) {
            setModelMode('default')
            void savePatch({ modelMode: null })
        }
    }, [modelMode, props.projectDefaults.agent, savePatch])

    const handleModelModeChange = useCallback((value: string) => {
        const next = value as ModelMode
        setModelMode(next)
        void savePatch({
            modelMode: effectiveAgentFlavor === 'claude' && next !== 'default' ? next : null
        })
    }, [effectiveAgentFlavor, savePatch])

    const handleAddFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return
        setAttachmentsBusy(true)
        try {
            const next: TaskAttachment[] = [...attachments]
            let usedBytes = getAttachmentsSizeBytes(next)
            for (const file of Array.from(files)) {
                if (usedBytes + file.size > MAX_TASK_ATTACHMENTS_BYTES) {
                    addToast({
                        title: t('projects.task.attachments.limitTitle'),
                        body: t('projects.task.attachments.limitBody'),
                        sessionId: '',
                        url: ''
                    })
                    break
                }
                const dataUrl = await readFileAsDataUrl(file)
                const id = typeof crypto?.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
                next.push({
                    id,
                    filename: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    dataUrl,
                    previewUrl: file.type.startsWith('image/') ? dataUrl : undefined
                })
                usedBytes += file.size
            }
            setAttachments(next)
            await savePatch({ attachments: next })
        } finally {
            setAttachmentsBusy(false)
        }
    }, [attachments, addToast, savePatch, t])

    const handleRemoveAttachment = useCallback(async (id: string) => {
        const next = attachments.filter((a) => a.id !== id)
        setAttachments(next)
        await savePatch({ attachments: next })
    }, [attachments, savePatch])

    const persistSubTasks = useCallback(async (next: TodoItem[]) => {
        setSubTasks(next)
        await savePatch({ subTasks: next })
    }, [savePatch])

    const handleToggleSubTask = useCallback(async (id: string, checked: boolean) => {
        const next = subTasks.map<TodoItem>((subTask) => {
            if (subTask.id !== id) return subTask
            return { ...subTask, status: checked ? 'completed' : 'pending' }
        })
        await persistSubTasks(next)
    }, [subTasks, persistSubTasks])

    const handleSubTaskPriorityChange = useCallback(async (id: string, value: TaskPriority) => {
        const next = subTasks.map<TodoItem>((subTask) => {
            if (subTask.id !== id) return subTask
            return { ...subTask, priority: value }
        })
        await persistSubTasks(next)
    }, [subTasks, persistSubTasks])

    const handleSubTaskContentChange = useCallback((id: string, value: string) => {
        setSubTasks((current) => current.map<TodoItem>((subTask) => {
            if (subTask.id !== id) return subTask
            return { ...subTask, content: value }
        }))
    }, [])

    const handleSubTaskContentBlur = useCallback(async (id: string) => {
        const next: TodoItem[] = []
        for (const subTask of subTasks) {
            if (subTask.id !== id) {
                next.push(subTask)
                continue
            }
            const trimmed = subTask.content.trim()
            if (!trimmed) {
                continue
            }
            next.push({ ...subTask, content: trimmed })
        }
        await persistSubTasks(next)
    }, [subTasks, persistSubTasks])

    const handleRemoveSubTask = useCallback(async (id: string) => {
        const next = subTasks.filter((subTask) => subTask.id !== id)
        await persistSubTasks(next)
    }, [subTasks, persistSubTasks])

    const handleAddSubTask = useCallback(async () => {
        const content = newSubTaskContent.trim()
        if (!content) return
        const id = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        const next: TodoItem[] = [
            ...subTasks,
            {
                id,
                content,
                status: 'pending',
                priority: newSubTaskPriority
            }
        ]
        setNewSubTaskContent('')
        setNewSubTaskPriority('medium')
        await persistSubTasks(next)
    }, [newSubTaskContent, newSubTaskPriority, subTasks, persistSubTasks])

    const handleOpenChat = useCallback(() => {
        void navigate({
            to: '/projects/$projectId/tasks/$taskId/chat',
            params: { projectId: props.projectId, taskId: props.taskId }
        })
    }, [navigate, props.projectId, props.taskId])

    const handleOpenStart = useCallback(() => {
        setStartOpen(true)
    }, [])

    const handleOpenAttach = useCallback(() => {
        setAttachOpen(true)
    }, [])

    const handleOpenArchive = useCallback(() => {
        setArchiveOpen(true)
    }, [])

    const handleToggleSubTaskChange = useCallback((id: string, checked: boolean) => {
        void handleToggleSubTask(id, checked)
    }, [handleToggleSubTask])

    const handleSubTaskPrioritySelect = useCallback((id: string, value: TaskPriority) => {
        void handleSubTaskPriorityChange(id, value)
    }, [handleSubTaskPriorityChange])

    const handleSubTaskContentBlurPersist = useCallback((id: string) => {
        void handleSubTaskContentBlur(id)
    }, [handleSubTaskContentBlur])

    const handleSubTaskRemove = useCallback((id: string) => {
        void handleRemoveSubTask(id)
    }, [handleRemoveSubTask])

    const handleAddSubTaskAction = useCallback(() => {
        void handleAddSubTask()
    }, [handleAddSubTask])

    const handleAddAttachmentFiles = useCallback((files: FileList | null) => {
        void handleAddFiles(files)
    }, [handleAddFiles])

    const handleAttachmentRemove = useCallback((id: string) => {
        void handleRemoveAttachment(id)
    }, [handleRemoveAttachment])

    return (
        <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4">
                    <div className="space-y-4">
                        <div className="space-y-6">
                            <TaskOverviewSection
                                title={title}
                                description={description}
                                effectiveWorkspaceLabel={effectiveWorkspaceLabel}
                                effectiveAgentFlavor={effectiveAgentFlavor}
                                canEditModelMode={canEditModelMode}
                                modelMode={modelMode}
                                taskPriority={props.task.priority ?? null}
                                hasSession={Boolean(sessionId)}
                                isUpdatingTask={isUpdatingTask}
                                copied={copied}
                                onTitleChange={setTitle}
                                onDescriptionChange={setDescription}
                                onTitleBlur={handleTitleBlur}
                                onDescriptionBlur={handleDescriptionBlur}
                                onCopyLink={handleCopyLink}
                            />

                            <TaskSubTasksSection
                                subTasks={subTasks}
                                newSubTaskContent={newSubTaskContent}
                                newSubTaskPriority={newSubTaskPriority}
                                isUpdatingTask={isUpdatingTask}
                                onToggleSubTask={handleToggleSubTaskChange}
                                onSubTaskContentChange={handleSubTaskContentChange}
                                onSubTaskContentBlur={handleSubTaskContentBlurPersist}
                                onSubTaskPriorityChange={handleSubTaskPrioritySelect}
                                onRemoveSubTask={handleSubTaskRemove}
                                onNewSubTaskContentChange={setNewSubTaskContent}
                                onNewSubTaskPriorityChange={setNewSubTaskPriority}
                                onAddSubTask={handleAddSubTaskAction}
                            />

                            <TaskAttachmentsSection
                                attachments={attachments}
                                totalBytes={totalBytes}
                                overLimit={overLimit}
                                attachmentsBusy={attachmentsBusy}
                                isUpdatingTask={isUpdatingTask}
                                onAddFiles={handleAddAttachmentFiles}
                                onRemoveAttachment={handleAttachmentRemove}
                            />
                        </div>

                        <TaskDetailsSidebar
                            status={status}
                            statusOptions={statusOptions}
                            priority={priority}
                            priorityOptions={priorityOptions}
                            workspaceId={workspaceId}
                            workspaceOptions={workspaceOptions}
                            agentFlavor={agentFlavor}
                            agentOptions={agentOptions}
                            canEditModelMode={canEditModelMode}
                            modelMode={modelMode}
                            modelModeOptions={modelModeOptions}
                            sessionId={sessionId}
                            overLimit={overLimit}
                            isUpdatingTask={isUpdatingTask}
                            isArchiving={isArchiving}
                            onStatusChange={handleStatusChange}
                            onPriorityChange={handlePriorityChange}
                            onWorkspaceChange={handleWorkspaceChange}
                            onAgentFlavorChange={handleAgentFlavorChange}
                            onModelModeChange={handleModelModeChange}
                            onOpenChat={handleOpenChat}
                            onOpenStart={handleOpenStart}
                            onOpenAttach={handleOpenAttach}
                            onOpenArchive={handleOpenArchive}
                        />
                    </div>
                </div>
            </div>

            <StartSessionDialog
                isOpen={startOpen}
                onClose={() => setStartOpen(false)}
                projectId={props.projectId}
                taskId={props.taskId}
                machineId={props.projectMachineId}
                taskAgentFlavor={agentFlavor || null}
                taskPermissionMode={props.task.permissionMode ?? null}
                taskModelMode={modelMode === 'default' ? null : modelMode}
                projectDefaults={props.projectDefaults}
                workspaces={props.workspaces}
                defaultWorkspaceId={props.projectDefaultWorkspaceId}
                taskWorkspaceId={workspaceId || null}
                onStarted={handleOpenChat}
            />

            <AttachSessionDialog
                isOpen={attachOpen}
                onClose={() => setAttachOpen(false)}
                projectId={props.projectId}
                taskId={props.taskId}
                machineId={props.projectMachineId}
                onAttached={handleOpenChat}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('projects.task.archive.title')}
                description={t('projects.task.archive.confirm')}
                confirmLabel={t('projects.task.archive.action')}
                confirmingLabel={t('projects.task.archive.archiving')}
                onConfirm={handleArchive}
                isPending={isArchiving}
                destructive
            />
        </div>
    )
}

function WorkbenchHeader(props: {
    title: string
    subtitle?: string
    onBack: () => void
    onCopyLink: () => void
    copied: boolean
    backLabel: string
    copyLabel: string
}) {
    return (
        <PageHeader
            title={props.title}
            subtitle={props.subtitle}
            onBack={props.onBack}
            backLabel={props.backLabel}
            subtitleClassName="text-[10px] text-[var(--app-hint)] truncate"
            right={(
                <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={props.onCopyLink}
                    className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]"
                    aria-label={props.copyLabel}
                    title={props.copyLabel}
                >
                    <CopyIcon className={props.copied ? 'text-[var(--app-link)]' : undefined} />
                </IconButton>
            )}
        />
    )
}

export function TaskWorkbenchRoute() {
    const { projectId, taskId } = useParams({ from: '/projects/$projectId/tasks/$taskId' })
    const matchRoute = useMatchRoute()

    const forceTask = Boolean(matchRoute({ to: '/projects/$projectId/tasks/$taskId/task' }))
    const tab: TaskWorkbenchTab = forceTask
        ? 'task'
        : matchRoute({ to: '/projects/$projectId/tasks/$taskId/files' })
            ? 'files'
            : matchRoute({ to: '/projects/$projectId/tasks/$taskId/diffs' })
                ? 'diffs'
                : matchRoute({ to: '/projects/$projectId/tasks/$taskId/terminal' })
                    ? 'terminal'
                    : matchRoute({ to: '/projects/$projectId/tasks/$taskId/chat' })
                        ? 'chat'
                        : 'task'

    return <TaskWorkbench projectId={projectId} taskId={taskId} tab={tab} forceTask={forceTask} />
}

export const TaskWorkbench = memo(function TaskWorkbench(props: {
    projectId: string
    taskId: string
    tab: TaskWorkbenchTab
    forceTask?: boolean
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { api } = useAppContext()
    const { copy, copied } = useCopyToClipboard()
    const {
        activeSessionId: sessionId,
        isLoading: taskSessionLoading,
        error: taskSessionError
    } = useTaskActiveSessionId(api, props.taskId)
    const hasSession = Boolean(sessionId)
    const activeTab: TaskWorkbenchTab = props.forceTask ? 'task' : (props.tab === 'task' && hasSession ? 'chat' : props.tab)
    const shouldLoadTaskDetails = activeTab === 'task' && !taskSessionLoading
    const { task, isLoading: taskLoading, error: taskError } = useTask(api, shouldLoadTaskDetails ? props.taskId : null)
    const { project, isLoading: projectLoading, error: projectError } = useProject(api, shouldLoadTaskDetails ? props.projectId : null)
    const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspaces(api, shouldLoadTaskDetails ? props.projectId : null)

    const handleBack = useCallback(() => {
        if (props.forceTask) {
            void navigate({
                to: '/projects/$projectId/tasks/$taskId',
                params: { projectId: props.projectId, taskId: props.taskId }
            })
            return
        }
        if (props.tab !== 'task') {
            void navigate({
                to: '/projects/$projectId/tasks/$taskId',
                params: { projectId: props.projectId, taskId: props.taskId }
            })
            return
        }
        void navigate({ to: '/projects/$projectId', params: { projectId: props.projectId } })
    }, [navigate, props.forceTask, props.projectId, props.taskId, props.tab])

    const handleBackToProject = useCallback(() => {
        void navigate({ to: '/projects/$projectId', params: { projectId: props.projectId } })
    }, [navigate, props.projectId])

    const handleOpenFiles = useCallback(() => {
        if (!hasSession) return
        void navigate({
            to: '/projects/$projectId/tasks/$taskId/files',
            params: { projectId: props.projectId, taskId: props.taskId }
        })
    }, [hasSession, navigate, props.projectId, props.taskId])

    const handleOpenDiffs = useCallback(() => {
        if (!hasSession) return
        void navigate({
            to: '/projects/$projectId/tasks/$taskId/diffs',
            params: { projectId: props.projectId, taskId: props.taskId }
        })
    }, [hasSession, navigate, props.projectId, props.taskId])

    const handleOpenTerminal = useCallback(() => {
        if (!hasSession) return
        void navigate({
            to: '/projects/$projectId/tasks/$taskId/terminal',
            params: { projectId: props.projectId, taskId: props.taskId }
        })
    }, [hasSession, navigate, props.projectId, props.taskId])

    const projectDefaults = useMemo(() => {
        const agent = (project?.defaultAgentFlavor as AgentType | null) ?? 'claude'
        const permissionMode = (project?.defaultPermissionMode as PermissionMode | null) ?? 'default'
        const modelMode = (project?.defaultModelMode as ModelMode | null) ?? null
        return { agent, permissionMode, modelMode }
    }, [project?.defaultAgentFlavor, project?.defaultPermissionMode, project?.defaultModelMode])

    if (taskSessionLoading || (shouldLoadTaskDetails && (taskLoading || projectLoading || workspacesLoading))) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>
        )
    }

    if (
        taskSessionError
        || (shouldLoadTaskDetails && (taskError || projectError || workspacesError || !task || !project))
    ) {
        return (
            <div className="h-full flex items-center justify-center p-4 text-sm text-red-600">
                {taskSessionError ?? taskError ?? projectError ?? workspacesError ?? t('projects.task.loadError')}
            </div>
        )
    }

    const headerTitle = task?.title ?? ''
    const headerSubtitle = project?.name

    const showWorkbenchHeader = activeTab === 'task'
    const taskPanel = task && project ? (
        <TaskDetailsPanel
            projectId={props.projectId}
            taskId={props.taskId}
            task={task}
            workspaces={workspaces}
            projectDefaultWorkspaceId={project.defaultWorkspaceId ?? null}
            projectMachineId={project.machineId}
            projectDefaults={projectDefaults}
        />
    ) : null

    const nonTaskPanel = activeTab === 'chat' ? (
        sessionId ? (
            <TaskSessionChat
                api={api}
                projectId={props.projectId}
                taskId={props.taskId}
                sessionId={sessionId}
                onBack={handleBackToProject}
                onViewFiles={handleOpenFiles}
                onViewDiffs={handleOpenDiffs}
                onViewTerminal={handleOpenTerminal}
            />
        ) : (
            <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                {t('projects.workbench.noSession')}
            </div>
        )
    ) : activeTab === 'terminal' ? (
        sessionId ? (
            <SessionTerminal sessionId={sessionId} onBack={handleBack} />
        ) : (
            <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                {t('projects.workbench.noSession')}
            </div>
        )
    ) : activeTab === 'diffs' ? (
        sessionId ? (
            <TaskSessionDiffs api={api} sessionId={sessionId} onBack={handleBack} />
        ) : (
            <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                {t('projects.workbench.noSession')}
            </div>
        )
    ) : activeTab === 'files' ? (
        sessionId ? (
            <TaskSessionFiles api={api} sessionId={sessionId} onBack={handleBack} />
        ) : (
            <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                {t('projects.workbench.noSession')}
            </div>
        )
    ) : (
        <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
            {t('projects.workbench.comingSoon')}
        </div>
    )

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {showWorkbenchHeader ? (
                <WorkbenchHeader
                    title={headerTitle}
                    subtitle={headerSubtitle}
                    onBack={handleBack}
                    onCopyLink={() => void copy(window.location.href)}
                    copied={copied}
                    backLabel={t('projects.actions.back')}
                    copyLabel={t('projects.task.copyLink')}
                />
            ) : null}

            <div className="hidden lg:block flex-1 min-h-0">
                {activeTab === 'task' ? taskPanel : nonTaskPanel}
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden lg:hidden">
                <div
                    className={`absolute inset-0 transition-transform duration-200 ease-out ${
                        activeTab === 'task'
                            ? 'translate-x-0 pointer-events-auto'
                            : '-translate-x-full pointer-events-none'
                    }`}
                >
                    {taskPanel}
                </div>
                <div
                    className={`absolute inset-0 transition-transform duration-200 ease-out ${
                        activeTab === 'task'
                            ? 'translate-x-full pointer-events-none'
                            : 'translate-x-0 pointer-events-auto'
                    }`}
                >
                    {activeTab === 'task' ? null : nonTaskPanel}
                </div>
            </div>
        </div>
    )
})
