import type { ReactNode } from 'react'
import type { Goal } from '@/types/api'
import { PlusIcon, ChevronDownIcon, PauseIcon, PlayIcon, SpinnerIcon } from '@/assets/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tag } from '@/components/ui/tag'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { AdaptiveSelectTrigger } from '@/components/ui/AdaptiveSelectTrigger'
import { useTranslation } from '@/lib/use-translation'

type GoalSwitcherProps = {
    goals: Goal[]
    selectedGoalId: string | null
    isLoading?: boolean
    leading?: ReactNode
    onSelectGoal: (goalId: string) => void
    onToggleGoalAutomationPause?: (goalId: string) => void
    isAutomationTogglePending?: boolean
    onCreateGoal: () => void
}

function getGoalAutomationStatusKey(goal: Goal): string {
    if (goal.automationPausedAt != null) {
        return 'projects.goals.automationStatus.paused'
    }
    if (goal.status === 'blocked') {
        return 'projects.goals.automationStatus.blocked'
    }
    return 'projects.goals.automationStatus.running'
}

function getGoalAutomationStatusVariant(goal: Goal): 'warning' | 'success' | 'error' {
    if (goal.automationPausedAt != null) {
        return 'warning'
    }
    if (goal.status === 'blocked') {
        return 'error'
    }
    return 'success'
}

export function GoalSwitcher(props: GoalSwitcherProps) {
    const { t } = useTranslation()
    const selected = props.goals.find((goal) => goal.id === props.selectedGoalId) ?? null
    const label = props.isLoading
        ? t('loading')
        : selected?.title ?? t('projects.goals.empty')
    const automationPaused = Boolean(selected?.automationPausedAt)
    const automationToggleLabel = automationPaused
        ? t('projects.actions.resumeAutomation')
        : t('projects.actions.pauseAutomation')
    const canToggleAutomation = Boolean(
        selected
        && !props.isLoading
        && !props.isAutomationTogglePending
        && props.onToggleGoalAutomationPause
    )
    const renderAutomationStatusTag = (goal: Goal, className?: string) => (
        <Tag
            size="xs"
            variant={getGoalAutomationStatusVariant(goal)}
            className={className}
        >
            {t(getGoalAutomationStatusKey(goal))}
        </Tag>
    )

    return (
        <div className="app-shadow-divider-b bg-[var(--app-bg)] px-3 py-2 sm:px-4 sm:py-3">
            <div
                data-testid="goal-switcher-toolbar"
                className="grid w-full min-w-0 gap-2 lg:grid-cols-[minmax(20rem,1fr)_auto_auto_auto] lg:items-center lg:gap-3"
            >
                <div
                    data-testid="goal-switcher-goal-row"
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:contents"
                >
                    <div data-testid="goal-switcher-current-goal" className="min-w-0">
                        <AdaptiveSelect
                            title={t('projects.goals.title')}
                            value={selected?.id ?? ''}
                            options={props.goals.map((goal) => ({
                                value: goal.id,
                                label: goal.title,
                                trailing: renderAutomationStatusTag(goal, 'shrink-0')
                            }))}
                            onValueChange={props.onSelectGoal}
                            disabled={props.goals.length === 0 || props.isLoading}
                            trigger={
                                <AdaptiveSelectTrigger
                                    type="button"
                                    className="h-10 bg-[var(--app-secondary-bg)] px-3 sm:h-11 sm:gap-3 sm:px-4"
                                >
                                    <span
                                        data-testid="goal-switcher-selected-summary"
                                        className="flex min-w-0 flex-1 items-center justify-start gap-2"
                                    >
                                        <span className="min-w-0 truncate text-left">{label}</span>
                                        {selected ? renderAutomationStatusTag(selected, 'shrink-0') : null}
                                    </span>
                                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                                </AdaptiveSelectTrigger>
                            }
                        />
                    </div>
                    <div data-testid="goal-switcher-actions" className="flex min-w-0 justify-end">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={props.onCreateGoal}
                            className="h-10 shrink-0 gap-2 rounded-lg bg-[var(--app-secondary-bg)] px-3 shadow-sm hover:opacity-100 sm:h-11 sm:px-4"
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
                {props.onToggleGoalAutomationPause ? (
                    <div data-testid="goal-switcher-automation" className="flex justify-end lg:justify-self-end">
                        <IconButton
                            type="button"
                            variant={automationPaused ? 'accent' : 'ghost'}
                            size="sm"
                            onClick={() => {
                                if (selected) {
                                    props.onToggleGoalAutomationPause?.(selected.id)
                                }
                            }}
                            disabled={!canToggleAutomation}
                            aria-label={automationToggleLabel}
                            title={automationToggleLabel}
                            className="shrink-0 bg-[var(--app-secondary-bg)] shadow-sm"
                        >
                            {props.isAutomationTogglePending ? (
                                <SpinnerIcon className="h-4 w-4 animate-spin" />
                            ) : automationPaused ? (
                                <PlayIcon className="h-4 w-4" />
                            ) : (
                                <PauseIcon className="h-4 w-4" />
                            )}
                        </IconButton>
                    </div>
                ) : null}
            </div>
        </div>
    )
}
