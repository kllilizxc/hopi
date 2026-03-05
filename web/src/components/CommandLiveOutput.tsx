import { useCallback, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const BOTTOM_THRESHOLD_PX = 16

export function CommandLiveOutput(props: {
    text: string
    emptyText?: string
    maxHeightClassName?: string
    className?: string
    autoFollow?: boolean
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const shouldStickToBottomRef = useRef(true)
    const autoFollow = props.autoFollow ?? true
    const text = props.text.length > 0 ? props.text : (props.emptyText ?? '')

    const handleScroll = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        shouldStickToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX
    }, [])

    useLayoutEffect(() => {
        if (!autoFollow || !shouldStickToBottomRef.current) {
            return
        }

        const viewport = viewportRef.current
        if (!viewport) {
            return
        }

        viewport.scrollTop = viewport.scrollHeight
    }, [autoFollow, text])

    return (
        <div className={cn('min-w-0 w-full max-w-full overflow-hidden rounded-md bg-[var(--app-code-bg)]', props.className)}>
            <div
                ref={viewportRef}
                onScroll={handleScroll}
                className={cn('overflow-y-auto', props.maxHeightClassName ?? 'max-h-56')}
            >
                <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
                    <pre className="m-0 w-max min-w-full p-2 text-xs font-mono whitespace-pre">{text}</pre>
                </div>
            </div>
        </div>
    )
}
