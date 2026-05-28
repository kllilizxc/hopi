import type * as React from 'react'
import { cn } from '@/lib/utils'

export type AdaptiveSelectTriggerSize = 'sm' | 'md'

export type AdaptiveSelectTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: AdaptiveSelectTriggerSize
}

export function AdaptiveSelectTrigger({
    className,
    size = 'md',
    type = 'button',
    ...props
}: AdaptiveSelectTriggerProps) {
    return (
        <button
            type={type}
            className={cn(
                'group flex w-full items-center justify-between gap-2 app-shadow-control bg-[var(--app-bg)] text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50',
                size === 'sm' ? 'rounded-md px-2 py-2 text-sm' : 'rounded-lg px-3 py-3 text-sm',
                className
            )}
            {...props}
        />
    )
}
