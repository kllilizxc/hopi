import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/api/client'
import { renderWithProviders } from '@/test/renderWithProviders'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'

function VisibilityReporterHarness(props: {
    api: ApiClient | null
    subscriptionId: string | null
    enabled?: boolean
}) {
    useVisibilityReporter(props)
    return null
}

describe('useVisibilityReporter', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('does not retry a visibility update when the SSE subscription is already gone', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const api = {
            setVisibility: vi.fn(async () => {
                throw new ApiError('HTTP 404 Not Found: Subscription not found', 404)
            })
        } as unknown as ApiClient

        renderWithProviders(
            <VisibilityReporterHarness api={api} subscriptionId="stale-subscription" />,
            { withI18n: false, withQueryClient: false }
        )

        expect(api.setVisibility).toHaveBeenCalledTimes(1)

        await act(async () => {
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(2100)
        })

        expect(api.setVisibility).toHaveBeenCalledTimes(1)
        expect(consoleError).not.toHaveBeenCalled()
    })
})
