import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const tagVariants = cva(
    'inline-flex items-center font-medium transition-colors',
    {
        variants: {
            variant: {
                default: 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)]',
                warning: 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]',
                success: 'border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]',
                error: 'border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]',
                primary: 'border-[var(--app-link)] bg-[var(--app-link)] text-white opacity-80',
                secondary: 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
            },
            size: {
                xs: 'text-[10px] px-2 py-0.5',
                sm: 'text-xs px-2.5 py-0.5',
                md: 'text-xs px-3 py-1',
                lg: 'text-xs px-3 py-1.5'
            },
            shape: {
                rounded: 'rounded',
                pill: 'rounded-full'
            },
            bordered: {
                true: 'border',
                false: 'border-0'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'sm',
            shape: 'pill',
            bordered: true
        }
    }
)

export interface TagProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof tagVariants> {
    asChild?: boolean
}

export function Tag({ className, variant, size, shape, bordered, asChild, ...props }: TagProps) {
    const Comp = asChild ? React.Fragment : 'span'
    return (
        <Comp
            className={cn(tagVariants({ variant, size, shape, bordered }), className)}
            {...props}
        />
    )
}
