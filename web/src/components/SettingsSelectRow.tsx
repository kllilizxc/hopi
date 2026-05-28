import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { AdaptiveSelectTrigger } from '@/components/ui/AdaptiveSelectTrigger'
import type { ActionSheetSelectOption } from '@/components/ui/ActionSheetSelect'

export function SettingsSelectRow<TValue extends string | number | null>(props: {
    title: string
    label: string
    value: TValue
    valueLabel: string
    options: ActionSheetSelectOption<TValue>[]
    onValueChange: (value: TValue) => void
    disabled?: boolean
}) {
    return (
        <AdaptiveSelect
            title={props.title}
            value={props.value}
            options={props.options}
            onValueChange={props.onValueChange}
            align="end"
            disabled={props.disabled}
            trigger={(
                <AdaptiveSelectTrigger
                    disabled={props.disabled}
                >
                    <span className="text-[var(--app-fg)]">{props.label}</span>
                    <span className="flex items-center gap-1 text-[var(--app-hint)]">
                        <span>{props.valueLabel}</span>
                        <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
                    </span>
                </AdaptiveSelectTrigger>
            )}
        />
    )
}
