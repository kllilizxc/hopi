import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRODUCT_ENV, PRODUCT_SLUG } from '@hopi/protocol/brand'
import { loadServerSettings } from './serverSettings'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
})

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), `${PRODUCT_SLUG}-server-settings-`))
    try {
        return await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

describe('loadServerSettings CORS defaults', () => {
    it('adds web dev origins when public URL is localhost', async () => {
        await withTempDir(async (dataDir) => {
            const result = await loadServerSettings(dataDir)
            expect(result.settings.corsOrigins).toEqual([
                'http://localhost:3006',
                'http://localhost:*',
                'http://127.0.0.1:*'
            ])
        })
    })

    it('keeps non-local public URL origin only', async () => {
        process.env[PRODUCT_ENV.PUBLIC_URL] = 'https://hub.example.com'
        await withTempDir(async (dataDir) => {
            const result = await loadServerSettings(dataDir)
            expect(result.settings.corsOrigins).toEqual(['https://hub.example.com'])
        })
    })

    it('prefers explicit CORS_ORIGINS over derived defaults', async () => {
        process.env.CORS_ORIGINS = 'http://localhost:4123'
        await withTempDir(async (dataDir) => {
            const result = await loadServerSettings(dataDir)
            expect(result.settings.corsOrigins).toEqual(['http://localhost:4123'])
        })
    })
})
