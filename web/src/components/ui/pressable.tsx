import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

export type PressableProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean
}

/**
 * Pressable is a low-level clickable primitive for places where `Button`
 * styling/layout is too opinionated (rows, cards, etc.) but we still want
 * consistent focus + disabled behavior and avoid raw `<button>` usage.
 */
export const Pressable = React.forwardRef<HTMLButtonElement, PressableProps>(
    ({ className, asChild = false, type, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button'

        return (
            <Comp
                ref={ref}
                type={type ?? 'button'}
                className={cn(
                    'select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                    'disabled:pointer-events-none disabled:opacity-50',
                    className
                )}
                {...props}
            />
        )
    }
)
Pressable.displayName = 'Pressable'

