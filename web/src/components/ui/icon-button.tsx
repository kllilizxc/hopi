import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
    'inline-flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                ghost: 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]',
                subtle: 'text-[var(--app-fg)]/60 hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                accent: 'text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)]',
                danger: 'text-[var(--app-fg)]/60 hover:bg-[var(--app-subtle-bg)] hover:text-red-500',
            },
            size: {
                xs: 'h-8 w-8',
                sm: 'h-10 w-10',
                md: 'h-11 w-11',
            },
        },
        defaultVariants: {
            variant: 'ghost',
            size: 'md',
        },
    }
)

export interface IconButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof iconButtonVariants> {
    asChild?: boolean
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button'
        return (
            <Comp
                className={cn(iconButtonVariants({ variant, size }), className)}
                ref={ref}
                {...props}
            />
        )
    }
)
IconButton.displayName = 'IconButton'
