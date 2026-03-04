import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect, type AdaptiveSelectMode } from '@/components/ui/AdaptiveSelect'
import type { ActionSheetSelectOption } from '@/components/ui/ActionSheetSelect'
import { cn } from '@/lib/utils'

export type AdaptiveSelectFieldSize = 'sm' | 'md'

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
                <button
                    type="button"
                    disabled={props.disabled}
                    className={cn(
                        'group flex w-full items-center justify-between gap-2 border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50',
                        size === 'sm' ? 'rounded-md px-2 py-2 text-sm' : 'rounded-lg px-3 py-3 text-sm',
                        props.triggerClassName
                    )}
                >
                    <span className={cn('min-w-0 flex-1 truncate text-left', label ? undefined : 'text-[var(--app-hint)]')}>
                        {label || props.title}
                    </span>
                    <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </button>
            }
        />
    )
}
