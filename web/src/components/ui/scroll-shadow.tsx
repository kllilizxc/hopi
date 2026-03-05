import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, MutableRefObject, Ref } from 'react'
import { cn } from '@/lib/utils'

type ScrollShadowStyle = CSSProperties & {
    '--scroll-shadow-color'?: string
}

export type ScrollShadowProps = HTMLAttributes<HTMLDivElement> & {
    shadowColor?: string
}

type ScrollShadowState = {
    top: boolean
    bottom: boolean
}

const SCROLL_EPSILON_PX = 1
const SHADOW_SIZE_PX = 14
const SHADOW_SPREAD_PX = -12

function setRefValue<T>(ref: Ref<T> | undefined, value: T): void {
    if (!ref) return
    if (typeof ref === 'function') {
        ref(value)
        return
    }
    ;(ref as MutableRefObject<T>).current = value
}

function computeScrollShadowState(el: HTMLDivElement): ScrollShadowState {
    const maxScrollTop = el.scrollHeight - el.clientHeight
    if (maxScrollTop <= SCROLL_EPSILON_PX) {
        return { top: false, bottom: false }
    }

    return {
        top: el.scrollTop > SCROLL_EPSILON_PX,
        bottom: el.scrollTop < maxScrollTop - SCROLL_EPSILON_PX
    }
}

export const ScrollShadow = forwardRef<HTMLDivElement, ScrollShadowProps>(function ScrollShadow(
    { className, style, shadowColor, children, ...rest },
    ref
) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const [shadowState, setShadowState] = useState<ScrollShadowState>({ top: false, bottom: false })

    const refreshShadowState = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const next = computeScrollShadowState(viewport)
        setShadowState((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }, [])

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

    const baseStyle = style as ScrollShadowStyle | undefined
    const dynamicShadow = [
        shadowState.top
            ? `inset 0 ${SHADOW_SIZE_PX}px ${SHADOW_SIZE_PX}px ${SHADOW_SPREAD_PX}px var(--scroll-shadow-color)`
            : '',
        shadowState.bottom
            ? `inset 0 -${SHADOW_SIZE_PX}px ${SHADOW_SIZE_PX}px ${SHADOW_SPREAD_PX}px var(--scroll-shadow-color)`
            : ''
    ].filter(Boolean).join(', ')
    const mergedBoxShadow = [baseStyle?.boxShadow, dynamicShadow].filter(Boolean).join(', ')
    const mergedStyle: ScrollShadowStyle = {
        '--scroll-shadow-color': shadowColor ?? 'var(--app-scroll-shadow)',
        ...baseStyle,
        boxShadow: mergedBoxShadow || undefined
    }

    return (
        <div
            ref={setViewportRef}
            className={cn('scroll-shadow-y', className)}
            style={mergedStyle}
            {...rest}
        >
            {children}
        </div>
    )
})

ScrollShadow.displayName = 'ScrollShadow'
