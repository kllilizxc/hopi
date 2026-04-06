import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '@/router'
import {
    authenticateWithAccessToken,
    getStoredAccessToken,
    PrototypeRemoteApiClient,
    PrototypeRemoteApiProvider,
    storeAccessToken,
} from '@/prototype/remoteApi'
import { PrototypeStoreProvider } from '@/prototype/store'
import './index.css'

const routerBasepath = (() => {
    const basePath = import.meta.env.BASE_URL || '/'
    return basePath.endsWith('/') && basePath !== '/' ? basePath.slice(0, -1) : basePath
})()

const router = createAppRouter(routerBasepath)

function LoginScreen(props: {
    initialToken?: string
    error?: string | null
    onSubmit: (token: string) => void
}) {
    const [token, setToken] = useState(props.initialToken ?? '')

    return (
        <div className="prototype-empty">
            <form
                className="prototype-panel prototype-attach"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (token.trim()) {
                        props.onSubmit(token.trim())
                    }
                }}
            >
                <p className="prototype-eyebrow">真实 OMC 运行态</p>
                <h2>输入 HOPI access token</h2>
                <p>原型现在会先把 access token 换成会话 JWT，再接入真实 `/api/omc/*` 与 `/api/sessions/*`。</p>
                {props.error ? <p>{props.error}</p> : null}
                <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="paste access token"
                />
                <div className="prototype-inline-actions">
                    <button type="submit" className="prototype-primary-button">连接 OMC</button>
                </div>
            </form>
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
            ? new PrototypeRemoteApiClient(baseUrl, sessionToken, {
                getToken: () => sessionTokenRef.current,
                onUnauthorized: refreshSessionToken,
            })
            : null
    ), [baseUrl, refreshSessionToken, sessionToken])

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
            <PrototypeRemoteApiProvider api={api}>
                <PrototypeStoreProvider>
                    <RouterProvider router={router} />
                </PrototypeStoreProvider>
            </PrototypeRemoteApiProvider>
        </React.StrictMode>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
