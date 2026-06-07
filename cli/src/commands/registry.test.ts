import { describe, expect, it } from 'vitest'
import { resolveCommand } from './registry'

describe('resolveCommand', () => {
    it('does not register the legacy HOPI MCP bridge command', () => {
        const { command, context } = resolveCommand(['mcp'])

        expect(command.name).toBe('default')
        expect(context.subcommand).toBe('mcp')
        expect(context.commandArgs).toEqual(['mcp'])
    })

    it('registers the goal assistant MCP server command explicitly', () => {
        const { command, context } = resolveCommand(['goal-assistant-mcp', '--project-id', 'p1', '--goal-id', 'g1'])

        expect(command.name).toBe('goal-assistant-mcp')
        expect(context.subcommand).toBe('goal-assistant-mcp')
        expect(context.commandArgs).toEqual(['--project-id', 'p1', '--goal-id', 'g1'])
    })
})
