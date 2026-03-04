import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from '@/assets/icons'
import { cn } from '@/lib/utils'

export type CheckboxProps = Omit<
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
    'checked' | 'onCheckedChange'
> & {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
    ({ checked, onCheckedChange, className, ...props }, ref) => {
        return (
            <CheckboxPrimitive.Root
                ref={ref}
                checked={checked}
                onCheckedChange={(next) => onCheckedChange(next === true)}
                className={cn(
                    'h-5 w-5 shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] shadow-sm outline-none transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                    'data-[state=checked]:border-[var(--app-link)] data-[state=checked]:bg-[var(--app-link)]',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    className
                )}
                {...props}
            >
                <CheckboxPrimitive.Indicator className="flex items-center justify-center text-[var(--app-bg)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                </CheckboxPrimitive.Indicator>
            </CheckboxPrimitive.Root>
        )
    }
)
Checkbox.displayName = 'Checkbox'

