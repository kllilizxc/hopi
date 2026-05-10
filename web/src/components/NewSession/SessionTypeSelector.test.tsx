import { createRef } from 'react'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { SessionTypeSelector } from './SessionTypeSelector'

describe('SessionTypeSelector', () => {
    it('uses shared borderless compact tabs for session type selection', () => {
        renderWithProviders(
            <SessionTypeSelector
                sessionType="simple"
                worktreeName=""
                worktreeInputRef={createRef<HTMLInputElement>()}
                isDisabled={false}
                onSessionTypeChange={vi.fn()}
                onWorktreeNameChange={vi.fn()}
            />
        )

        const tablist = screen.getByRole('tablist', { name: 'Session type' })
        const selectedTab = screen.getByRole('tab', { name: 'Simple' })
        expect(tablist).not.toHaveClass('border')
        expect(selectedTab).not.toHaveClass('border')
    })
})
