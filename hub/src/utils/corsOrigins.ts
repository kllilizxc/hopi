type WildcardPortOrigin = {
    protocol: string
    hostname: string
}

function tryParseWildcardPortOrigin(pattern: string): WildcardPortOrigin | null {
    const trimmed = pattern.trim()
    if (!trimmed.endsWith(':*')) {
        return null
    }

    // URL() does not accept "*" as a port, so replace it with a dummy value.
    const replaced = trimmed.slice(0, -1) + '0'
    try {
        const parsed = new URL(replaced)
        if (parsed.port !== '0') {
            return null
        }
        return {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
        }
    } catch {
        return null
    }
}

function tryParseOrigin(origin: string): { protocol: string; hostname: string } | null {
    try {
        const parsed = new URL(origin)
        return {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
        }
    } catch {
        return null
    }
}

export function createCorsOriginChecker(allowedOrigins: string[]): (origin: string | null | undefined) => boolean {
    const allowAll = allowedOrigins.includes('*')
    const exact = new Set<string>(allowedOrigins)
    const wildcardPorts = allowedOrigins
        .map(tryParseWildcardPortOrigin)
        .filter((entry): entry is WildcardPortOrigin => Boolean(entry))

    return (origin) => {
        // Match existing behavior: requests without Origin header are allowed.
        if (!origin) {
            return true
        }
        if (allowAll) {
            return true
        }
        if (exact.has(origin)) {
            return true
        }

        const parsedOrigin = tryParseOrigin(origin)
        if (!parsedOrigin) {
            return false
        }

        for (const wildcard of wildcardPorts) {
            if (wildcard.protocol === parsedOrigin.protocol && wildcard.hostname === parsedOrigin.hostname) {
                return true
            }
        }

        return false
    }
}

