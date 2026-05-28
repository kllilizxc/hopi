import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectActionContract, loadProjectActionContractFromSession } from './actionContract'
import type { SyncEngine } from './syncEngine'

const VALID_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      cwd: web',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: http',
    '        url: "http://127.0.0.1:$HOPI_PORT_WEB/"',
    '      expose: primary',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

describe('project action contract loader', () => {
    it('returns missing when manifest does not exist', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hopi-actions-missing-'))
        try {
            const result = await loadProjectActionContract(root)
            expect(result.kind).toBe('missing')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    it('parses a valid actions manifest', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hopi-actions-valid-'))
        try {
            await mkdir(join(root, '.hopi'), { recursive: true })
            await Bun.write(join(root, '.hopi', 'actions.yaml'), VALID_MANIFEST)

            const result = await loadProjectActionContract(root)
            expect(result.kind).toBe('valid')
            if (result.kind === 'valid') {
                expect(result.contract.setup.steps[0]?.id).toBe('deps')
                expect(result.contract.preview.services[0]?.id).toBe('web')
                expect(result.contract.merge.targetBranch).toBe('main')
            }
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    it('returns invalid when manifest violates schema', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hopi-actions-invalid-'))
        try {
            await mkdir(join(root, '.hopi'), { recursive: true })
            await writeFile(join(root, '.hopi', 'actions.yaml'), [
                'version: 1',
                'setup:',
                '  steps: []',
                'preview:',
                '  services: []',
                'merge:',
                '  targetBranch: ""'
            ].join('\n'), 'utf8')

            const result = await loadProjectActionContract(root)
            expect(result.kind).toBe('invalid')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    it('skips candidates outside the session working directory and loads the next manifest', async () => {
        const baseRoot = '/Users/realizer/Code/hopi'
        const worktreeRoot = '/Users/realizer/Code/hopi-worktrees/task-123'
        const result = await loadProjectActionContractFromSession({
            engine: {
                async readSessionFile(_sessionId: string, _path: string, cwd?: string) {
                    if (cwd === baseRoot) {
                        return {
                            success: false,
                            error: `Access denied: Path '${baseRoot}' is outside the working directory`
                        }
                    }

                    if (cwd === worktreeRoot) {
                        return {
                            success: true,
                            content: Buffer.from(VALID_MANIFEST, 'utf8').toString('base64')
                        }
                    }

                    return {
                        success: false,
                        error: 'Failed to read file: ENOENT'
                    }
                }
            } as unknown as SyncEngine,
            sessionId: 'session-1',
            rootPaths: [baseRoot, worktreeRoot]
        })

        expect(result.kind).toBe('valid')
        if (result.kind === 'valid') {
            expect(result.rootPath).toBe(worktreeRoot)
            expect(result.manifestPath).toBe(join(worktreeRoot, '.hopi', 'actions.yaml'))
            expect(result.contract.setup.steps[0]?.id).toBe('deps')
        }
    })

    it('returns invalid when every candidate is outside the session working directory', async () => {
        const root = '/Users/realizer/Code/hopi'
        const result = await loadProjectActionContractFromSession({
            engine: {
                async readSessionFile() {
                    return {
                        success: false,
                        error: `Access denied: Path '${root}' is outside the working directory`
                    }
                }
            } as unknown as SyncEngine,
            sessionId: 'session-1',
            rootPaths: [root]
        })

        expect(result.kind).toBe('invalid')
        if (result.kind === 'invalid') {
            expect(result.rootPath).toBe(root)
            expect(result.error).toContain('outside the working directory')
        }
    })
})
