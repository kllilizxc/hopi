import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Tag } from './tag'

describe('Tag', () => {
    it('renders without a border by default', () => {
        renderWithProviders(<Tag>Status</Tag>)

        expect(screen.getByText('Status')).not.toHaveClass('border')
        expect(screen.getByText('Status')).not.toHaveClass('app-shadow-border')
    })

    it('uses a shadow outline when a caller opts in', () => {
        renderWithProviders(<Tag bordered>Status</Tag>)

        expect(screen.getByText('Status')).toHaveClass('app-shadow-border')
    })

    it('applies tag classes to the child element when rendered asChild', () => {
        renderWithProviders(
            <Tag asChild>
                <button type="button">Recent path</button>
            </Tag>
        )

        expect(screen.getByRole('button', { name: 'Recent path' })).toHaveClass('inline-flex')
    })
})
