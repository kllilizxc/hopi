import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toastVariants = cva(
    'pointer-events-auto relative w-full max-w-[28rem] overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-xl ring-1 ring-[var(--app-border)] backdrop-blur-sm',
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
    const closeTimerRef = React.useRef<number | null>(null)
    const closeRequestedRef = React.useRef(false)

    React.useEffect(() => {
        return () => {
            if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current)
            }
        }
    }, [])

    const requestClose = React.useCallback(() => {
        if (closeRequestedRef.current) {
            return
        }

        closeRequestedRef.current = true
        // Let the active pointer/click sequence finish before unmounting the toast.
        closeTimerRef.current = window.setTimeout(() => {
            onClose?.()
        }, 80)
    }, [onClose])

    const suppressNextActivation = React.useCallback(() => {
        const suppress = (nativeEvent: Event) => {
            nativeEvent.preventDefault()
            nativeEvent.stopPropagation()
            cleanup()
        }

        const cleanup = () => {
            window.removeEventListener('click', suppress, true)
            window.removeEventListener('pointerup', suppress, true)
            window.removeEventListener('mouseup', suppress, true)
            window.removeEventListener('touchend', suppress, true)
        }

        window.addEventListener('click', suppress, true)
        window.addEventListener('pointerup', suppress, true)
        window.addEventListener('mouseup', suppress, true)
        window.addEventListener('touchend', suppress, true)
        window.setTimeout(cleanup, 300)
    }, [])

    const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        event.preventDefault()

        if (closedFromPointerRef.current) {
            closedFromPointerRef.current = false
            return
        }

        requestClose()
    }

    const handleClosePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation()

        if (event.pointerType === 'mouse') {
            return
        }

        event.preventDefault()
        closedFromPointerRef.current = true
        suppressNextActivation()
        requestClose()
    }

    return (
        <div className={cn(toastVariants({ variant }), className)} role="status" {...props}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[var(--app-link)] via-[var(--app-button)] to-[var(--app-link)]" />
            <div className="flex items-start gap-3 p-4 pt-5">
                <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-sm font-semibold text-[var(--app-link)]">
                    !
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold leading-5 tracking-[0.01em]">{title}</div>
                    <div className="mt-1.5 text-sm leading-5 text-[var(--app-hint)]">{body}</div>
                </div>
                {onClose ? (
                    <button
                        type="button"
                        className="-m-1 inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-sm text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
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
