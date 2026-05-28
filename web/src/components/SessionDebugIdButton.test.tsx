import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionDebugIdButton } from './SessionDebugIdButton'

const copyMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: copyMock
    })
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}))

describe('SessionDebugIdButton', () => {
    it('renders and copies the session debug id', () => {
        copyMock.mockResolvedValue(true)
        render(<SessionDebugIdButton debugId="S-1234abcd" />)

        const button = screen.getByRole('button', { name: 'session.debugId.copy' })
        expect(button.textContent).toContain('S-1234abcd')

        fireEvent.click(button)

        expect(copyMock).toHaveBeenCalledWith('S-1234abcd')
    })
})
