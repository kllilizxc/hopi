import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import { SettingsSelectRow } from './SettingsSelectRow'

describe('SettingsSelectRow', () => {
    it('uses the shared borderless select trigger styling', () => {
        renderWithProviders(
            <SettingsSelectRow
                title="Theme"
                label="Theme"
                value="system"
                valueLabel="System"
                options={[{ value: 'system', label: 'System' }]}
                onValueChange={vi.fn()}
            />
        )

        const trigger = screen.getByRole('button', { name: /Theme System/ })
        expect(trigger).not.toHaveClass('border')
        expect(trigger).toHaveClass('rounded-lg')
        expect(trigger).toHaveClass('focus:ring-2')
    })
})
