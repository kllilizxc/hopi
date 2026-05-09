import { describe, it, expect } from 'vitest';
import { buildMcpServerConfigArgs, buildDeveloperInstructionsArg } from './codexMcpConfig';
import { PRODUCT_CLI_COMMAND } from '@hopi/protocol/brand';

describe('codexMcpConfig', () => {
    describe('buildMcpServerConfigArgs', () => {
        it('builds config args for a single MCP server', () => {
            const mcpServers = {
                docs: {
                    command: PRODUCT_CLI_COMMAND,
                    args: ['docs-server', '--url', 'http://localhost:3000']
                }
            };

            const args = buildMcpServerConfigArgs(mcpServers);

            expect(args).toEqual([
                '-c', `mcp_servers.docs.command="${PRODUCT_CLI_COMMAND}"`,
                '-c', `mcp_servers.docs.args=['docs-server','--url','http://localhost:3000']`
            ]);
        });

        it('builds config args for multiple MCP servers', () => {
            const mcpServers = {
                docs: { command: PRODUCT_CLI_COMMAND, args: ['docs-server'] },
                other: { command: 'node', args: ['server.js'] }
            };

            const args = buildMcpServerConfigArgs(mcpServers);

            expect(args).toContain('-c');
            expect(args).toContain(`mcp_servers.docs.command="${PRODUCT_CLI_COMMAND}"`);
            expect(args).toContain('mcp_servers.other.command="node"');
        });

        it('handles empty args array', () => {
            const mcpServers = {
                simple: { command: 'simple-server', args: [] }
            };

            const args = buildMcpServerConfigArgs(mcpServers);

            expect(args).toContain('mcp_servers.simple.args=[]');
        });

        it('escapes special characters in command', () => {
            const mcpServers = {
                test: { command: 'path/to/server', args: [] }
            };

            const args = buildMcpServerConfigArgs(mcpServers);

            expect(args).toContain('mcp_servers.test.command="path/to/server"');
        });
    });

    describe('buildDeveloperInstructionsArg', () => {
        it('builds developer instructions arg', () => {
            const instructions = 'Follow repo docs before editing.';

            const args = buildDeveloperInstructionsArg(instructions);

            expect(args).toEqual([
                '-c',
                'developer_instructions="Follow repo docs before editing."'
            ]);
        });

        it('omits empty developer instructions', () => {
            expect(buildDeveloperInstructionsArg('')).toEqual([]);
        });

        it('escapes double quotes', () => {
            const instructions = 'Use "quotes" in text.';

            const args = buildDeveloperInstructionsArg(instructions);

            expect(args[1]).toContain('\\"quotes\\"');
        });

        it('escapes newlines', () => {
            const instructions = 'Line 1\nLine 2';

            const args = buildDeveloperInstructionsArg(instructions);

            expect(args[1]).toContain('\\n');
            expect(args[1]).not.toContain('\n');
        });

        it('escapes backslashes', () => {
            const instructions = 'Path: C:\\Users\\test';

            const args = buildDeveloperInstructionsArg(instructions);

            expect(args[1]).toContain('\\\\');
        });
    });
});
