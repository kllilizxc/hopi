import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
import { findExecutableOnPath, resolveGitExecutable } from './resolveGitExecutable'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(dir, { recursive: true })
    tempDirs.push(dir)
    return dir
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true })
    }))
})

describe('resolveGitExecutable', () => {
    it('finds git on a provided PATH without relying on shell lookup', async () => {
        const binDir = await createTempDir('hopi-git-bin')
        const executableName = process.platform === 'win32' ? 'git.cmd' : 'git'
        const executablePath = join(binDir, executableName)
        const scriptContent = process.platform === 'win32'
            ? '@echo off\r\necho git\r\n'
            : '#!/bin/sh\necho git\n'

        await writeFile(executablePath, scriptContent, 'utf8')
        if (process.platform !== 'win32') {
            await chmod(executablePath, 0o755)
        }

        const env = {
            ...process.env,
            PATH: binDir,
            [PRODUCT_ENV.GIT_PATH]: ''
        }

        expect(findExecutableOnPath('git', env)).toBe(executablePath)
        expect(resolveGitExecutable(env)).toBe(executablePath)
    })

    it('honors explicit git path override', async () => {
        const binDir = await createTempDir('hopi-git-explicit')
        const executableName = process.platform === 'win32' ? 'my-git.cmd' : 'my-git'
        const executablePath = join(binDir, executableName)
        const scriptContent = process.platform === 'win32'
            ? '@echo off\r\necho git\r\n'
            : '#!/bin/sh\necho git\n'

        await writeFile(executablePath, scriptContent, 'utf8')
        if (process.platform !== 'win32') {
            await chmod(executablePath, 0o755)
        }

        const env = {
            ...process.env,
            PATH: '',
            [PRODUCT_ENV.GIT_PATH]: executablePath
        }

        expect(resolveGitExecutable(env)).toBe(executablePath)
    })
})
