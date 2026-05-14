import { describe, expect, it } from 'vitest'
import { resolveCommand } from './registry'

describe('resolveCommand', () => {
    it('does not register the legacy HOPI MCP bridge command', () => {
        const { command, context } = resolveCommand(['mcp'])

        expect(command.name).toBe('default')
        expect(context.subcommand).toBe('mcp')
        expect(context.commandArgs).toEqual(['mcp'])
    })

    it('registers the scoped assistant operator MCP bridge command', () => {
        const { command, context } = resolveCommand(['assistant-operator-mcp'])

        expect(command.name).toBe('assistant-operator-mcp')
        expect(context.subcommand).toBe('assistant-operator-mcp')
        expect(context.commandArgs).toEqual([])
    })
})
