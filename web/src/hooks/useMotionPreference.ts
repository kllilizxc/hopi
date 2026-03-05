import { useCallback, useSyncExternalStore } from 'react'
import { productStorageKey } from '@hopi/protocol/brand'

export type MotionPreference = 'auto' | 'reduce'

type MotionSnapshot = {
    preference: MotionPreference
}

const MOTION_STORAGE_KEY = productStorageKey('motion')

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseMotionPreference(raw: string | null): MotionPreference {
    if (raw === 'reduce' || raw === 'auto') {
        return raw
    }
    return 'auto'
}

function getStoredPreference(): MotionPreference {
    return parseMotionPreference(safeGetItem(MOTION_STORAGE_KEY))
}

function applyMotionPreference(preference: MotionPreference): void {
    if (!isBrowser()) {
        return
    }
    if (preference === 'reduce') {
        document.documentElement.setAttribute('data-motion', 'reduce')
    } else {
        document.documentElement.removeAttribute('data-motion')
    }
}

let currentSnapshot: MotionSnapshot = (() => ({ preference: getStoredPreference() }))()
const listeners = new Set<() => void>()

// Apply at module load to avoid a "first interaction" mismatch.
applyMotionPreference(currentSnapshot.preference)

function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

function getSnapshot(): MotionSnapshot {
    return currentSnapshot
}

function notifyIfChanged(next: MotionSnapshot): void {
    if (next.preference === currentSnapshot.preference) {
        return
    }
    currentSnapshot = next
    applyMotionPreference(next.preference)
    listeners.forEach((cb) => cb())
}

function refreshFromSources(): void {
    notifyIfChanged({ preference: getStoredPreference() })
}

function setStoredPreference(preference: MotionPreference): void {
    if (preference === 'auto') {
        safeRemoveItem(MOTION_STORAGE_KEY)
    } else {
        safeSetItem(MOTION_STORAGE_KEY, preference)
    }
}

let listenersInitialized = false

export function useMotionPreference(): {
    preference: MotionPreference
    setPreference: (preference: MotionPreference) => void
} {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    const setPreference = useCallback((preference: MotionPreference) => {
        setStoredPreference(preference)
        refreshFromSources()
    }, [])

    return {
        preference: snapshot.preference,
        setPreference,
    }
}

export function initializeMotionPreference(): void {
    refreshFromSources()

    if (listenersInitialized || !isBrowser()) {
        return
    }
    listenersInitialized = true

    const onStorage = (event: StorageEvent) => {
        if (event.key !== MOTION_STORAGE_KEY) {
            return
        }
        refreshFromSources()
    }
    window.addEventListener('storage', onStorage)
}
