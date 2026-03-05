import chalk from 'chalk'
import type { CommandDefinition } from './types'

export const notifyCommand: CommandDefinition = {
    name: 'notify',
    requiresRuntimeAssets: true,
    run: async () => {
        console.error(chalk.red('The `hopi notify` command is not available in direct-connect mode.'))
        console.error(chalk.gray('Use Telegram notifications from hopi-hub instead.'))
        process.exit(1)
    }
}
