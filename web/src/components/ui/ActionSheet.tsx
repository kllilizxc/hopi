import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag'
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
    const handleDrag = useBottomSheetDrag({
        open: props.open,
        contentRef,
        onClose: () => props.onOpenChange(false)
    })

    return (
        <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <DialogPrimitive.Content
                    ref={contentRef}
                    className={cn(
                        'fixed inset-x-0 bottom-0 z-50 w-full max-h-[calc(var(--app-viewport-h)-12px)] overflow-y-auto rounded-t-2xl bg-[var(--app-secondary-bg)] shadow-2xl outline-none animate-slide-up motion-reduce:animate-none',
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
                            className="mb-2 flex h-8 w-full touch-none items-center justify-center"
                            onPointerDown={handleDrag.onPointerDown}
                            onPointerMove={handleDrag.onPointerMove}
                            onPointerUp={handleDrag.onPointerUp}
                            onPointerCancel={handleDrag.onPointerCancel}
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
