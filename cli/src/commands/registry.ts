import { authCommand } from './auth'
import { claudeCommand } from './claude'
import { codexCommand } from './codex'
import { connectCommand } from './connect'
import { runnerCommand } from './runner'
import { doctorCommand } from './doctor'
import { geminiCommand } from './gemini'
import { opencodeCommand } from './opencode'
import { hookForwarderCommand } from './hookForwarder'
import { notifyCommand } from './notify'
import { hubCommand } from './hub'
import { assistantOperatorMcpCommand } from './assistantOperatorMcp'
import type { CommandContext, CommandDefinition } from './types'

const COMMANDS: CommandDefinition[] = [
    authCommand,
    connectCommand,
    codexCommand,
    geminiCommand,
    opencodeCommand,
    hubCommand,
    { ...hubCommand, name: 'server' },
    hookForwarderCommand,
    doctorCommand,
    runnerCommand,
    notifyCommand,
    assistantOperatorMcpCommand
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

export function resolveCommand(args: string[]): { command: CommandDefinition; context: CommandContext } {
    const subcommand = args[0]
    const command = subcommand ? commandMap.get(subcommand) : undefined
    const resolvedCommand = command ?? claudeCommand
    const commandArgs = command ? args.slice(1) : args

    return {
        command: resolvedCommand,
        context: {
            args,
            subcommand,
            commandArgs
        }
    }
}
