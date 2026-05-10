import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
    {
        variants: {
            variant: {
                default: 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]',
                warning: 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]',
                success: 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]',
                destructive: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
