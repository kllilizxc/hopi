import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect, type AdaptiveSelectMode } from '@/components/ui/AdaptiveSelect'
import { AdaptiveSelectTrigger, type AdaptiveSelectTriggerSize } from '@/components/ui/AdaptiveSelectTrigger'
import type { ActionSheetSelectOption } from '@/components/ui/ActionSheetSelect'
import { cn } from '@/lib/utils'

export type AdaptiveSelectFieldSize = AdaptiveSelectTriggerSize

export type AdaptiveSelectFieldProps<TValue extends string | number | null> = {
    title: string
    description?: string
    value: TValue
    options: ActionSheetSelectOption<TValue>[]
    onValueChange: (value: TValue) => void
    disabled?: boolean
    mode?: AdaptiveSelectMode
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    dropdownContentClassName?: string
    sheetContentClassName?: string
    placeholder?: string
    size?: AdaptiveSelectFieldSize
    triggerClassName?: string
}

export function AdaptiveSelectField<TValue extends string | number | null>(props: AdaptiveSelectFieldProps<TValue>) {
    const selected = props.options.find((opt) => Object.is(opt.value, props.value))
    const label = selected?.label ?? props.placeholder ?? ''
    const size = props.size ?? 'md'

    return (
        <AdaptiveSelect
            title={props.title}
            description={props.description}
            value={props.value}
            options={props.options}
            onValueChange={props.onValueChange}
            disabled={props.disabled}
            mode={props.mode}
            align={props.align}
            sideOffset={props.sideOffset}
            dropdownContentClassName={props.dropdownContentClassName}
            sheetContentClassName={props.sheetContentClassName}
            trigger={
                <AdaptiveSelectTrigger
                    disabled={props.disabled}
                    size={size}
                    className={props.triggerClassName}
                >
                    <span className={cn('min-w-0 flex-1 truncate text-left', label ? undefined : 'text-[var(--app-hint)]')}>
                        {label || props.title}
                    </span>
                    <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </AdaptiveSelectTrigger>
            }
        />
    )
}
