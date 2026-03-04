import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { CheckIcon } from '@/assets/icons'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'
import { ActionSheetSelect, type ActionSheetSelectOption } from '@/components/ui/ActionSheetSelect'

export type AdaptiveSelectMode = 'auto' | 'sheet' | 'dropdown'

export type AdaptiveSelectProps<TValue extends string | number | null> = {
    title: string
    description?: string
    value: TValue
    options: ActionSheetSelectOption<TValue>[]
    onValueChange: (value: TValue) => void
    trigger: React.ReactElement<any>
    disabled?: boolean
    mode?: AdaptiveSelectMode
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    dropdownContentClassName?: string
    sheetContentClassName?: string
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function AdaptiveSelect<TValue extends string | number | null>(props: AdaptiveSelectProps<TValue>) {
    const { isTouch } = usePlatform()
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const open = props.open ?? uncontrolledOpen
    const setOpen = props.onOpenChange ?? setUncontrolledOpen

    const mode = props.mode ?? 'auto'
    const useSheet = mode === 'sheet' || (mode === 'auto' && isTouch)

    if (useSheet) {
        const trigger = React.cloneElement(props.trigger, {
            onClick: (event: React.MouseEvent) => {
                props.trigger.props.onClick?.(event)
                setOpen(true)
            },
            disabled: props.disabled ?? props.trigger.props.disabled,
            'aria-expanded': open,
            'aria-haspopup': 'dialog',
            'data-state': open ? 'open' : 'closed',
        })

        return (
            <>
                {trigger}
                <ActionSheetSelect
                    open={open}
                    onOpenChange={setOpen}
                    title={props.title}
                    description={props.description}
                    value={props.value}
                    options={props.options}
                    onValueChange={props.onValueChange}
                    contentClassName={props.sheetContentClassName}
                />
            </>
        )
    }

    return (
        <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
            <DropdownMenuPrimitive.Trigger asChild disabled={props.disabled}>
                {props.trigger}
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                    sideOffset={props.sideOffset ?? 8}
                    align={props.align ?? 'start'}
                    className={cn(
                        'z-50 min-w-[200px] max-h-[min(60vh,420px)] overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1 shadow-2xl outline-none',
                        'animate-menu-pop motion-reduce:animate-none',
                        props.dropdownContentClassName
                    )}
                >
                    {props.options.map((opt) => {
                        const isSelected = Object.is(opt.value, props.value)
                        const key = opt.value === null ? 'null' : String(opt.value)
                        const enabledTone = opt.destructive
                            ? 'text-red-500 hover:bg-red-500/10 focus:bg-red-500/10'
                            : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] focus:bg-[var(--app-subtle-bg)]'

                        return (
                            <DropdownMenuPrimitive.Item
                                key={key}
                                disabled={opt.disabled}
                                onSelect={() => props.onValueChange(opt.value)}
                                className={cn(
                                    'flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm outline-none',
                                    opt.disabled
                                        ? 'opacity-50'
                                        : enabledTone,
                                    isSelected ? 'bg-[var(--app-subtle-bg)]' : undefined
                                )}
                            >
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                    {opt.icon ? (
                                        <span
                                            className={cn(
                                                'shrink-0',
                                                opt.destructive ? 'text-red-500' : 'text-[var(--app-hint)]'
                                            )}
                                            aria-hidden="true"
                                        >
                                            {opt.icon}
                                        </span>
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                                </span>
                                {isSelected ? (
                                    <span className="shrink-0 text-[var(--app-link)]" aria-hidden="true">
                                        <CheckIcon className="h-4 w-4" />
                                    </span>
                                ) : null}
                            </DropdownMenuPrimitive.Item>
                        )
                    })}
                </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
    )
}
