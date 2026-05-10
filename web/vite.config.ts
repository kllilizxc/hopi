import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const base = process.env.VITE_BASE_URL || '/'
const webPortEnv = process.env.HOPI_WEB_PORT?.trim()
const webPort = webPortEnv ? Number.parseInt(webPortEnv, 10) : null

type HopiDevSettings = {
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

const hubUrl = resolveHubUrl()

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(require('../cli/package.json').version),
    },
    server: {
        host: true,
        port: webPort ?? undefined,
        allowedHosts: ['hopidev.weishu.me', 'macbook-pro-2.tailfbf761.ts.net', 'macbook-pro-2.tailfbf761.ts.net'],
        // Only enforce strict port when caller explicitly pinned the port (preview mode).
        strictPort: Boolean(webPortEnv),
        proxy: {
            '/api': {
                target: hubUrl,
                changeOrigin: true
            },
            '/socket.io': {
                target: hubUrl,
                ws: true
            }
        }
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'mask-icon.svg'],
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            manifest: {
                name: 'HOPI',
                short_name: 'HOPI',
                description: 'AI-powered development assistant',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                scope: base,
                start_url: base,
                icons: [
                    {
                        src: 'pwa-64x64.png',
                        sizes: '64x64',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    },
                    {
                        src: 'maskable-icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            injectManifest: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']
            },
            devOptions: {
                enabled: true,
                type: 'module'
            }
        })
    ],
    base,
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
})
