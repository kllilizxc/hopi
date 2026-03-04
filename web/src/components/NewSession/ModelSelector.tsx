import type { AgentType } from './types'
import { MODEL_OPTIONS } from './types'
import { useTranslation } from '@/lib/use-translation'
import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const options = MODEL_OPTIONS[props.agent]
    if (options.length === 0) {
        return null
    }

    const selectedLabel = options.find((opt) => opt.value === props.model)?.label ?? props.model

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.model')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <AdaptiveSelect
                title={t('newSession.model')}
                value={props.model}
                options={options}
                onValueChange={(nextModel) => props.onModelChange(nextModel)}
                disabled={props.isDisabled}
                align="start"
                trigger={
                    <button
                        type="button"
                        disabled={props.isDisabled}
                        className="group flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
                        <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </button>
                }
            />
        </div>
    )
}

