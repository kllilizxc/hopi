import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

async function createTempDir(prefix: string): Promise<string> {
    const base = tmpdir()
    const path = join(base, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('file RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }

        rootDir = await createTempDir('hopi-file-handler')
        await mkdir(join(rootDir, 'src'), { recursive: true })
        await writeFile(join(rootDir, 'src', 'index.ts'), 'console.log("ok")')
        await writeFile(join(rootDir, 'README.md'), '# test')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    it('reads file within cwd scope', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ cwd: 'src', path: 'index.ts' })
        })

        const parsed = JSON.parse(response) as { success: boolean; content?: string }
        expect(parsed.success).toBe(true)

        const content = Buffer.from(parsed.content ?? '', 'base64').toString()
        expect(content).toBe('console.log("ok")')
    })

    it('rejects path traversal outside cwd when cwd is provided', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ cwd: 'src', path: '../README.md' })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
        expect(parsed.error ?? '').toContain('outside the working directory')
    })
})

