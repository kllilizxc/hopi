import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, MutableRefObject, Ref } from 'react'
import { cn } from '@/lib/utils'

type ScrollShadowStyle = CSSProperties & {
    '--scroll-shadow-size'?: string
    '--scroll-shadow-offset'?: string
}

export type ScrollShadowProps = HTMLAttributes<HTMLDivElement> & {
    size?: number
    offset?: number
    orientation?: 'vertical' | 'horizontal'
    hideScrollBar?: boolean
    viewportClassName?: string
    viewportStyle?: CSSProperties
}

type ScrollShadowState = {
    top: boolean
    bottom: boolean
    left: boolean
    right: boolean
}

const SCROLL_EPSILON_PX = 1

function setRefValue<T>(ref: Ref<T> | undefined, value: T): void {
    if (!ref) return
    if (typeof ref === 'function') {
        ref(value)
        return
    }
    ;(ref as MutableRefObject<T>).current = value
}

function computeScrollShadowState(el: HTMLDivElement, orientation: 'vertical' | 'horizontal'): ScrollShadowState {
    if (orientation === 'horizontal') {
        const maxScrollLeft = el.scrollWidth - el.clientWidth
        if (maxScrollLeft <= SCROLL_EPSILON_PX) {
            return { top: false, bottom: false, left: false, right: false }
        }
        return {
            top: false,
            bottom: false,
            left: el.scrollLeft > SCROLL_EPSILON_PX,
            right: el.scrollLeft < maxScrollLeft - SCROLL_EPSILON_PX
        }
    }

    const maxScrollTop = el.scrollHeight - el.clientHeight
    if (maxScrollTop <= SCROLL_EPSILON_PX) {
        return { top: false, bottom: false, left: false, right: false }
    }

    return {
        top: el.scrollTop > SCROLL_EPSILON_PX,
        bottom: el.scrollTop < maxScrollTop - SCROLL_EPSILON_PX,
        left: false,
        right: false
    }
}

export const ScrollShadow = forwardRef<HTMLDivElement, ScrollShadowProps>(function ScrollShadow(
    {
        className,
        style,
        size = 32,
        offset = 0,
        orientation = 'vertical',
        hideScrollBar = false,
        viewportClassName,
        viewportStyle,
        children,
        ...rest
    },
    ref
) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const [shadowState, setShadowState] = useState<ScrollShadowState>({
        top: false,
        bottom: false,
        left: false,
        right: false
    })

    const refreshShadowState = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const next = computeScrollShadowState(viewport, orientation)
        setShadowState((prev) => (
            prev.top === next.top &&
            prev.bottom === next.bottom &&
            prev.left === next.left &&
            prev.right === next.right
                ? prev
                : next
        ))
    }, [orientation])

    const setViewportRef = useCallback((node: HTMLDivElement | null) => {
        viewportRef.current = node
        setRefValue(ref, node)
    }, [ref])

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        let rafId: number | null = null
        const scheduleRefresh = () => {
            if (rafId !== null) return
            rafId = requestAnimationFrame(() => {
                rafId = null
                refreshShadowState()
            })
        }

        scheduleRefresh()
        viewport.addEventListener('scroll', scheduleRefresh, { passive: true })

        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => {
                scheduleRefresh()
            })

        if (resizeObserver) {
            resizeObserver.observe(viewport)
            if (viewport.firstElementChild instanceof HTMLElement) {
                resizeObserver.observe(viewport.firstElementChild)
            }
        }

        return () => {
            viewport.removeEventListener('scroll', scheduleRefresh)
            resizeObserver?.disconnect()
            if (rafId !== null) {
                cancelAnimationFrame(rafId)
            }
        }
    }, [refreshShadowState])

    useLayoutEffect(() => {
        refreshShadowState()
    }, [children, refreshShadowState])

    const mergedStyle: ScrollShadowStyle = {
        '--scroll-shadow-size': `${size}px`,
        '--scroll-shadow-offset': `${offset}px`,
        ...style
    }

    return (
        <div
            className={cn(
                'scroll-shadow',
                className
            )}
            style={mergedStyle}
            data-orientation={orientation}
            data-top-shadow={shadowState.top ? 'visible' : 'hidden'}
            data-bottom-shadow={shadowState.bottom ? 'visible' : 'hidden'}
            data-left-shadow={shadowState.left ? 'visible' : 'hidden'}
            data-right-shadow={shadowState.right ? 'visible' : 'hidden'}
        >
            <div
                ref={setViewportRef}
                className={cn(
                    'scroll-shadow-viewport',
                    orientation === 'vertical' ? 'scroll-shadow-vertical' : 'scroll-shadow-horizontal',
                    hideScrollBar && 'scroll-shadow-hide-scrollbar',
                    viewportClassName
                )}
                style={viewportStyle}
                {...rest}
            >
                {children}
            </div>
        </div>
    )
})

ScrollShadow.displayName = 'ScrollShadow'
