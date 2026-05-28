const MOBILE_MEDIA_QUERY = '(max-width: 1023px)'

export function isMobileViewport(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false
    }

    return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}
