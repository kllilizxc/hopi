import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'

type CreateGoalDialogInput = {
    title: string
    description: string | null
    successCriteria: string | null
    autopilotEnabled: boolean
    deployRequiresApproval: boolean
}

type CreateGoalDialogProps = {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    onCreate: (input: CreateGoalDialogInput) => Promise<boolean>
    isPending: boolean
    error: string | null
}

export function CreateGoalDialog(props: CreateGoalDialogProps) {
    const { t } = useTranslation()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [successCriteria, setSuccessCriteria] = useState('')
    const [autopilotEnabled, setAutopilotEnabled] = useState(true)
    const [deployRequiresApproval, setDeployRequiresApproval] = useState(true)

    useEffect(() => {
        if (!props.isOpen) {
            setTitle('')
            setDescription('')
            setSuccessCriteria('')
            setAutopilotEnabled(true)
            setDeployRequiresApproval(true)
        }
    }, [props.isOpen])

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmedTitle = title.trim()
        if (!trimmedTitle || props.isPending) return

        void props.onCreate({
            title: trimmedTitle,
            description: description.trim() || null,
            successCriteria: successCriteria.trim() || null,
            autopilotEnabled,
            deployRequiresApproval
        })
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('projects.goals.create')}</DialogTitle>
                    <DialogDescription>{t('projects.goals.createHint')}</DialogDescription>
                </DialogHeader>
                <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.title')}
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.description')}
                        </label>
                        <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            disabled={props.isPending}
                            rows={3}
                            className="w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.successCriteria')}
                        </label>
                        <textarea
                            value={successCriteria}
                            onChange={(event) => setSuccessCriteria(event.target.value)}
                            disabled={props.isPending}
                            rows={3}
                            className="w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={autopilotEnabled} onCheckedChange={setAutopilotEnabled} disabled={props.isPending} />
                            {t('projects.goals.autopilot')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={deployRequiresApproval} onCheckedChange={setDeployRequiresApproval} disabled={props.isPending} />
                            {t('projects.goals.deployApproval')}
                        </label>
                    </div>
                    {props.error ? <div className="text-sm text-red-600">{props.error}</div> : null}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)} disabled={props.isPending}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="submit" disabled={!title.trim() || props.isPending}>
                            {t('projects.goals.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
