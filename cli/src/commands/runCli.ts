import packageJson from '../../package.json'
import { ensureRuntimeAssets } from '@/runtime/assets'
import { isBunCompiled } from '@/projectPath'
import { logger } from '@/ui/logger'
import { getCliArgs } from '@/utils/cliArgs'
import { resolveCommand } from './registry'

function parseBooleanFlag(value: string | undefined): boolean {
    if (!value) {
        return false
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function stripStrictWorkspaceWritesFlag(args: string[]): { args: string[]; enabled: boolean } {
    let enabled = false
    const next: string[] = []

    for (const arg of args) {
        if (arg === '--strict-workspace-writes') {
            enabled = true
            continue
        }
        if (arg.startsWith('--strict-workspace-writes=')) {
            enabled = parseBooleanFlag(arg.slice('--strict-workspace-writes='.length))
            continue
        }
        next.push(arg)
    }

    return { args: next, enabled }
}

export async function runCli(): Promise<void> {
    const rawArgs = getCliArgs()
    const strictResult = stripStrictWorkspaceWritesFlag(rawArgs)
    const args = strictResult.args
    if (strictResult.enabled) {
        process.env.HAPI_STRICT_WORKSPACE_WRITES = '1'
    }

    if (args.includes('-v') || args.includes('--version')) {
        console.log(`hapi version: ${packageJson.version}`)
        process.exit(0)
    }

    if (isBunCompiled()) {
        process.env.DEV = 'false'
    }

    const { command, context } = resolveCommand(args)

    if (command.requiresRuntimeAssets) {
        await ensureRuntimeAssets()
        logger.debug('Starting hapi CLI with args: ', process.argv)
    }

    await command.run(context)
}
