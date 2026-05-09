import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createDevelopmentHappyCliCommand } from './spawnHappyCLI'
import { projectPath } from '@/projectPath'

describe('createDevelopmentHappyCliCommand', () => {
    it('pins Bun development subprocesses to the CLI project cwd', () => {
        const cliRoot = projectPath()
        const command = createDevelopmentHappyCliCommand(
            ['runner', 'start-sync'],
            {
                execPath: '/usr/local/bin/bun',
                execArgv: ['--conditions', 'development'],
                isBunRuntime: true,
                projectRoot: cliRoot
            }
        )

        expect(command.command).toBe('/usr/local/bin/bun')
        expect(command.args).toEqual([
            '--cwd',
            cliRoot,
            join(cliRoot, 'src', 'index.ts'),
            'runner',
            'start-sync'
        ])
    })
})
