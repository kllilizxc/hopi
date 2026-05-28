import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { join, resolve, sep } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION } from '@hopi/protocol'
import { PRODUCT_DEFAULT_OFFICIAL_WEB_URL, PRODUCT_NAME } from '@hopi/protocol/brand'
import type { SyncEngine } from '../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from './middleware/auth'
import { createAuthRoutes } from './routes/auth'
import { createBindRoutes } from './routes/bind'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createMessagesRoutes } from './routes/messages'
import { createPermissionsRoutes } from './routes/permissions'
import { createMachinesRoutes } from './routes/machines'
import { createGitRoutes } from './routes/git'
import { createCliRoutes } from './routes/cli'
import { createPushRoutes } from './routes/push'
import { createVoiceRoutes } from './routes/voice'
import { createProjectsRoutes } from './routes/projects'
import { createOmcRoutes } from './routes/omc'
import { createWorkspacesRoutes } from './routes/workspaces'
import { createTasksRoutes } from './routes/tasks'
import { createGoalsRoutes } from './routes/goals'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import type { Store } from '../store'
import { createCorsMiddleware } from './middleware/cors'

type SpaDistBundle = {
    appName: string
    buildCommand: string
    distDir: string
    indexHtmlPath: string
}

function findSpaDistDir(packageDirName: string, appName: string, buildCommand: string): SpaDistBundle {
    const candidates = [
        join(process.cwd(), '..', packageDirName, 'dist'),
        join(import.meta.dir, '..', '..', '..', packageDirName, 'dist'),
        join(process.cwd(), packageDirName, 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { appName, buildCommand, distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { appName, buildCommand, distDir, indexHtmlPath: join(distDir, 'index.html') }
}

function findWebappDistDir(): SpaDistBundle {
    return findSpaDistDir('web', 'Mini App', 'bun run build:web')
}

function findOmcDistDir(): SpaDistBundle {
    return findSpaDistDir('OMC-client', 'OMC client', 'bun run build:omc')
}

function findOmcPrototypeDistDir(): SpaDistBundle {
    return findSpaDistDir('omc-prototype', 'OMC prototype', 'bun run build:omc-prototype')
}

function serveEmbeddedAsset(asset: EmbeddedWebAsset): Response {
    return new Response(Bun.file(asset.sourcePath), {
        headers: {
            'Content-Type': asset.mimeType
        }
    })
}

function createBuildRequiredResponse(bundle: SpaDistBundle): Response {
    return new Response(
        `${bundle.appName} is not built.\n\nRun:\n  ${bundle.buildCommand}\n`,
        { status: 503 }
    )
}

function serveBundleIndex(bundle: SpaDistBundle): Response {
    if (!existsSync(bundle.indexHtmlPath)) {
        return createBuildRequiredResponse(bundle)
    }

    return new Response(Bun.file(bundle.indexHtmlPath))
}

function resolveBundleAssetPath(bundle: SpaDistBundle, requestPath: string, prefix = ''): string | null {
    const trimmedPath = prefix && requestPath.startsWith(prefix) ? requestPath.slice(prefix.length) : requestPath
    const relativePath = trimmedPath.replace(/^\/+/, '')
    if (!relativePath) {
        return null
    }

    const distRoot = resolve(bundle.distDir)
    const candidatePath = resolve(distRoot, relativePath)
    if (candidatePath !== distRoot && !candidatePath.startsWith(`${distRoot}${sep}`)) {
        return null
    }

    return candidatePath
}

function tryServeBundleAsset(bundle: SpaDistBundle, requestPath: string, prefix = ''): Response | null {
    const assetPath = resolveBundleAssetPath(bundle, requestPath, prefix)
    if (!assetPath || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
        return null
    }

    return new Response(Bun.file(assetPath))
}

function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    relayMode?: boolean
    officialWebUrl?: string
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.use('*', logger())

    // Health check endpoint (no auth required)
    app.get('/health', (c) => c.json({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    const corsMiddleware = createCorsMiddleware({
        allowedOrigins: corsOrigins,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['authorization', 'content-type']
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.route('/cli', createCliRoutes(options.getSyncEngine))

    app.route('/api', createAuthRoutes(options.jwtSecret, options.store))
    app.route('/api', createBindRoutes(options.jwtSecret, options.store))

    app.use('/api/*', createAuthMiddleware(options.jwtSecret))
    app.route('/api', createEventsRoutes(options.getSseManager, options.getSyncEngine, options.getVisibilityTracker))
    app.route('/api', createSessionsRoutes(options.getSyncEngine))
    app.route('/api', createMessagesRoutes(options.getSyncEngine))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine))
    app.route('/api', createMachinesRoutes(options.getSyncEngine))
    app.route('/api', createGitRoutes(options.getSyncEngine))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))
    app.route('/api', createVoiceRoutes())
    app.route('/api', createProjectsRoutes({ store: options.store, getSyncEngine: options.getSyncEngine }))
    app.route('/api', createOmcRoutes({ store: options.store, getSyncEngine: options.getSyncEngine }))
    app.route('/api', createWorkspacesRoutes({ store: options.store, getSyncEngine: options.getSyncEngine }))
    app.route('/api', createTasksRoutes({ store: options.store, getSyncEngine: options.getSyncEngine }))
    app.route('/api', createGoalsRoutes({ store: options.store, getSyncEngine: options.getSyncEngine }))

    // Skip static serving in relay mode, show helpful message on root
    if (options.relayMode) {
        const officialUrl = options.officialWebUrl || PRODUCT_DEFAULT_OFFICIAL_WEB_URL
        app.get('/', (c) => {
            return c.html(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${PRODUCT_NAME} Hub</title></head>
<body style="font-family: system-ui; padding: 2rem; max-width: 600px;">
<h1>${PRODUCT_NAME} Hub</h1>
<p>This hub is running in relay mode. Please use the official web app:</p>
<p><a href="${officialUrl}">${officialUrl}</a></p>
<details>
<summary>Why am I seeing this?</summary>
<p style="margin-top: 0.5rem; color: #666;">
When relay mode is enabled, all traffic flows through our relay infrastructure with end-to-end encryption.
To reduce bandwidth and improve performance, the frontend is served separately
from GitHub Pages instead of through the relay tunnel.
</p>
</details>
</body>
</html>`)
        })
        return app
    }

    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const webIndexHtmlAsset = embeddedAssetMap.get('/index.html')
        const omcIndexHtmlAsset = embeddedAssetMap.get('/omc/index.html')

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(asset)
            }

            return await next()
        })

        app.get('/omc', (c) => {
            if (!omcIndexHtmlAsset) {
                return c.text(
                    'Embedded OMC client is missing /omc/index.html. Rebuild the executable after running bun run build:omc.',
                    503
                )
            }

            return serveEmbeddedAsset(omcIndexHtmlAsset)
        })

        app.get('/omc/*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            if (!omcIndexHtmlAsset) {
                return c.text(
                    'Embedded OMC client is missing /omc/index.html. Rebuild the executable after running bun run build:omc.',
                    503
                )
            }

            return serveEmbeddedAsset(omcIndexHtmlAsset)
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            if (!webIndexHtmlAsset) {
                return c.text(
                    'Embedded Mini App is missing /index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            }

            return serveEmbeddedAsset(webIndexHtmlAsset)
        })

        return app
    }

    const webBundle = findWebappDistDir()
    const omcBundle = findOmcDistDir()
    const omcPrototypeBundle = findOmcPrototypeDistDir()

    app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
            await next()
            return
        }

        if (c.req.path === '/omc' || c.req.path.startsWith('/omc/')) {
            const omcAsset = tryServeBundleAsset(omcBundle, c.req.path, '/omc')
            if (omcAsset) {
                return omcAsset
            }
        }

        if (c.req.path === '/omc-prototype' || c.req.path.startsWith('/omc-prototype/')) {
            const omcPrototypeAsset = tryServeBundleAsset(omcPrototypeBundle, c.req.path, '/omc-prototype')
            if (omcPrototypeAsset) {
                return omcPrototypeAsset
            }
        }

        const webAsset = tryServeBundleAsset(webBundle, c.req.path)
        if (webAsset) {
            return webAsset
        }

        return await next()
    })

    app.get('/omc', () => {
        return serveBundleIndex(omcBundle)
    })

    app.get('/omc/*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return serveBundleIndex(omcBundle)
    })

    app.get('/omc-prototype', () => {
        return serveBundleIndex(omcPrototypeBundle)
    })

    app.get('/omc-prototype/*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return serveBundleIndex(omcPrototypeBundle)
    })

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return serveBundleIndex(webBundle)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
    relayMode?: boolean
    officialWebUrl?: string
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        jwtSecret: options.jwtSecret,
        store: options.store,
        vapidPublicKey: options.vapidPublicKey,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap,
        relayMode: options.relayMode,
        officialWebUrl: options.officialWebUrl
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        maxRequestBodySize: socketHandler.maxRequestBodySize,
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    console.log(`[Web] hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    console.log(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
