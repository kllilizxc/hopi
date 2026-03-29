import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PermissionMode, TaskPriority, WorkflowStrategyDescriptor } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import type { AgentType } from '@/components/NewSession/types'
import { getTaskPermissionModeOptionsForFlavor, resolveTaskPermissionModeForFlavor } from '@/lib/taskPermissionMode'
import { getModelOptionsForFlavor, shouldResetModelForFlavor } from '@hopi/protocol'
import { resolveNewTaskDialogOptions, saveStoredNewTaskDialogOptions } from './new-task-dialog-storage'

function getTaskDraftTitle(draft: string): string {
    const trimmed = draft.trim()
    if (!trimmed) {
        return ''
    }
    const newlineIndex = trimmed.indexOf('\n')
    const titleLine = newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex)
    return titleLine.trim()
}

function parseTaskDraft(draft: string): { title: string; description: string | undefined } {
    const trimmed = draft.trim()
    if (!trimmed) {
        return { title: '', description: undefined }
    }
    const lines = trimmed.split('\n')
    const title = lines[0].trim()
    const description = lines.slice(1).join('\n').trim()
    return {
        title,
        description: description ? description : undefined
    }
}

type NewTaskDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultAgent: AgentType
    defaultPermissionMode: PermissionMode | null
    workflowStrategies: WorkflowStrategyDescriptor[]
    isCreating: boolean
    onCreate: (data: {
        title: string
        description: string | undefined
        priority: TaskPriority | ''
        agent: AgentType
        permissionMode: PermissionMode
        model: string
        workflowProfile: string
    }) => void
}

