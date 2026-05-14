import { describe, expect, it } from 'vitest';

import { registerAppServerPermissionHandlers } from './appServerPermissionAdapter';

describe('registerAppServerPermissionHandlers', () => {
    it('answers Codex app-server MCP elicitation permission requests', async () => {
        const handlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
        const client = {
            registerRequestHandler(method: string, handler: (params: unknown) => Promise<unknown> | unknown) {
                handlers.set(method, handler);
            }
        };
        const calls: unknown[] = [];
        const permissionHandler = {
            async handleToolCall(toolCallId: string, toolName: string, input: unknown) {
                calls.push({ toolCallId, toolName, input });
                return { decision: 'approved' };
            }
        };

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: permissionHandler as never
        });

        const handler = handlers.get('mcpServer/elicitation/request');
        expect(handler).toBeDefined();

        const result = await handler?.({
            mcpToolCallId: 'call-1',
            server: 'hopi_operator',
            tool: 'hopi_project_snapshot',
            message: 'Allow MCP tool call?',
            requestedSchema: {
                type: 'object',
                properties: {
                    decision: { type: 'string' },
                    approved: { type: 'boolean' }
                }
            }
        });

        expect(calls).toEqual([{
            toolCallId: 'call-1',
            toolName: 'mcp__hopi_operator__hopi_project_snapshot',
            input: {
                mcpToolCallId: 'call-1',
                server: 'hopi_operator',
                tool: 'hopi_project_snapshot',
                message: 'Allow MCP tool call?',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        decision: { type: 'string' },
                        approved: { type: 'boolean' }
                    }
                }
            }
        }]);
        expect(result).toEqual({
            action: 'accept',
            content: {
                decision: 'approved',
                approved: true
            },
            decision: 'approved'
        });
    });
});
