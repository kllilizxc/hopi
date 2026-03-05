import chalk from 'chalk'
import os from 'node:os'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, clearMachineId, updateSettings } from '@/persistence'
import type { CommandDefinition } from './types'
import { PRODUCT_CLI_COMMAND, PRODUCT_ENV, PRODUCT_HOME_DIRNAME } from '@hopi/protocol/brand'

const SETTINGS_PATH_HINT = `~/${PRODUCT_HOME_DIRNAME}/settings.json`

export async function handleAuthCommand(args: string[]): Promise<void> {
    const subcommand = args[0]

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        showHelp()
        return
    }

    if (subcommand === 'status') {
        const settings = await readSettings()
        const envToken = process.env.CLI_API_TOKEN
        const settingsToken = settings.cliApiToken
        const hasToken = Boolean(envToken || settingsToken)
        const tokenSource = envToken ? 'environment' : (settingsToken ? 'settings file' : 'none')
        console.log(chalk.bold('\nDirect Connect Status\n'))
        console.log(chalk.gray(`  ${PRODUCT_ENV.API_URL}: ${configuration.apiUrl}`))
        console.log(chalk.gray(`  CLI_API_TOKEN: ${hasToken ? 'set' : 'missing'}`))
        console.log(chalk.gray(`  Token Source: ${tokenSource}`))
        console.log(chalk.gray(`  Machine ID: ${settings.machineId ?? 'not set'}`))
        console.log(chalk.gray(`  Host: ${os.hostname()}`))

        if (!hasToken) {
            console.log('')
            console.log(chalk.yellow('  Token not configured. To get your token:'))
            console.log(chalk.gray('    1. Check the server startup logs (first run shows generated token)'))
            console.log(chalk.gray(`    2. Read ${SETTINGS_PATH_HINT} on the server`))
            console.log(chalk.gray('    3. Ask your server administrator (if token is set via env var)'))
            console.log('')
            console.log(chalk.gray(`  Then run: ${PRODUCT_CLI_COMMAND} auth login`))
        }
        return
    }

    if (subcommand === 'login') {
        if (!process.stdin.isTTY) {
            console.error(chalk.red('Cannot prompt for token in non-TTY environment.'))
            console.error(chalk.gray('Set CLI_API_TOKEN environment variable instead.'))
            process.exit(1)
        }

        const rl = readline.createInterface({ input, output })

        try {
            const token = await rl.question(chalk.cyan('Enter CLI_API_TOKEN: '))

            if (!token.trim()) {
                console.error(chalk.red('Token cannot be empty'))
                process.exit(1)
            }

            await updateSettings(current => ({
                ...current,
                cliApiToken: token.trim()
            }))
            configuration._setCliApiToken(token.trim())
            console.log(chalk.green(`\nToken saved to ${configuration.settingsFile}`))
        } finally {
            rl.close()
        }
        return
    }

    if (subcommand === 'logout') {
        await updateSettings(current => ({
            ...current,
            cliApiToken: undefined
        }))
        await clearMachineId()
        console.log(chalk.green('Cleared local credentials (token and machineId).'))
        console.log(chalk.gray('Note: If CLI_API_TOKEN is set via environment variable, it will still be used.'))
        return
    }

    console.error(chalk.red(`Unknown auth subcommand: ${subcommand}`))
    showHelp()
    process.exit(1)
}

function showHelp(): void {
    console.log(`
${chalk.bold(`${PRODUCT_CLI_COMMAND} auth`)} - Authentication management

${chalk.bold('Usage:')}
  ${PRODUCT_CLI_COMMAND} auth status            Show current configuration
  ${PRODUCT_CLI_COMMAND} auth login             Enter and save CLI_API_TOKEN
  ${PRODUCT_CLI_COMMAND} auth logout            Clear saved credentials

${chalk.bold('Token priority (highest to lowest):')}
  1. CLI_API_TOKEN environment variable
  2. ${SETTINGS_PATH_HINT}
  3. Interactive prompt (on first run)
`)
}

export const authCommand: CommandDefinition = {
    name: 'auth',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            await handleAuthCommand(commandArgs)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
