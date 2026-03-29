import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import {
    OmcApiClient,
    OmcApiProvider,
    authenticateWithAccessToken,
    getStoredAccessToken,
    storeAccessToken
} from '@/api/client'
import { createAppRouter } from '@/router'
import './index.css'

function LoginScreen(props: { initialToken?: string; error?: string | null; onSubmit: (token: string) => void }) {
    const [token, setToken] = useState(props.initialToken ?? '')

    return (
        <div className="omc-login">
            <section className="omc-login__card">
                <p className="omc-shell__eyebrow">Access</p>
                <h1>Enter a HOPI access token</h1>
                <p>OMC now exchanges the raw HOPI access token for a session JWT before calling protected OMC APIs.</p>
                {props.error ? <p className="omc-error-copy">{props.error}</p> : null}
                <form
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (token.trim()) {
                            props.onSubmit(token.trim())
                        }
                    }}
                >
                    <input
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="paste access token"
                    />
                    <button type="submit">Open OMC</button>
                </form>
            </section>
        </div>
    )
}

function App() {
    const baseUrl = window.location.origin
    const urlToken = new URLSearchParams(window.location.search).get('token')
    const initialAccessToken = urlToken || getStoredAccessToken(baseUrl) || ''
    const [accessToken, setAccessToken] = useState(initialAccessToken)
    const [sessionToken, setSessionToken] = useState<string | null>(null)
    const [authError, setAuthError] = useState<string | null>(null)
    const [isAuthenticating, setIsAuthenticating] = useState(Boolean(initialAccessToken))
    const sessionTokenRef = useRef<string | null>(null)
    const routerBasepath = useMemo(() => {
        const basePath = import.meta.env.BASE_URL || '/'
        if (basePath === '/') {
            return '/'
        }

        return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
    }, [])
    const refreshSessionToken = useCallback(async () => {
        if (!accessToken) {
            setSessionToken(null)
            sessionTokenRef.current = null
            return null
        }

        setIsAuthenticating(true)
        try {
            const auth = await authenticateWithAccessToken(baseUrl, accessToken)
            setSessionToken(auth.token)
            sessionTokenRef.current = auth.token
            setAuthError(null)
            return auth.token
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Authentication failed'
            setSessionToken(null)
            sessionTokenRef.current = null
            setAuthError(message)
            return null
        } finally {
            setIsAuthenticating(false)
        }
    }, [accessToken, baseUrl])
    const api = useMemo(() => (
        sessionToken
            ? new OmcApiClient(baseUrl, sessionToken, {
                getToken: () => sessionTokenRef.current,
                onUnauthorized: refreshSessionToken
            })
            : null
    ), [baseUrl, refreshSessionToken, sessionToken])
    const queryClient = useMemo(() => new QueryClient(), [])
    const router = useMemo(() => createAppRouter(routerBasepath), [routerBasepath])

    useEffect(() => {
        if (!accessToken) {
            setSessionToken(null)
            sessionTokenRef.current = null
            setIsAuthenticating(false)
            return
        }

        void refreshSessionToken()
    }, [accessToken, refreshSessionToken])

    if (urlToken) {
        storeAccessToken(baseUrl, urlToken)
    }

    if (!accessToken || !sessionToken || !api) {
        return (
            <LoginScreen
                initialToken={accessToken}
                error={isAuthenticating ? 'Authenticating…' : authError}
                onSubmit={(nextAccessToken) => {
                    storeAccessToken(baseUrl, nextAccessToken)
                    setAccessToken(nextAccessToken)
                }}
            />
        )
    }

    return (
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <OmcApiProvider api={api}>
                    <RouterProvider router={router} />
                </OmcApiProvider>
            </QueryClientProvider>
        </React.StrictMode>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
