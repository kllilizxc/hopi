import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

export type ActionSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
    description?: string
    children: React.ReactNode
    contentClassName?: string
    containerClassName?: string
}

export function ActionSheet(props: ActionSheetProps) {
    const contentRef = React.useRef<HTMLDivElement | null>(null)
    const pointerIdRef = React.useRef<number | null>(null)
    const startYRef = React.useRef(0)
    const dragOffsetRef = React.useRef(0)
    const velocityRef = React.useRef(0)
    const lastClientYRef = React.useRef(0)
    const lastTimestampRef = React.useRef(0)
    const settleTimerRef = React.useRef<number | null>(null)

    const clearSettleTimer = React.useCallback(() => {
        if (settleTimerRef.current === null) {
            return
        }
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
    }, [])

    const clearDragStyles = React.useCallback(() => {
        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        contentEl.style.transform = ''
        contentEl.style.transition = ''
        contentEl.style.willChange = ''
    }, [])

    const updateDragOffset = React.useCallback((offset: number) => {
        dragOffsetRef.current = offset
        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        contentEl.style.transform = offset > 0 ? `translateY(${offset}px)` : ''
    }, [])

    const settleToRestPosition = React.useCallback(() => {
        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        clearSettleTimer()
        contentEl.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
        contentEl.style.transform = ''
        settleTimerRef.current = window.setTimeout(() => {
            clearDragStyles()
            settleTimerRef.current = null
        }, 200)
    }, [clearDragStyles, clearSettleTimer])

    const resetDragState = React.useCallback(() => {
        pointerIdRef.current = null
        startYRef.current = 0
        velocityRef.current = 0
        lastClientYRef.current = 0
        lastTimestampRef.current = 0
        dragOffsetRef.current = 0
    }, [])

    const handleDragPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch') {
            return
        }

        clearSettleTimer()
        pointerIdRef.current = event.pointerId
        startYRef.current = event.clientY - dragOffsetRef.current
        lastClientYRef.current = event.clientY
        lastTimestampRef.current = event.timeStamp
        velocityRef.current = 0
        event.currentTarget.setPointerCapture?.(event.pointerId)

        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        contentEl.style.transition = 'none'
        contentEl.style.willChange = 'transform'
    }, [clearSettleTimer])

    const handleDragPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return
        }

        const offset = Math.max(0, event.clientY - startYRef.current)
        updateDragOffset(offset)

        const deltaY = event.clientY - lastClientYRef.current
        const deltaTime = Math.max(1, event.timeStamp - lastTimestampRef.current)
        velocityRef.current = deltaY / deltaTime
        lastClientYRef.current = event.clientY
        lastTimestampRef.current = event.timeStamp

        if (offset > 0) {
            event.preventDefault()
        }
    }, [updateDragOffset])

    const finishDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>, cancelOnly = false) => {
        if (pointerIdRef.current !== event.pointerId) {
            return
        }

        event.currentTarget.releasePointerCapture?.(event.pointerId)

        const contentEl = contentRef.current
        const sheetHeight = contentEl?.getBoundingClientRect().height ?? 0
        const closeThreshold = sheetHeight > 0 ? Math.max(72, Math.min(180, sheetHeight * 0.28)) : 96
        const shouldClose = !cancelOnly && (dragOffsetRef.current >= closeThreshold || velocityRef.current > 0.9)

        if (shouldClose) {
            clearDragStyles()
            resetDragState()
            props.onOpenChange(false)
            return
        }

        settleToRestPosition()
        resetDragState()
    }, [clearDragStyles, props.onOpenChange, resetDragState, settleToRestPosition])

    React.useEffect(() => {
        if (props.open) {
            return
        }
        clearSettleTimer()
        clearDragStyles()
        resetDragState()
    }, [props.open, clearDragStyles, clearSettleTimer, resetDragState])

    React.useEffect(() => {
        return () => {
            clearSettleTimer()
        }
    }, [clearSettleTimer])

    return (
        <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <DialogPrimitive.Content
                    ref={contentRef}
                    className={cn(
                        'fixed inset-x-0 bottom-0 z-50 w-full max-h-[calc(var(--app-viewport-h)-12px)] overflow-y-auto rounded-t-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] shadow-2xl outline-none animate-slide-up motion-reduce:animate-none',
                        props.contentClassName
                    )}
                >
                    <div
                        className={cn(
                            'mx-auto w-full max-w-content px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)]',
                            props.containerClassName
                        )}
                    >
                        <div
                            className="mx-auto mb-2 h-6 w-16 touch-none flex items-center justify-center"
                            onPointerDown={handleDragPointerDown}
                            onPointerMove={handleDragPointerMove}
                            onPointerUp={finishDrag}
                            onPointerCancel={(event) => finishDrag(event, true)}
                            data-slot="action-sheet-handle"
                            aria-hidden="true"
                        >
                            <div
                                className="h-1.5 w-10 rounded-full bg-[var(--app-divider)] opacity-80"
                                aria-hidden="true"
                            />
                        </div>

                        {props.title ? (
                            <DialogPrimitive.Title className="px-1 text-base font-semibold text-[var(--app-fg)]">
                                {props.title}
                            </DialogPrimitive.Title>
                        ) : null}

                        {props.description ? (
                            <DialogPrimitive.Description className="mt-1 px-1 text-sm text-[var(--app-hint)]">
                                {props.description}
                            </DialogPrimitive.Description>
                        ) : null}

                        <div className={props.title || props.description ? 'mt-3' : 'mt-1'}>
                            {props.children}
                        </div>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

export type ActionSheetItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode
    destructive?: boolean
}

export const ActionSheetItem = React.forwardRef<HTMLButtonElement, ActionSheetItemProps>(
    ({ className, icon, destructive = false, children, ...props }, ref) => {
        const base =
            'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:pointer-events-none disabled:opacity-50'

        const tone = destructive
            ? 'text-red-500 hover:bg-red-500/10'
            : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'

        const iconTone = destructive ? 'text-red-500' : 'text-[var(--app-hint)]'

        return (
            <button ref={ref} type="button" className={cn(base, tone, className)} {...props}>
                {icon ? <span className={cn('shrink-0', iconTone)}>{icon}</span> : null}
                <span className="min-w-0 flex-1">{children}</span>
            </button>
        )
    }
)
ActionSheetItem.displayName = 'ActionSheetItem'