const NewTaskDialogComponent = (props: NewTaskDialogProps) => {
    const { t } = useTranslation()
    const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const wasOpenRef = useRef(props.open)
    const hasTitleRef = useRef(false)
    const [hasTitle, setHasTitle] = useState(false)
    const initialOptions = useMemo(() => resolveNewTaskDialogOptions({
        defaultAgent: props.defaultAgent,
        defaultPermissionMode: props.defaultPermissionMode
    }), [props.defaultAgent, props.defaultPermissionMode])

    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority | ''>(initialOptions.priority)
    const [newTaskAgent, setNewTaskAgent] = useState<AgentType>(initialOptions.agent)
    const [newTaskModel, setNewTaskModel] = useState(initialOptions.model)
    const [newTaskWorkflowProfile, setNewTaskWorkflowProfile] = useState(initialOptions.workflowProfile)
    const [newTaskPermissionMode, setNewTaskPermissionMode] = useState<PermissionMode>(initialOptions.permissionMode)

    const newTaskPermissionOptions = useMemo(
        () => getTaskPermissionModeOptionsForFlavor(newTaskAgent),
        [newTaskAgent]
    )

    useEffect(() => {
        if (newTaskPermissionOptions.some((option) => option.mode === newTaskPermissionMode)) {
            return
        }
        setNewTaskPermissionMode(resolveTaskPermissionModeForFlavor(newTaskAgent, null))
    }, [newTaskPermissionOptions, newTaskPermissionMode, newTaskAgent])

    useEffect(() => {
        const options = getModelOptionsForFlavor(newTaskAgent)
        if (options.length === 0) {
            if (newTaskModel !== 'auto') {
                setNewTaskModel('auto')
            }
            return
        }
        if (shouldResetModelForFlavor(newTaskModel, newTaskAgent)) {
            setNewTaskModel('auto')
        }
    }, [newTaskAgent, newTaskModel])

    useEffect(() => {
        saveStoredNewTaskDialogOptions({
            priority: newTaskPriority,
            agent: newTaskAgent,
            model: newTaskModel,
            permissionMode: newTaskPermissionMode,
            workflowProfile: newTaskWorkflowProfile
        })
    }, [newTaskPriority, newTaskAgent, newTaskModel, newTaskPermissionMode, newTaskWorkflowProfile])

    useEffect(() => {
        const workflowProfile = newTaskWorkflowProfile.trim().toLowerCase()
        if (workflowProfile !== 'gsd') {
            return
        }

        const desiredMode: PermissionMode = newTaskAgent === 'gemini'
            ? 'read-only'
            : newTaskAgent === 'opencode'
                ? 'default'
                : 'plan'

        if (newTaskPermissionMode === desiredMode) {
            return
        }

        if (!newTaskPermissionOptions.some((option) => option.mode === desiredMode)) {
            return
        }

        setNewTaskPermissionMode(desiredMode)
    }, [newTaskAgent, newTaskPermissionMode, newTaskPermissionOptions, newTaskWorkflowProfile])

    useEffect(() => {
        const wasOpen = wasOpenRef.current

        if (props.open && !wasOpen) {
            const restored = resolveNewTaskDialogOptions({
                defaultAgent: props.defaultAgent,
                defaultPermissionMode: props.defaultPermissionMode
            })
            setNewTaskPriority(restored.priority)
            setNewTaskAgent(restored.agent)
            setNewTaskModel(restored.model)
            setNewTaskWorkflowProfile(restored.workflowProfile)
            setNewTaskPermissionMode(restored.permissionMode)
        }

        if (!props.open && wasOpen) {
            hasTitleRef.current = false
            setHasTitle(false)
            if (draftTextareaRef.current) {
                draftTextareaRef.current.value = ''
            }
        }

        wasOpenRef.current = props.open
    }, [props.open, props.defaultAgent, props.defaultPermissionMode])

    const handleSubmit = useCallback((event: React.FormEvent) => {
        event.preventDefault()
        const draft = draftTextareaRef.current?.value ?? ''
        const parsed = parseTaskDraft(draft)
        if (!parsed.title) {
            return
        }

        props.onCreate({
            title: parsed.title,
            description: parsed.description,
            priority: newTaskPriority,
            agent: newTaskAgent,
            permissionMode: newTaskPermissionMode,
            model: newTaskModel,
            workflowProfile: newTaskWorkflowProfile
        })
    }, [props.onCreate, newTaskPriority, newTaskAgent, newTaskPermissionMode, newTaskModel, newTaskWorkflowProfile])

    const handlePriorityChange = useCallback((value: string) => {
        setNewTaskPriority((value as TaskPriority) || '')
    }, [])

    const handleDraftChange = useCallback((nextDraft: string) => {
        const nextHasTitle = Boolean(getTaskDraftTitle(nextDraft))
        if (nextHasTitle !== hasTitleRef.current) {
            hasTitleRef.current = nextHasTitle
            setHasTitle(nextHasTitle)
        }
    }, [])

    const handlePermissionModeChange = useCallback((value: string) => {
        setNewTaskPermissionMode(value as PermissionMode)
    }, [])

    const handleWorkflowProfileChange = useCallback((value: string) => {
        const next = value.trim().toLowerCase()
        if (!next) return
        setNewTaskWorkflowProfile(next)
    }, [])

    const priorityOptions = useMemo(() => [
        { value: '', label: t('projects.task.priority.none') },
        { value: 'high', label: t('projects.task.priority.high') },
        { value: 'medium', label: t('projects.task.priority.medium') },
        { value: 'low', label: t('projects.task.priority.low') },
    ], [t])

    const workflowStrategyOptions = useMemo(() => {
        const base = props.workflowStrategies.length > 0
            ? props.workflowStrategies
            : [
                { id: 'default', label: 'Default', defaultTaskPhase: null, phaseOptions: [] },
                { id: 'gsd', label: 'GSD', defaultTaskPhase: 'discuss', phaseOptions: ['discuss', 'plan', 'execute_ready', 'execute', 'verify', 'done'] }
            ]

        const options = base.map((strategy) => ({
            value: strategy.id,
            label: strategy.id === 'default'
                ? t('projects.automation.workflowDefault')
                : strategy.id === 'gsd'
                    ? t('projects.automation.workflowGsd')
                    : strategy.label || strategy.id
        }))

        if (!options.some((option) => option.value === newTaskWorkflowProfile)) {
            options.push({ value: newTaskWorkflowProfile, label: newTaskWorkflowProfile })
        }

        return options
    }, [newTaskWorkflowProfile, props.workflowStrategies, t])

    const permissionModeSelectOptions = useMemo(() =>
        newTaskPermissionOptions.map((opt) => ({
            value: opt.mode as PermissionMode,
            label: opt.label,
        })),
        [newTaskPermissionOptions]
    )

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('projects.tasks.create')}</DialogTitle>
                    <DialogDescription>{t('projects.tasks.createHint')}</DialogDescription>
                </DialogHeader>

                <form className="mt-4" onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.tasks.details')}
                            </label>
                            <textarea
                                ref={draftTextareaRef}
                                defaultValue=""
                                onChange={(e) => handleDraftChange(e.target.value)}
                                disabled={props.isCreating}
                                rows={6}
                                placeholder={t('projects.tasks.detailsPlaceholder')}
                                className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.task.priority')}
                            </label>
                            <AdaptiveSelectField
                                title={t('projects.task.priority')}
                                value={newTaskPriority}
                                options={priorityOptions}
                                onValueChange={handlePriorityChange}
                                disabled={props.isCreating}
                                align="start"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.automation.workflowStrategy')}
                            </label>
                            <AdaptiveSelectField
                                title={t('projects.automation.workflowStrategy')}
                                value={newTaskWorkflowProfile}
                                options={workflowStrategyOptions}
                                onValueChange={handleWorkflowProfileChange}
                                disabled={props.isCreating}
                                align="start"
                            />
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('projects.automation.workflowHint')}
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <AgentSelector
                                agent={newTaskAgent}
                                isDisabled={props.isCreating}
                                onAgentChange={setNewTaskAgent}
                                compact
                            />
                        </div>
                        <div className="space-y-1.5">
                            <ModelSelector
                                agent={newTaskAgent}
                                model={newTaskModel}
                                isDisabled={props.isCreating}
                                onModelChange={setNewTaskModel}
                                compact
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('misc.permissionMode')}
                            </label>
                            <AdaptiveSelectField
                                title={t('misc.permissionMode')}
                                value={newTaskPermissionMode}
                                options={permissionModeSelectOptions}
                                onValueChange={handlePermissionModeChange}
                                disabled={props.isCreating}
                                align="start"
                            />
                            {newTaskPermissionMode === 'plan' ? (
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('projects.tasks.planModeHint')}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="mt-5 flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)} disabled={props.isCreating}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="submit" variant="secondary" disabled={props.isCreating || !hasTitle || !newTaskWorkflowProfile}>
                            {props.isCreating ? t('projects.tasks.creating') : t('projects.tasks.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export const NewTaskDialog = memo(NewTaskDialogComponent)
