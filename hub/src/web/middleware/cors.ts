import type { MiddlewareHandler } from 'hono'
import { createCorsOriginChecker } from '../../utils/corsOrigins'

export type CorsMiddlewareOptions = {
    allowedOrigins: string[]
    allowMethods: string[]
    allowHeaders: string[]
}

export function createCorsMiddleware(options: CorsMiddlewareOptions): MiddlewareHandler {
    const isOriginAllowed = createCorsOriginChecker(options.allowedOrigins)
    const allowAllOrigins = options.allowedOrigins.includes('*')
    const allowMethodsHeader = options.allowMethods.join(', ')
    const allowHeadersHeader = options.allowHeaders.join(', ')

    return async (c, next) => {
        const origin = c.req.header('origin')

        if (origin && isOriginAllowed(origin)) {
            c.header('Access-Control-Allow-Origin', allowAllOrigins ? '*' : origin)
            if (!allowAllOrigins) {
                c.header('Vary', 'Origin')
            }
            c.header('Access-Control-Allow-Methods', allowMethodsHeader)
            c.header('Access-Control-Allow-Headers', allowHeadersHeader)
        }

        if (c.req.method === 'OPTIONS') {
            // Preflight response; CORS headers added only when Origin is allowed.
            return c.body(null, 204)
        }

        await next()
    }
}

