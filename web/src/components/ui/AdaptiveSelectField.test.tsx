import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdaptiveSelectField } from './AdaptiveSelectField'

describe('AdaptiveSelectField', () => {
    it('renders a shadow-bounded select trigger by default', () => {
        renderWithProviders(
            <AdaptiveSelectField
                title="Mode"
                value="auto"
                options={[{ value: 'auto', label: 'Auto' }]}
                onValueChange={vi.fn()}
                mode="dropdown"
            />
        )

        const trigger = screen.getByRole('button', { name: 'Auto' })
        expect(trigger).not.toHaveClass('border')
        expect(trigger).not.toHaveClass('app-shadow-border')
        expect(trigger).toHaveClass('app-shadow-control')
    })

    it('renders a shadow-bounded dropdown menu by default', async () => {
        renderWithProviders(
            <AdaptiveSelectField
                title="Mode"
                value="auto"
                options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'manual', label: 'Manual' }
                ]}
                onValueChange={vi.fn()}
                mode="dropdown"
            />
        )

        fireEvent.keyDown(screen.getByRole('button', { name: 'Auto' }), {
            key: 'ArrowDown'
        })

        const menu = await screen.findByRole('menu')
        expect(menu).not.toHaveClass('border')
        expect(menu).toHaveClass('app-shadow-popover')
    })
})
