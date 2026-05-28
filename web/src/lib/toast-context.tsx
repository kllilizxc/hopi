import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type Toast = {
    id: string
    title: string
    body: string
    sessionId: string
    url: string
}

export type ToastContextValue = {
    toasts: Toast[]
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const TOAST_DURATION_MS = 6000

function createToastId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    useEffect(() => {
        return () => {
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer)
            }
            timersRef.current.clear()
        }
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = createToastId()
        const entry: Toast = { id, ...toast }

        // Also log toast messages to the console for easier debugging
        // (especially useful when running the PWA / Telegram Mini App).
        try {
            const title = entry.title?.trim() ?? ''
            const body = entry.body?.trim() ?? ''
            const base = title && body ? `${title} — ${body}` : (title || body || '(empty)')
            console.info('[Toast]', base, {
                id: entry.id,
                sessionId: entry.sessionId,
                url: entry.url
            })
        } catch {
            // Ignore console/log formatting errors (older environments, tests, etc).
        }

        setToasts((prev) => [...prev, entry])
        const timer = setTimeout(() => {
            removeToast(id)
        }, TOAST_DURATION_MS)
        timersRef.current.set(id, timer)
    }, [removeToast])

    const value = useMemo<ToastContextValue>(() => ({
        toasts,
        addToast,
        removeToast
    }), [toasts, addToast, removeToast])

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return ctx
}
