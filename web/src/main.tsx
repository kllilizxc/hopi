import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { initializeFontScale } from '@/hooks/useFontScale'
import { getTelegramWebApp, isTelegramEnvironment, loadTelegramSdk } from './hooks/useTelegram'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { queryClient } from './lib/query-client'
import { createAppRouter } from './router'

function getInitialPath(): string {
    return '/projects'
}

async function bootstrap() {
    initializeFontScale()

    // Only load Telegram SDK in Telegram environment (with 3s timeout)
    const isTelegram = isTelegramEnvironment()
    if (isTelegram) {
        await loadTelegramSdk()
    }

    const updateSW = registerSW({
        onNeedRefresh() {
            if (confirm('New version available! Reload to update?')) {
                updateSW(true)
            }
        },
        onOfflineReady() {
            console.log('App ready for offline use')
        },
        onRegistered(registration) {
            if (registration) {
                setInterval(() => {
                    registration.update()
                }, 60 * 60 * 1000)
            }
        },
        onRegisterError(error) {
            console.error('SW registration error:', error)
        }
    })

    const history = isTelegram
        ? createMemoryHistory({ initialEntries: [getInitialPath()] })
        : undefined
    const router = createAppRouter(history)

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <I18nProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </I18nProvider>
                {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
            </QueryClientProvider>
        </React.StrictMode>
    )
}

bootstrap()
