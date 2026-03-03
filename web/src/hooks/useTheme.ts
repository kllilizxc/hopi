import { useCallback, useSyncExternalStore } from 'react'
import { getTelegramWebApp } from './useTelegram'

export type Appearance = 'auto' | 'light' | 'dark'
export type ThemePreset = 'graphite' | 'soft' | 'contrast'
type ColorScheme = 'light' | 'dark'

type ThemeSnapshot = {
    appearance: Appearance
    colorScheme: ColorScheme
    preset: ThemePreset
}

const APPEARANCE_STORAGE_KEY = 'hapi-appearance'
const PRESET_STORAGE_KEY = 'hapi-theme-preset'

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

function parseAppearance(raw: string | null): Appearance {
    if (raw === 'light' || raw === 'dark' || raw === 'auto') {
        return raw
    }
    return 'auto'
}

function parsePreset(raw: string | null): ThemePreset {
    if (raw === 'graphite' || raw === 'soft' || raw === 'contrast') {
        return raw
    }
    return 'graphite'
}

function getStoredAppearance(): Appearance {
    return parseAppearance(safeGetItem(APPEARANCE_STORAGE_KEY))
}

function getStoredPreset(): ThemePreset {
    return parsePreset(safeGetItem(PRESET_STORAGE_KEY))
}

function getEnvironmentColorScheme(): ColorScheme {
    const tg = getTelegramWebApp()
    if (tg?.colorScheme) {
        return tg.colorScheme === 'dark' ? 'dark' : 'light'
    }

    // Fallback to system preference for browser environment
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    return 'light'
}

function isIOS(): boolean {
    if (typeof navigator === 'undefined') {
        return false
    }
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function applyTheme(scheme: ColorScheme): void {
    if (!isBrowser()) {
        return
    }
    document.documentElement.setAttribute('data-theme', scheme)
}

function applyPreset(preset: ThemePreset): void {
    if (!isBrowser()) {
        return
    }
    document.documentElement.setAttribute('data-theme-preset', preset)
}

function applyPlatform(): void {
    if (!isBrowser()) {
        return
    }
    if (isIOS()) {
        document.documentElement.classList.add('ios')
    }
}

// External store for theme state
let currentSnapshot: ThemeSnapshot = (() => {
    const appearance = getStoredAppearance()
    const colorScheme: ColorScheme = appearance === 'auto' ? getEnvironmentColorScheme() : appearance
    const preset = getStoredPreset()
    return { appearance, colorScheme, preset }
})()
const listeners = new Set<() => void>()

// Apply theme immediately at module load (before React renders)
applyPlatform()
applyTheme(currentSnapshot.colorScheme)
applyPreset(currentSnapshot.preset)

function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

function getSnapshot(): ThemeSnapshot {
    return currentSnapshot
}

function notifyIfChanged(next: ThemeSnapshot): void {
    if (
        next.appearance === currentSnapshot.appearance
        && next.colorScheme === currentSnapshot.colorScheme
        && next.preset === currentSnapshot.preset
    ) {
        return
    }
    currentSnapshot = next
    applyTheme(next.colorScheme)
    applyPreset(next.preset)
    listeners.forEach((cb) => cb())
}

function refreshFromSources(): void {
    const appearance = getStoredAppearance()
    const colorScheme: ColorScheme = appearance === 'auto' ? getEnvironmentColorScheme() : appearance
    const preset = getStoredPreset()
    notifyIfChanged({ appearance, colorScheme, preset })
}

function setStoredAppearance(appearance: Appearance): void {
    if (appearance === 'auto') {
        safeRemoveItem(APPEARANCE_STORAGE_KEY)
    } else {
        safeSetItem(APPEARANCE_STORAGE_KEY, appearance)
    }
}

function setStoredPreset(preset: ThemePreset): void {
    if (preset === 'graphite') {
        safeRemoveItem(PRESET_STORAGE_KEY)
    } else {
        safeSetItem(PRESET_STORAGE_KEY, preset)
    }
}

// Track if theme listeners have been set up
let listenersInitialized = false

export function useTheme(): {
    appearance: Appearance
    colorScheme: ColorScheme
    preset: ThemePreset
    isDark: boolean
    setAppearance: (appearance: Appearance) => void
    setPreset: (preset: ThemePreset) => void
} {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const setAppearance = useCallback((appearance: Appearance) => {
        setStoredAppearance(appearance)
        refreshFromSources()
    }, [])
    const setPreset = useCallback((preset: ThemePreset) => {
        setStoredPreset(preset)
        refreshFromSources()
    }, [])

    return {
        appearance: snapshot.appearance,
        colorScheme: snapshot.colorScheme,
        preset: snapshot.preset,
        isDark: snapshot.colorScheme === 'dark',
        setAppearance,
        setPreset,
    }
}

// Call this once at app startup to ensure theme is applied and listeners attached
export function initializeTheme(): void {
    applyPlatform()
    refreshFromSources()

    // Set up listeners only once (after SDK may have loaded)
    if (!listenersInitialized) {
        listenersInitialized = true
        const tg = getTelegramWebApp()
        if (tg?.onEvent) {
            // Telegram theme changes
            tg.onEvent('themeChanged', refreshFromSources)
        } else if (typeof window !== 'undefined' && window.matchMedia) {
            // Browser system preference changes
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
            mediaQuery.addEventListener('change', refreshFromSources)
        }

        // Sync across tabs/windows (best-effort).
        if (typeof window !== 'undefined') {
            const onStorage = (event: StorageEvent) => {
                if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== PRESET_STORAGE_KEY) {
                    return
                }
                refreshFromSources()
            }
            window.addEventListener('storage', onStorage)
        }
    }
}
