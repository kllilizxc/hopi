import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type HopiDevSettings = {
    listenHost?: unknown
    listenPort?: unknown
    webappHost?: unknown
    webappPort?: unknown
}

function parsePort(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : null
    }
    if (typeof value !== 'string') {
        return null
    }
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeProxyHost(value: unknown): string {
    if (typeof value !== 'string') {
        return '127.0.0.1'
    }
    const trimmed = value.trim()
    if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::') {
        return '127.0.0.1'
    }
    return trimmed
}

function formatProxyHost(host: string): string {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export function resolveHopiDataDir(env: Record<string, string | undefined> = process.env): string {
    const configured = env.HOPI_HOME?.trim()
    if (!configured) {
        return join(homedir(), '.hopi')
    }
    if (configured === '~') {
        return homedir()
    }
    if (configured.startsWith('~/')) {
        return join(homedir(), configured.slice(2))
    }
    return configured
}

function readHopiDevSettings(dataDir: string): HopiDevSettings | null {
    const settingsFile = join(dataDir, 'settings.json')
    if (!existsSync(settingsFile)) {
        return null
    }
    try {
        const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as HopiDevSettings
            : null
    } catch {
        return null
    }
}

export function resolveHubUrl(
    env: Record<string, string | undefined> = process.env,
    settings: HopiDevSettings | null = readHopiDevSettings(resolveHopiDataDir(env))
): string {
    const explicitHubUrl = env.HOPI_HUB_URL?.trim()
    if (explicitHubUrl) {
        return explicitHubUrl
    }

    const port = parsePort(env.HOPI_LISTEN_PORT)
        ?? parsePort(settings?.listenPort)
        ?? parsePort(settings?.webappPort)
        ?? 3006
    const host = normalizeProxyHost(
        env.HOPI_LISTEN_HOST
            ?? settings?.listenHost
            ?? settings?.webappHost
    )
    return `http://${formatProxyHost(host)}:${port}`
}
