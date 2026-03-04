import * as React from 'react'
import { CheckIcon } from '@/assets/icons'
import { cn } from '@/lib/utils'
import { ActionSheet, ActionSheetItem } from '@/components/ui/ActionSheet'

export type ActionSheetSelectOption<TValue extends string | number | null> = {
    value: TValue
    label: string
    disabled?: boolean
    icon?: React.ReactNode
    destructive?: boolean
}

export type ActionSheetSelectProps<TValue extends string | number | null> = {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    value: TValue
    options: ActionSheetSelectOption<TValue>[]
    onValueChange: (value: TValue) => void
    contentClassName?: string
}

export function ActionSheetSelect<TValue extends string | number | null>(props: ActionSheetSelectProps<TValue>) {
    return (
        <ActionSheet
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={props.title}
            description={props.description}
            contentClassName={props.contentClassName}
        >
            <div className="flex flex-col gap-1">
                {props.options.map((opt) => {
                    const isSelected = Object.is(opt.value, props.value)
                    const key = opt.value === null ? 'null' : opt.value

                    return (
                        <ActionSheetItem
                            key={key}
                            icon={opt.icon}
                            destructive={opt.destructive}
                            disabled={opt.disabled}
                            onClick={() => {
                                if (opt.disabled) return
                                props.onValueChange(opt.value)
                                props.onOpenChange(false)
                            }}
                            className={cn(isSelected ? 'bg-[var(--app-subtle-bg)]' : undefined)}
                        >
                            <span className="flex w-full items-center justify-between gap-3">
                                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                                {isSelected ? (
                                    <span className="shrink-0 text-[var(--app-link)]" aria-hidden="true">
                                        <CheckIcon />
                                    </span>
                                ) : null}
                            </span>
                        </ActionSheetItem>
                    )
                })}
            </div>
        </ActionSheet>
    )
}
