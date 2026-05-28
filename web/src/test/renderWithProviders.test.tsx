import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { useContext } from 'react'
import { I18nContext, type I18nContextValue } from '@/lib/i18n-context'
import { renderWithProviders } from './renderWithProviders'

function I18nProbe({ translationKey }: { translationKey: string }) {
    const i18n = useContext(I18nContext)

    if (!i18n) {
        return <div data-testid="i18n-state">missing</div>
    }

    return (
        <div data-testid="i18n-state">
            {`${i18n.locale}:${i18n.t(translationKey)}`}
        </div>
    )
}

describe('renderWithProviders', () => {
    beforeEach(() => {
        localStorage.clear()
        document.documentElement.lang = ''
    })

    it('wraps ui with the default i18n provider', () => {
        renderWithProviders(<I18nProbe translationKey="login.submit" />)

        expect(screen.getByTestId('i18n-state')).toHaveTextContent('en:Sign In')
        expect(document.documentElement.lang).toBe('en')
    })

    it('uses a custom i18n context value when i18nValue is provided', () => {
        const t = vi.fn((key: string) => `custom-${key}`)
        const i18nValue: I18nContextValue = {
            t,
            locale: 'zh-CN',
            setLocale: vi.fn(),
        }

        renderWithProviders(<I18nProbe translationKey="login.submit" />, {
            i18nValue,
        })

        expect(screen.getByTestId('i18n-state')).toHaveTextContent('zh-CN:custom-login.submit')
        expect(t).toHaveBeenCalledWith('login.submit')
    })

    it('creates isolated query clients by default', () => {
        const first = renderWithProviders(<div>first</div>)
        const second = renderWithProviders(<div>second</div>)

        expect(first.queryClient).not.toBeNull()
        expect(second.queryClient).not.toBeNull()
        expect(first.queryClient).not.toBe(second.queryClient)

        const cacheKey = ['session', 'isolation-check']
        first.queryClient!.setQueryData(cacheKey, { source: 'first' })

        expect(first.queryClient!.getQueryData(cacheKey)).toEqual({ source: 'first' })
        expect(second.queryClient!.getQueryData(cacheKey)).toBeUndefined()
    })

    it('uses router initial entries when router provider is enabled', async () => {
        const { router } = renderWithProviders(<div>router-content</div>, {
            withRouter: true,
            router: {
                routePath: '/settings',
                initialEntries: ['/settings?tab=about'],
            },
        })

        expect(await screen.findByText('router-content')).toBeInTheDocument()
        expect(router).not.toBeNull()
        expect(router?.state.location.pathname).toBe('/settings')
    })

    it('can skip optional providers', () => {
        const { queryClient, router } = renderWithProviders(<I18nProbe translationKey="login.submit" />, {
            withI18n: false,
            withQueryClient: false,
            withRouter: false,
        })

        expect(screen.getByTestId('i18n-state')).toHaveTextContent('missing')
        expect(queryClient).toBeNull()
        expect(router).toBeNull()
    })
})
