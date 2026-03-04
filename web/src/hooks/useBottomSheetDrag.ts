import * as React from 'react'

const CLOSE_THRESHOLD_MIN = 72
const CLOSE_THRESHOLD_MAX = 180
const CLOSE_THRESHOLD_RATIO = 0.28
const CLOSE_THRESHOLD_FALLBACK = 96
const CLOSE_VELOCITY_THRESHOLD = 0.9
const SETTLE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
const SETTLE_TIMEOUT_MS = 200

type UseBottomSheetDragOptions<TElement extends HTMLElement> = {
    open: boolean
    contentRef: React.RefObject<TElement | null>
    onClose: () => void
}

type UseBottomSheetDragHandlers = {
    onPointerDown: React.PointerEventHandler<HTMLElement>
    onPointerMove: React.PointerEventHandler<HTMLElement>
    onPointerUp: React.PointerEventHandler<HTMLElement>
    onPointerCancel: React.PointerEventHandler<HTMLElement>
}

function getCloseThreshold(sheetHeight: number): number {
    if (sheetHeight <= 0) {
        return CLOSE_THRESHOLD_FALLBACK
    }
    return Math.max(CLOSE_THRESHOLD_MIN, Math.min(CLOSE_THRESHOLD_MAX, sheetHeight * CLOSE_THRESHOLD_RATIO))
}

export function useBottomSheetDrag<TElement extends HTMLElement>(
    options: UseBottomSheetDragOptions<TElement>
): UseBottomSheetDragHandlers {
    const { open, contentRef, onClose } = options
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
    }, [contentRef])

    const updateDragOffset = React.useCallback((offset: number) => {
        dragOffsetRef.current = offset
        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        contentEl.style.transform = offset > 0 ? `translateY(${offset}px)` : ''
    }, [contentRef])

    const settleToRestPosition = React.useCallback(() => {
        const contentEl = contentRef.current
        if (!contentEl) {
            return
        }
        clearSettleTimer()
        contentEl.style.transition = SETTLE_TRANSITION
        contentEl.style.transform = ''
        settleTimerRef.current = window.setTimeout(() => {
            clearDragStyles()
            settleTimerRef.current = null
        }, SETTLE_TIMEOUT_MS)
    }, [clearDragStyles, clearSettleTimer, contentRef])

    const resetDragState = React.useCallback(() => {
        pointerIdRef.current = null
        startYRef.current = 0
        velocityRef.current = 0
        lastClientYRef.current = 0
        lastTimestampRef.current = 0
        dragOffsetRef.current = 0
    }, [])

    const finishDrag = React.useCallback((event: React.PointerEvent<HTMLElement>, cancelOnly = false) => {
        if (pointerIdRef.current !== event.pointerId) {
            return
        }

        event.currentTarget.releasePointerCapture?.(event.pointerId)

        const sheetHeight = contentRef.current?.getBoundingClientRect().height ?? 0
        const closeThreshold = getCloseThreshold(sheetHeight)
        const shouldClose = !cancelOnly && (dragOffsetRef.current >= closeThreshold || velocityRef.current > CLOSE_VELOCITY_THRESHOLD)

        if (shouldClose) {
            clearDragStyles()
            resetDragState()
            onClose()
            return
        }

        settleToRestPosition()
        resetDragState()
    }, [clearDragStyles, contentRef, onClose, resetDragState, settleToRestPosition])

    const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
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
    }, [clearSettleTimer, contentRef])

    const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
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

    const onPointerUp = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
        finishDrag(event, false)
    }, [finishDrag])

    const onPointerCancel = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
        finishDrag(event, true)
    }, [finishDrag])

    React.useEffect(() => {
        if (open) {
            return
        }
        clearSettleTimer()
        clearDragStyles()
        resetDragState()
    }, [clearDragStyles, clearSettleTimer, open, resetDragState])

    React.useEffect(() => {
        return () => {
            clearSettleTimer()
        }
    }, [clearSettleTimer])

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel
    }
}
