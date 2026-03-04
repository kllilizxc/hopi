import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import { ActionSheet, ActionSheetItem } from '@/components/ui/ActionSheet'

type PointerGestureType = 'down' | 'move' | 'up' | 'cancel'
type PointerGestureInit = {
    pointerId: number
    pointerType: 'touch' | 'mouse' | 'pen'
    clientY: number
}

function fireGesturePointerEvent(target: HTMLElement, type: PointerGestureType, init: PointerGestureInit) {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true })
    Object.assign(event, {
        pointerId: init.pointerId,
        pointerType: init.pointerType,
        clientY: init.clientY,
    })
    fireEvent(target, event)
}

function getActionSheetHandle() {
    const dialog = screen.getByRole('dialog')
    const handle = dialog.querySelector('[data-slot="action-sheet-handle"]')
    expect(handle).not.toBeNull()

    if (!(handle instanceof HTMLElement)) {
        throw new Error('ActionSheet drag handle not found')
    }

    return { dialog, handle }
}

describe('ActionSheet', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('does not render content when closed', () => {
        renderWithProviders(
            <ActionSheet open={false} onOpenChange={() => {}} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        expect(screen.queryByText('Actions')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    })

    it('renders title and children when open', () => {
        renderWithProviders(
            <ActionSheet open onOpenChange={() => {}} title="Actions" description="Pick one">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        expect(screen.getByText('Actions')).toBeInTheDocument()
        expect(screen.getByText('Pick one')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()

        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveClass('motion-reduce:animate-none')
    })

    it('fires item click handler', () => {
        const onClick = vi.fn()
        renderWithProviders(
            <ActionSheet open onOpenChange={() => {}} title="Actions">
                <ActionSheetItem onClick={onClick}>Delete</ActionSheetItem>
            </ActionSheet>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('closes when dragging handle down past threshold', () => {
        const onOpenChange = vi.fn()
        renderWithProviders(
            <ActionSheet open onOpenChange={onOpenChange} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        const { handle } = getActionSheetHandle()

        fireGesturePointerEvent(handle, 'down', { pointerId: 1, pointerType: 'touch', clientY: 100 })
        fireGesturePointerEvent(handle, 'move', { pointerId: 1, pointerType: 'touch', clientY: 260 })
        fireGesturePointerEvent(handle, 'up', { pointerId: 1, pointerType: 'touch', clientY: 260 })

        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('follows touch drag while moving handle', () => {
        renderWithProviders(
            <ActionSheet open onOpenChange={() => {}} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        const { dialog, handle } = getActionSheetHandle()

        fireGesturePointerEvent(handle, 'down', { pointerId: 4, pointerType: 'touch', clientY: 100 })
        fireGesturePointerEvent(handle, 'move', { pointerId: 4, pointerType: 'touch', clientY: 155 })

        expect(dialog.style.transform).toBe('translateY(55px)')
    })

    it('snaps back when dragging handle down only a little', () => {
        vi.useFakeTimers()
        const onOpenChange = vi.fn()
        renderWithProviders(
            <ActionSheet open onOpenChange={onOpenChange} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        const { dialog, handle } = getActionSheetHandle()

        fireGesturePointerEvent(handle, 'down', { pointerId: 2, pointerType: 'touch', clientY: 100 })
        fireGesturePointerEvent(handle, 'move', { pointerId: 2, pointerType: 'touch', clientY: 130 })
        fireGesturePointerEvent(handle, 'move', { pointerId: 2, pointerType: 'touch', clientY: 130 })
        fireGesturePointerEvent(handle, 'up', { pointerId: 2, pointerType: 'touch', clientY: 130 })

        expect(onOpenChange).not.toHaveBeenCalledWith(false)
        expect(dialog.style.transition).toBe('transform 180ms cubic-bezier(0.22, 1, 0.36, 1)')
        expect(dialog.style.transform).toBe('')

        vi.advanceTimersByTime(220)

        expect(dialog.style.transition).toBe('')
        expect(dialog.style.willChange).toBe('')
    })

    it('ignores mouse pointer drags', () => {
        const onOpenChange = vi.fn()
        renderWithProviders(
            <ActionSheet open onOpenChange={onOpenChange} title="Actions">
                <ActionSheetItem>Delete</ActionSheetItem>
            </ActionSheet>
        )

        const { dialog, handle } = getActionSheetHandle()

        fireGesturePointerEvent(handle, 'down', { pointerId: 3, pointerType: 'mouse', clientY: 100 })
        fireGesturePointerEvent(handle, 'move', { pointerId: 3, pointerType: 'mouse', clientY: 260 })
        fireGesturePointerEvent(handle, 'up', { pointerId: 3, pointerType: 'mouse', clientY: 260 })

        expect(onOpenChange).not.toHaveBeenCalledWith(false)
        expect(dialog.style.transform).toBe('')
    })
})
