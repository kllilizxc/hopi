import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import { TASK_STATUS_ORDER } from '@hapi/protocol/tasks'
import type { AgentFlavor, PermissionMode, Task, TaskAttachment, TaskPriority, TaskStatus, Workspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { TASK_STATUS_TITLE_KEY_BY_STATUS } from '@/lib/task-status'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useArchiveTask } from '@/hooks/mutations/useArchiveTask'
import { useAttachTaskSession } from '@/hooks/mutations/useAttachTaskSession'
import { useStartTaskSession } from '@/hooks/mutations/useStartTaskSession'
import { useUpdateTask } from '@/hooks/mutations/useUpdateTask'
import { useProject } from '@/hooks/queries/useProject'
import { useSessions } from '@/hooks/queries/useSessions'
import { useTask } from '@/hooks/queries/useTask'
import { useWorkspaces } from '@/hooks/queries/useWorkspaces'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import { YoloToggle } from '@/components/NewSession/YoloToggle'
import type { AgentType } from '@/components/NewSession/types'
import { TaskSessionChat } from '@/routes/projects/task-session-chat'
import { TaskSessionDiffs } from '@/routes/projects/task-session-diffs'
import { TaskSessionFiles } from '@/routes/projects/task-session-files'
import { SessionTerminal } from '@/routes/sessions/terminal'
import { BackIcon, CopyIcon } from '@/assets/icons'

const MAX_TASK_ATTACHMENTS_BYTES = 10 * 1024 * 1024

type TaskWorkbenchTab = 'task' | 'chat' | 'terminal' | 'diffs' | 'files'

function getTaskPriorityLabelKey(priority: TaskPriority): string {
    return `projects.task.priority.${priority}`
}

