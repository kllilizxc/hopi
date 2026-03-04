import { useEffect, useMemo, useState } from 'react'
import type { PermissionMode, TaskPriority } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { AgentSelector } from '@/components/NewSession/AgentSelector'
import type { AgentType } from '@/components/NewSession/types'
import { getTaskPermissionModeOptionsForFlavor, resolveTaskPermissionModeForFlavor } from '@/lib/taskPermissionMode'

function parseTaskDraft(draft: string): { title: string; description: string | null } {
    const trimmed = draft.trim()
    if (!trimmed) {
        return { title: '', description: null }
    }
    const lines = trimmed.split('\n')
    const title = lines[0].trim()
    const description = lines.slice(1).join('\n').trim() || null
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
    }) => void
}

export function NewTaskDialog(props: NewTaskDialogProps) {
    const { t } = useTranslation()
    const [newTaskDraft, setNewTaskDraft] = useState('')
    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority | ''>('')
    const [newTaskAgent, setNewTaskAgent] = useState<AgentType>(props.defaultAgent)
    const [newTaskPermissionMode, setNewTaskPermissionMode] = useState<PermissionMode>(() => (
        resolveTaskPermissionModeForFlavor(props.defaultAgent, props.defaultPermissionMode)
    ))

    const parsedNewTaskDraft = useMemo(() => parseTaskDraft(newTaskDraft), [newTaskDraft])
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

    // Reset form when dialog closes
    useEffect(() => {
        if (!props.open) {
            setNewTaskDraft('')
            setNewTaskPriority('')
            setNewTaskAgent(props.defaultAgent)
            setNewTaskPermissionMode(resolveTaskPermissionModeForFlavor(props.defaultAgent, props.defaultPermissionMode))
        }
    }, [props.open, props.defaultAgent, props.defaultPermissionMode])

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault()
        props.onCreate({
            title: parsedNewTaskDraft.title,
            description: parsedNewTaskDraft.description,
            priority: newTaskPriority,
            agent: newTaskAgent,
            permissionMode: newTaskPermissionMode
        })
    }

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
                                value={newTaskDraft}
                                onChange={(e) => setNewTaskDraft(e.target.value)}
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
                                options={[
                                    { value: '', label: t('projects.task.priority.none') },
                                    { value: 'high', label: t('projects.task.priority.high') },
                                    { value: 'medium', label: t('projects.task.priority.medium') },
                                    { value: 'low', label: t('projects.task.priority.low') },
                                ]}
                                onValueChange={(value) => setNewTaskPriority((value as TaskPriority) || '')}
                                disabled={props.isCreating}
                                align="start"
                            />
                        </div>
                        <AgentSelector
                            agent={newTaskAgent}
                            isDisabled={props.isCreating}
                            onAgentChange={setNewTaskAgent}
                        />
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                {t('misc.permissionMode')}
                            </label>
                            <AdaptiveSelectField
                                title={t('misc.permissionMode')}
                                value={newTaskPermissionMode}
                                options={newTaskPermissionOptions.map((opt) => ({
                                    value: opt.mode as PermissionMode,
                                    label: opt.label,
                                }))}
                                onValueChange={(value) => setNewTaskPermissionMode(value as PermissionMode)}
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
                        <Button type="submit" variant="secondary" disabled={props.isCreating || !parsedNewTaskDraft.title}>
                            {props.isCreating ? t('projects.tasks.creating') : t('projects.tasks.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
