import { useEffect, useRef, useState, type FormEvent } from 'react'
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
    clientRequestId: string
}

type CreateGoalDialogProps = {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    onCreate: (input: CreateGoalDialogInput) => Promise<boolean>
    isPending: boolean
    error: string | null
}

function createClientRequestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function CreateGoalDialog(props: CreateGoalDialogProps) {
    const { t } = useTranslation()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [successCriteria, setSuccessCriteria] = useState('')
    const [autopilotEnabled, setAutopilotEnabled] = useState(true)
    const [deployRequiresApproval, setDeployRequiresApproval] = useState(true)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)

    useEffect(() => {
        if (!props.isOpen) {
            setTitle('')
            setDescription('')
            setSuccessCriteria('')
            setAutopilotEnabled(true)
            setDeployRequiresApproval(true)
            setIsSubmitting(false)
            submittingRef.current = false
        }
    }, [props.isOpen])

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmedTitle = title.trim()
        if (!trimmedTitle || props.isPending || submittingRef.current) return

        submittingRef.current = true
        setIsSubmitting(true)

        void (async () => {
            const created = await props.onCreate({
                title: trimmedTitle,
                description: description.trim() || null,
                successCriteria: successCriteria.trim() || null,
                autopilotEnabled,
                deployRequiresApproval,
                clientRequestId: createClientRequestId()
            })
            if (!created) {
                submittingRef.current = false
                setIsSubmitting(false)
            }
        })()
    }
    const pending = props.isPending || isSubmitting

    return (
        <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('projects.goals.create')}</DialogTitle>
                    <DialogDescription>{t('projects.goals.createHint')}</DialogDescription>
                </DialogHeader>
                <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1.5">
                        <label htmlFor="create-goal-title" className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.title')}
                        </label>
                        <input
                            id="create-goal-title"
                            type="text"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            disabled={pending}
                            className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="create-goal-description" className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.description')}
                        </label>
                        <textarea
                            id="create-goal-description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            disabled={pending}
                            rows={3}
                            className="w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="create-goal-success-criteria" className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.goals.fields.successCriteria')}
                        </label>
                        <textarea
                            id="create-goal-success-criteria"
                            value={successCriteria}
                            onChange={(event) => setSuccessCriteria(event.target.value)}
                            disabled={pending}
                            rows={3}
                            className="w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={autopilotEnabled} onCheckedChange={setAutopilotEnabled} disabled={pending} />
                            {t('projects.goals.autopilot')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={deployRequiresApproval} onCheckedChange={setDeployRequiresApproval} disabled={pending} />
                            {t('projects.goals.deployApproval')}
                        </label>
                    </div>
                    {props.error ? <div className="text-sm text-red-600">{props.error}</div> : null}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)} disabled={pending}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="submit" disabled={!title.trim() || pending}>
                            {t('projects.goals.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