function getTaskPriorityBadgeVariant(priority: TaskPriority): 'default' | 'warning' | 'destructive' {
    switch (priority) {
        case 'high':
            return 'destructive'
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

type StartSessionConfig = {
    workspaceId: string
    agent: AgentType
    model: string
    yolo: boolean
    permissionMode: PermissionMode
}

function StartSessionDialog(props: {
    isOpen: boolean
    onClose: () => void
    projectId: string
    taskId: string
    machineId: string
    projectDefaults: {
        agent: AgentType
        permissionMode: PermissionMode
        modelMode: string | null
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
    const initialAgent = props.projectDefaults.agent
    const initialModel = (() => {
        const mode = props.projectDefaults.modelMode
        if (initialAgent === 'claude' && (mode === 'sonnet' || mode === 'opus')) {
            return mode
        }
        return 'auto'
    })()

    const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId)
    const [agent, setAgent] = useState<AgentType>(initialAgent)
    const [model, setModel] = useState(initialModel)
    const [yolo, setYolo] = useState(false)
    const [permissionMode, setPermissionMode] = useState<PermissionMode>(props.projectDefaults.permissionMode)

    useEffect(() => {
        if (!props.isOpen) return
        setWorkspaceId(initialWorkspaceId)
        setAgent(initialAgent)
        setModel(initialModel)
        setYolo(false)
        setPermissionMode(props.projectDefaults.permissionMode)
    }, [props.isOpen, initialWorkspaceId, initialAgent, initialModel, props.projectDefaults.permissionMode])

    const permissionOptions = useMemo(() => getPermissionModeOptionsForFlavor(agent), [agent])

    useEffect(() => {
        if (permissionOptions.some((option) => option.mode === permissionMode)) {
            return
        }
        setPermissionMode('default')
    }, [permissionOptions, permissionMode])

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
                        <select
                            value={workspaceId}
                            onChange={(e) => setWorkspaceId(e.target.value)}
                            disabled={isPending}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        >
                            {props.workspaces.map((ws) => (
                                <option key={ws.id} value={ws.id}>
                                    {(ws.label ?? ws.path) || ws.id}
                                </option>
                            ))}
                        </select>
                    </div>

                    <AgentSelector agent={agent} isDisabled={isPending} onAgentChange={setAgent} />
                    <ModelSelector agent={agent} model={model} isDisabled={isPending} onModelChange={setModel} />

                    <div className="px-3 space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('misc.permissionMode')}
                        </label>
                        <select
                            value={permissionMode}
                            onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
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
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={unassignedOnly}
                            onChange={(e) => setUnassignedOnly(e.target.checked)}
                            disabled={isPending}
                        />
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
                            const title = session.metadata?.name
                                ?? session.metadata?.summary?.text
                                ?? session.metadata?.path
                                ?? session.id.slice(0, 8)
                            const linked = Boolean(session.metadata?.taskId)

                            return (
                                <button
                                    key={session.id}
                                    type="button"
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
                                            {linked ? <Badge variant="warning">{t('projects.sessions.linked')}</Badge> : null}
                                            <Badge variant={session.active ? 'success' : 'default'}>
                                                {session.active ? t('misc.online') : t('misc.offline')}
                                            </Badge>
                                        </div>
                                    </div>
                                </button>
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
        modelMode: string | null
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
    const [attachments, setAttachments] = useState<TaskAttachment[]>(Array.isArray(props.task.attachments) ? props.task.attachments : [])
    const [attachmentsBusy, setAttachmentsBusy] = useState(false)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [startOpen, setStartOpen] = useState(false)
    const [attachOpen, setAttachOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)

    useEffect(() => {
        setTitle(props.task.title)
        setDescription(props.task.description ?? '')
        setStatus(props.task.status)
        setPriority(props.task.priority ?? '')
        setWorkspaceId(props.task.workspaceId ?? '')
        setAttachments(Array.isArray(props.task.attachments) ? props.task.attachments : [])
    }, [props.task.id, props.task.title, props.task.description, props.task.status, props.task.priority, props.task.workspaceId, props.task.attachments])

    const totalBytes = useMemo(() => getAttachmentsSizeBytes(attachments), [attachments])
    const overLimit = totalBytes > MAX_TASK_ATTACHMENTS_BYTES

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

    const handleAddFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return
        setAttachmentsBusy(true)
        try {
            const next: TaskAttachment[] = [...attachments]
            for (const file of Array.from(files)) {
                if (next.reduce((sum, a) => sum + a.size, 0) + file.size > MAX_TASK_ATTACHMENTS_BYTES) {
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
            }
            setAttachments(next)
            await savePatch({ attachments: next })
        } finally {
            setAttachmentsBusy(false)
        }
    }

    const handleRemoveAttachment = async (id: string) => {
        const next = attachments.filter((a) => a.id !== id)
        setAttachments(next)
        await savePatch({ attachments: next })
    }

    const effectiveWorkspaceLabel = useMemo(() => {
        const resolvedWorkspaceId = props.task.workspaceId ?? props.projectDefaultWorkspaceId
        if (!resolvedWorkspaceId) {
            return t('projects.task.workspace.none')
        }
        const ws = props.workspaces.find((w) => w.id === resolvedWorkspaceId)
        return ws?.label ?? ws?.path ?? resolvedWorkspaceId
    }, [props.task.workspaceId, props.projectDefaultWorkspaceId, props.workspaces, t])

    const sessionId = props.task.activeSessionId ?? null

    return (
        <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4 space-y-6">
                    <section className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    onBlur={() => {
                                        if (title.trim() && title.trim() !== props.task.title) {
                                            void savePatch({ title: title.trim() })
                                        }
                                    }}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                    disabled={isUpdatingTask}
                                />
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                                    <Badge variant="default">{t('projects.task.workspace.label')}: {effectiveWorkspaceLabel}</Badge>
                                    {props.task.priority ? (
                                        <Badge variant={getTaskPriorityBadgeVariant(props.task.priority)}>
                                            {t(getTaskPriorityLabelKey(props.task.priority))}
                                        </Badge>
                                    ) : null}
                                    {sessionId ? <Badge variant="success">{t('projects.task.sessionLinked')}</Badge> : <Badge variant="warning">{t('projects.task.noSession')}</Badge>}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => void copy(window.location.href)}
                                className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                                title={t('projects.task.copyLink')}
                            >
                                <CopyIcon className={copied ? 'text-[var(--app-link)]' : undefined} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('projects.task.status')}
                                </label>
                                <select
                                    value={status}
                                    onChange={(e) => {
                                        const next = e.target.value as TaskStatus
                                        setStatus(next)
                                        void savePatch({ status: next, sortKey: Date.now() })
                                    }}
                                    disabled={isUpdatingTask}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    {TASK_STATUS_ORDER.map((s) => (
                                        <option key={s} value={s}>
                                            {t(TASK_STATUS_TITLE_KEY_BY_STATUS[s])}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('projects.task.priority')}
                                </label>
                                <select
                                    value={priority}
                                    onChange={(e) => {
                                        const next = (e.target.value as TaskPriority) || ''
                                        setPriority(next)
                                        void savePatch({ priority: next || null })
                                    }}
                                    disabled={isUpdatingTask}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    <option value="">{t('projects.task.priority.none')}</option>
                                    <option value="high">{t('projects.task.priority.high')}</option>
                                    <option value="medium">{t('projects.task.priority.medium')}</option>
                                    <option value="low">{t('projects.task.priority.low')}</option>
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('projects.task.workspace')}
                                </label>
                                <select
                                    value={workspaceId}
                                    onChange={(e) => {
                                        const value = e.target.value
                                        setWorkspaceId(value)
                                        void savePatch({ workspaceId: value || null })
                                    }}
                                    disabled={isUpdatingTask}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                >
                                    <option value="">
                                        {t('projects.task.workspace.projectDefault')}
                                    </option>
                                    {props.workspaces.map((ws) => (
                                        <option key={ws.id} value={ws.id}>
                                            {(ws.label ?? ws.path) || ws.id}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.task.description')}
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                onBlur={() => {
                                    const next = description.trim() ? description.trim() : ''
                                    const prev = (props.task.description ?? '').trim()
                                    if (next !== prev) {
                                        void savePatch({ description: next ? next : null })
                                    }
                                }}
                                rows={8}
                                disabled={isUpdatingTask}
                                className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t('projects.task.attachments.title')}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('projects.task.attachments.budget', { used: formatBytes(totalBytes), max: formatBytes(MAX_TASK_ATTACHMENTS_BYTES) })}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    disabled={isUpdatingTask || attachmentsBusy}
                                    onChange={(e) => {
                                        void handleAddFiles(e.target.files)
                                        e.currentTarget.value = ''
                                    }}
                                    className="hidden"
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={isUpdatingTask || attachmentsBusy}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {t('projects.task.attachments.add')}
                                </Button>
                            </div>
                        </div>

                        {overLimit ? (
                            <div className="rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">
                                {t('projects.task.attachments.overLimit')}
                            </div>
                        ) : null}

                        {attachments.length === 0 ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                {t('projects.task.attachments.empty')}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {attachments.map((att) => (
                                    <div key={att.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium truncate">{att.filename}</div>
                                            <div className="text-xs text-[var(--app-hint)]">
                                                {formatBytes(att.size)} · {att.mimeType}
                                            </div>
                                        </div>
                                        <Button type="button" variant="secondary" onClick={() => void handleRemoveAttachment(att.id)} disabled={isUpdatingTask || attachmentsBusy}>
                                            {t('projects.task.attachments.remove')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="space-y-3">
                        <div className="text-sm font-semibold">{t('projects.sessions.title')}</div>

                        {sessionId ? (
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => void navigate({
                                        to: '/projects/$projectId/tasks/$taskId/chat',
                                        params: { projectId: props.projectId, taskId: props.taskId }
                                    })}
                                >
                                    {t('projects.sessions.openChat')}
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => setStartOpen(true)}>
                                    {t('projects.sessions.startNew')}
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="secondary" onClick={() => setStartOpen(true)} disabled={isUpdatingTask || overLimit}>
                                    {t('projects.sessions.start')}
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => setAttachOpen(true)} disabled={isUpdatingTask}>
                                    {t('projects.sessions.attach')}
                                </Button>
                            </div>
                        )}

                        {overLimit ? (
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('projects.task.attachments.mustFix')}
                            </div>
                        ) : null}
                    </section>

                    <section className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.task.archive.title')}</div>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.task.archive.hint')}</div>
                        <Button type="button" variant="destructive" onClick={() => setArchiveOpen(true)} disabled={isUpdatingTask || isArchiving}>
                            {t('projects.task.archive.action')}
                        </Button>
                    </section>
                </div>
            </div>

            <StartSessionDialog
                isOpen={startOpen}
                onClose={() => setStartOpen(false)}
                projectId={props.projectId}
                taskId={props.taskId}
                machineId={props.projectMachineId}
                projectDefaults={props.projectDefaults}
                workspaces={props.workspaces}
                defaultWorkspaceId={props.projectDefaultWorkspaceId}
                taskWorkspaceId={props.task.workspaceId ?? null}
                onStarted={() => {
                    void navigate({
                        to: '/projects/$projectId/tasks/$taskId/chat',
                        params: { projectId: props.projectId, taskId: props.taskId }
                    })
                }}
            />

            <AttachSessionDialog
                isOpen={attachOpen}
                onClose={() => setAttachOpen(false)}
                projectId={props.projectId}
                taskId={props.taskId}
                machineId={props.projectMachineId}
                onAttached={() => {
                    void navigate({
                        to: '/projects/$projectId/tasks/$taskId/chat',
                        params: { projectId: props.projectId, taskId: props.taskId }
                    })
                }}
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
}) {
    return (
        <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)] border-b border-[var(--app-divider)]">
            <div className="mx-auto w-full max-w-content flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{props.title}</div>
                        {props.subtitle ? (
                            <div className="text-[10px] text-[var(--app-hint)] truncate">{props.subtitle}</div>
                        ) : null}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={props.onCopyLink}
                    className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                >
                    <CopyIcon className={props.copied ? 'text-[var(--app-link)]' : undefined} />
                </button>
            </div>
        </div>
    )
}

function TabButton(props: {
    label: string
    active: boolean
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            disabled={props.disabled}
            onClick={props.onClick}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                props.active
                    ? 'bg-[var(--app-link)] text-[var(--app-bg)] border-[var(--app-link)]'
                    : props.disabled
                        ? 'bg-[var(--app-bg)] text-[var(--app-hint)] border-[var(--app-border)] opacity-60'
                        : 'bg-[var(--app-bg)] text-[var(--app-fg)] border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)]'
            }`}
        >
            {props.label}
        </button>
    )
}

export function TaskWorkbench(props: {
    projectId: string
    taskId: string
    tab: TaskWorkbenchTab
    forceTask?: boolean
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { api } = useAppContext()
    const { copy, copied } = useCopyToClipboard()
    const { task, isLoading: taskLoading, error: taskError } = useTask(api, props.taskId)
    const { project, isLoading: projectLoading, error: projectError } = useProject(api, props.projectId)
    const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspaces(api, props.projectId)

    const sessionId = task?.activeSessionId ?? null
    const hasSession = Boolean(sessionId)
    const activeTab: TaskWorkbenchTab = props.forceTask ? 'task' : (props.tab === 'task' && hasSession ? 'chat' : props.tab)

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
    }, [navigate, props.projectId, props.taskId, props.tab])

    const handleBackToProject = useCallback(() => {
        void navigate({ to: '/projects/$projectId', params: { projectId: props.projectId } })
    }, [navigate, props.projectId])

    const projectDefaults = useMemo(() => {
        const agent = (project?.defaultAgentFlavor as AgentType | null) ?? 'claude'
        const permissionMode = (project?.defaultPermissionMode as PermissionMode | null) ?? 'default'
        const modelMode = project?.defaultModelMode ? String(project.defaultModelMode) : null
        return { agent, permissionMode, modelMode }
    }, [project?.defaultAgentFlavor, project?.defaultPermissionMode, project?.defaultModelMode])

    if (taskLoading || projectLoading || workspacesLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>
        )
    }

    if (taskError || projectError || workspacesError || !task || !project) {
        return (
            <div className="h-full flex items-center justify-center p-4 text-sm text-red-600">
                {taskError ?? projectError ?? workspacesError ?? t('projects.task.loadError')}
            </div>
        )
    }

    const headerTitle = task.title
    const headerSubtitle = project.name

    const showWorkbenchHeader = activeTab === 'task'

    return (
        <div className="h-full flex flex-col">
            {showWorkbenchHeader ? (
                <WorkbenchHeader
                    title={headerTitle}
                    subtitle={headerSubtitle}
                    onBack={handleBack}
                    onCopyLink={() => void copy(window.location.href)}
                    copied={copied}
                />
            ) : null}

            <div className="flex-1 min-h-0">
                {activeTab === 'task' ? (
                    <TaskDetailsPanel
                        projectId={props.projectId}
                        taskId={props.taskId}
                        task={task}
                        workspaces={workspaces}
                        projectDefaultWorkspaceId={project.defaultWorkspaceId ?? null}
                        projectMachineId={project.machineId}
                        projectDefaults={projectDefaults}
                    />
                ) : activeTab === 'chat' ? (
                    sessionId ? (
                        <TaskSessionChat
                            api={api}
                            sessionId={sessionId}
                            onBack={handleBackToProject}
                            onViewFiles={() => {
                                void navigate({
                                    to: '/projects/$projectId/tasks/$taskId/files',
                                    params: { projectId: props.projectId, taskId: props.taskId }
                                })
                            }}
                            onViewDiffs={() => {
                                void navigate({
                                    to: '/projects/$projectId/tasks/$taskId/diffs',
                                    params: { projectId: props.projectId, taskId: props.taskId }
                                })
                            }}
                            onViewTerminal={() => {
                                void navigate({
                                    to: '/projects/$projectId/tasks/$taskId/terminal',
                                    params: { projectId: props.projectId, taskId: props.taskId }
                                })
                            }}
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
                )}
            </div>
        </div>
    )
}
