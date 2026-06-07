import chalk from 'chalk'
import { extractErrorInfo } from '@/utils/errorUtils'
import type { CommandDefinition } from './types'

export const goalAssistantMcpCommand: CommandDefinition = {
    name: 'goal-assistant-mcp',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            const { runGoalAssistantMcpServer } = await import('@/goalAssistantMcp')
            await runGoalAssistantMcpServer(commandArgs)
        } catch (error) {
            const { message } = extractErrorInfo(error)
            console.error(chalk.red('Error:'), message)
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
