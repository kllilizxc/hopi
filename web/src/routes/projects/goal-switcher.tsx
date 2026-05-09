import type { Goal } from '@/types/api'
import { PlusIcon, ChevronDownIcon } from '@/assets/icons'
import { Button } from '@/components/ui/button'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { useTranslation } from '@/lib/use-translation'

type GoalSwitcherProps = {
    goals: Goal[]
    selectedGoalId: string | null
    isLoading?: boolean
    leading?: React.ReactNode
    onSelectGoal: (goalId: string) => void
    onCreateGoal: () => void
}

export function GoalSwitcher(props: GoalSwitcherProps) {
    const { t } = useTranslation()
    const selected = props.goals.find((goal) => goal.id === props.selectedGoalId) ?? null
    const label = props.isLoading
        ? t('loading')
        : selected?.title ?? t('projects.goals.empty')

    return (
        <div
            data-testid="goal-switcher-toolbar"
            className="flex flex-wrap items-end gap-2 border-b border-[var(--app-divider)] px-3 py-2"
        >
            {props.leading ? (
                <div className="max-w-full shrink-0 overflow-x-auto">
                    {props.leading}
                </div>
            ) : null}
            <div className="min-w-[min(100%,18rem)] flex-1">
                <div className="text-[11px] font-medium uppercase text-[var(--app-hint)]">
                    {t('projects.goals.current')}
                </div>
                <AdaptiveSelect
                    title={t('projects.goals.title')}
                    value={selected?.id ?? ''}
                    options={props.goals.map((goal) => ({ value: goal.id, label: goal.title }))}
                    onValueChange={props.onSelectGoal}
                    disabled={props.goals.length === 0 || props.isLoading}
                    trigger={
                        <Button type="button" variant="secondary" className="mt-1 w-full justify-between gap-2">
                            <span className="truncate">{label}</span>
                            <ChevronDownIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        </Button>
                    }
                />
            </div>
            <Button type="button" variant="secondary" onClick={props.onCreateGoal} className="shrink-0 gap-2">
                <PlusIcon className="h-4 w-4" />
                {t('projects.goals.create')}
            </Button>
        </div>
    )
}
