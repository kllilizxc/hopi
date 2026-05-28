import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScrollShadow } from '@/components/ui/scroll-shadow'
import { renderWithProviders } from '@/test/renderWithProviders'

function setViewportMetrics(
    element: HTMLElement,
    metrics: Partial<Record<'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollLeft' | 'scrollTop' | 'scrollWidth', number>>
): void {
    for (const [key, value] of Object.entries(metrics)) {
        Object.defineProperty(element, key, {
            configurable: true,
            writable: true,
            value
        })
    }
}

function getWrapper(element: HTMLElement): HTMLDivElement {
    const wrapper = element.parentElement
    expect(wrapper).not.toBeNull()

    if (!(wrapper instanceof HTMLDivElement)) {
        throw new Error('ScrollShadow wrapper not found')
    }

    return wrapper
}

describe('ScrollShadow', () => {
    it('toggles vertical image-mask overlays from scroll position', async () => {
        const { container } = renderWithProviders(
            <ScrollShadow data-testid="scroll-shadow-viewport">
                <div style={{ height: 480 }}>content</div>
            </ScrollShadow>
        )

        const viewport = screen.getByTestId('scroll-shadow-viewport')
        const wrapper = getWrapper(viewport)
        const topMask = container.querySelector('.scroll-shadow-mask-top')
        const bottomMask = container.querySelector('.scroll-shadow-mask-bottom')

        expect(topMask).not.toBeNull()
        expect(bottomMask).not.toBeNull()

        setViewportMetrics(viewport, {
            clientHeight: 120,
            scrollHeight: 480,
            scrollTop: 0
        })

        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-top-shadow', 'hidden')
            expect(wrapper).toHaveAttribute('data-bottom-shadow', 'visible')
            expect(topMask).toHaveAttribute('data-visible', 'hidden')
            expect(bottomMask).toHaveAttribute('data-visible', 'visible')
        })

        viewport.scrollTop = 180
        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-top-shadow', 'visible')
            expect(wrapper).toHaveAttribute('data-bottom-shadow', 'visible')
            expect(topMask).toHaveAttribute('data-visible', 'visible')
            expect(bottomMask).toHaveAttribute('data-visible', 'visible')
        })

        viewport.scrollTop = 360
        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-top-shadow', 'visible')
            expect(wrapper).toHaveAttribute('data-bottom-shadow', 'hidden')
            expect(topMask).toHaveAttribute('data-visible', 'visible')
            expect(bottomMask).toHaveAttribute('data-visible', 'hidden')
        })
    })

    it('toggles horizontal image-mask overlays from scroll position', async () => {
        const { container } = renderWithProviders(
            <ScrollShadow data-testid="scroll-shadow-viewport" orientation="horizontal">
                <div style={{ width: 360, height: 48 }}>content</div>
            </ScrollShadow>
        )

        const viewport = screen.getByTestId('scroll-shadow-viewport')
        const wrapper = getWrapper(viewport)
        const leftMask = container.querySelector('.scroll-shadow-mask-left')
        const rightMask = container.querySelector('.scroll-shadow-mask-right')

        expect(leftMask).not.toBeNull()
        expect(rightMask).not.toBeNull()

        setViewportMetrics(viewport, {
            clientWidth: 120,
            scrollWidth: 360,
            scrollLeft: 0
        })

        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-left-shadow', 'hidden')
            expect(wrapper).toHaveAttribute('data-right-shadow', 'visible')
            expect(leftMask).toHaveAttribute('data-visible', 'hidden')
            expect(rightMask).toHaveAttribute('data-visible', 'visible')
        })

        viewport.scrollLeft = 140
        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-left-shadow', 'visible')
            expect(wrapper).toHaveAttribute('data-right-shadow', 'visible')
            expect(leftMask).toHaveAttribute('data-visible', 'visible')
            expect(rightMask).toHaveAttribute('data-visible', 'visible')
        })

        viewport.scrollLeft = 240
        fireEvent.scroll(viewport)

        await waitFor(() => {
            expect(wrapper).toHaveAttribute('data-left-shadow', 'visible')
            expect(wrapper).toHaveAttribute('data-right-shadow', 'hidden')
            expect(leftMask).toHaveAttribute('data-visible', 'visible')
            expect(rightMask).toHaveAttribute('data-visible', 'hidden')
        })
    })
})
