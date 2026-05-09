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
        <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 sm:px-4 sm:py-3">
            <div
                data-testid="goal-switcher-toolbar"
                className="grid w-full min-w-0 gap-2 lg:grid-cols-[minmax(20rem,1fr)_auto_auto] lg:items-center lg:gap-3"
            >
                <div
                    data-testid="goal-switcher-goal-row"
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:contents"
                >
                    <div data-testid="goal-switcher-current-goal" className="min-w-0">
                        <AdaptiveSelect
                            title={t('projects.goals.title')}
                            value={selected?.id ?? ''}
                            options={props.goals.map((goal) => ({ value: goal.id, label: goal.title }))}
                            onValueChange={props.onSelectGoal}
                            disabled={props.goals.length === 0 || props.isLoading}
                            trigger={
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="h-10 w-full justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 shadow-sm hover:border-[var(--app-divider)] hover:opacity-100 sm:h-11 sm:gap-3 sm:px-4"
                                >
                                    <span className="truncate text-left">{label}</span>
                                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                                </Button>
                            }
                        />
                    </div>
                    <div data-testid="goal-switcher-actions" className="flex min-w-0 justify-end">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={props.onCreateGoal}
                            className="h-10 shrink-0 gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 shadow-sm hover:border-[var(--app-divider)] hover:opacity-100 sm:h-11 sm:px-4"
                        >
                            <PlusIcon className="h-4 w-4" />
                            {t('projects.goals.create')}
                        </Button>
                    </div>
                </div>
                {props.leading ? (
                    <div
                        data-testid="goal-switcher-leading"
                        className="w-full min-w-0 overflow-x-auto lg:w-auto lg:pb-0.5"
                    >
                        {props.leading}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
