import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PermissionMode, TaskPriority } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import type { AgentType } from '@/components/NewSession/types'
import { getTaskPermissionModeOptionsForFlavor, resolveTaskPermissionModeForFlavor } from '@/lib/taskPermissionMode'

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
    isCreating: boolean
    onCreate: (data: {
        title: string
        description: string | undefined
        priority: TaskPriority | ''
        agent: AgentType
        permissionMode: PermissionMode
        model: string
    }) => void
}

const NewTaskDialogComponent = (props: NewTaskDialogProps) => {
    const { t } = useTranslation()
    const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const hasTitleRef = useRef(false)
    const [hasTitle, setHasTitle] = useState(false)
    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority | ''>('')
    const [newTaskAgent, setNewTaskAgent] = useState<AgentType>(props.defaultAgent)
    const [newTaskModel, setNewTaskModel] = useState('auto')
    const [newTaskPermissionMode, setNewTaskPermissionMode] = useState<PermissionMode>(() => (
        resolveTaskPermissionModeForFlavor(props.defaultAgent, props.defaultPermissionMode)
    ))

    const newTaskPermissionOptions = useMemo(
        () => getTaskPermissionModeOptionsForFlavor(newTaskAgent),
        [newTaskAgent]
    )

    useEffect(() => {
        if (newTaskPermissionOptions.some((option) => option.mode === newTaskPermissionMode)) {
            return
        }
        setNewTaskPermissionMode(resolveTaskPermissionModeForFlavor(newTaskAgent, props.defaultPermissionMode))
    }, [newTaskPermissionOptions, newTaskPermissionMode, newTaskAgent, props.defaultPermissionMode])

    useEffect(() => {
        setNewTaskModel('auto')
    }, [newTaskAgent])

    // Reset form when dialog closes
    useEffect(() => {
        if (!props.open) {
            hasTitleRef.current = false
            setHasTitle(false)
            if (draftTextareaRef.current) {
                draftTextareaRef.current.value = ''
            }
            setNewTaskPriority('')
            setNewTaskAgent(props.defaultAgent)
            setNewTaskModel('auto')
            setNewTaskPermissionMode(resolveTaskPermissionModeForFlavor(props.defaultAgent, props.defaultPermissionMode))
        }
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
            model: newTaskModel
        })
    }, [props.onCreate, newTaskPriority, newTaskAgent, newTaskPermissionMode, newTaskModel])

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

    const priorityOptions = useMemo(() => [
        { value: '', label: t('projects.task.priority.none') },
        { value: 'high', label: t('projects.task.priority.high') },
        { value: 'medium', label: t('projects.task.priority.medium') },
        { value: 'low', label: t('projects.task.priority.low') },
    ], [t])

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
                    <div className="space-y-3">
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
                        <AgentSelector
                            agent={newTaskAgent}
                            isDisabled={props.isCreating}
                            onAgentChange={setNewTaskAgent}
                        />
                        <ModelSelector
                            agent={newTaskAgent}
                            model={newTaskModel}
                            isDisabled={props.isCreating}
                            onModelChange={setNewTaskModel}
                        />
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
                        <Button type="submit" variant="secondary" disabled={props.isCreating || !hasTitle}>
                            {props.isCreating ? t('projects.tasks.creating') : t('projects.tasks.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export const NewTaskDialog = memo(NewTaskDialogComponent)
