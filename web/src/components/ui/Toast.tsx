import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toastVariants = cva(
    'pointer-events-auto w-full max-w-sm rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-lg',
    {
        variants: {
            variant: {
                default: 'border-[var(--app-border)] bg-[var(--app-bg)]'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

export type ToastProps = React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof toastVariants> & {
    title: string
    body: string
    onClose?: () => void
}

export function Toast({ title, body, onClose, className, variant, ...props }: ToastProps) {
    const closedFromPointerRef = React.useRef(false)

    const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        event.preventDefault()

        if (closedFromPointerRef.current) {
            closedFromPointerRef.current = false
            return
        }

        onClose?.()
    }

    const handleClosePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation()

        if (event.pointerType === 'mouse') {
            return
        }

        event.preventDefault()
        closedFromPointerRef.current = true
        onClose?.()
    }

    return (
        <div className={cn(toastVariants({ variant }), className)} role="status" {...props}>
            <div className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-5">{title}</div>
                    <div className="mt-1 text-xs text-[var(--app-hint)]">{body}</div>
                </div>
                {onClose ? (
                    <button
                        type="button"
                        className="-m-2 inline-flex h-7 w-7 touch-manipulation items-center justify-center rounded text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                        onClick={handleCloseClick}
                        onPointerDown={handleClosePointerDown}
                        aria-label="Dismiss"
                    >
                        x
                    </button>
                ) : null}
            </div>
        </div>
    )
}
