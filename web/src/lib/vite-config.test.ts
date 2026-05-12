import { describe, expect, it } from 'vitest'

import { resolveHubUrl, resolveHopiDataDir } from '../../vite.config.helpers'

describe('vite dev hub proxy config', () => {
    it('uses the persisted hub listen port when no hub env override is set', () => {
        const hubUrl = resolveHubUrl(
            { HOPI_WEB_PORT: '5175' },
            { listenPort: 3106 }
        )

        expect(hubUrl).toBe('http://127.0.0.1:3106')
    })

    it('lets explicit hub env override persisted settings', () => {
        const hubUrl = resolveHubUrl(
            { HOPI_HUB_URL: 'http://localhost:4100', HOPI_LISTEN_PORT: '3106' },
            { listenPort: 3006 }
        )

        expect(hubUrl).toBe('http://localhost:4100')
    })

    it('normalizes wildcard listen hosts to a connectable loopback target', () => {
        const hubUrl = resolveHubUrl(
            {},
            { listenHost: '0.0.0.0', listenPort: 3106 }
        )

        expect(hubUrl).toBe('http://127.0.0.1:3106')
    })

    it('resolves HOPI_HOME tilde paths like the hub and cli configs', () => {
        expect(resolveHopiDataDir({ HOPI_HOME: '~/.hopi-dev' })).toMatch(/\/\.hopi-dev$/)
    })
})
