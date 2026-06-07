import { describe, expect, it, vi } from 'vitest';

import { registerAppServerPermissionHandlers } from './appServerPermissionAdapter';

function createClientStub() {
    const handlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();

    return {
        client: {
            registerRequestHandler(method: string, handler: (params: unknown) => Promise<unknown> | unknown) {
                handlers.set(method, handler);
            }
        },
        handlers
    };
}

describe('registerAppServerPermissionHandlers', () => {
    it('auto-approves MCP tool approval prompts via the permission handler', async () => {
        const { client, handlers } = createClientStub();
        const handleToolCall = vi.fn(async () => ({ decision: 'approved' as const }));

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: { handleToolCall } as never
        });

        const handler = handlers.get('item/tool/requestUserInput');
        expect(handler).toBeTypeOf('function');

        const response = await handler?.({
            id: 'approval-1',
            request: {
                message: 'Allow the hopi_goal_assistant MCP server to run tool "read_goal_snapshot"?',
                requestedSchema: {
                    type: 'object',
                    properties: {}
                },
                _meta: {
                    codex_approval_kind: 'mcp_tool_call',
                    tool_title: 'Read goal snapshot',
                    tool_description: 'Read the current goal control-plane snapshot.'
                }
            }
        });

        expect(handleToolCall).toHaveBeenCalledWith(
            'approval-1',
            'Read goal snapshot',
            expect.objectContaining({
                message: 'Allow the hopi_goal_assistant MCP server to run tool "read_goal_snapshot"?',
                toolDescription: 'Read the current goal control-plane snapshot.'
            })
        );
        expect(response).toEqual({
            decision: 'accept',
            answers: {}
        });
    });

    it('maps denied MCP approvals to decline', async () => {
        const { client, handlers } = createClientStub();
        const handleToolCall = vi.fn(async () => ({ decision: 'denied' as const, reason: 'Not allowed' }));

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: { handleToolCall } as never
        });

        const handler = handlers.get('item/tool/requestUserInput');
        const response = await handler?.({
            request: {
                requestedSchema: {
                    type: 'object',
                    properties: {
                        approved: { type: 'boolean' }
                    }
                },
                _meta: {
                    codex_approval_kind: 'mcp_tool_call',
                    tool_title: 'Dangerous tool'
                }
            }
        });

        expect(response).toEqual({
            decision: 'decline'
        });
    });

    it('falls back to the generic user-input handler for non-approval prompts', async () => {
        const { client, handlers } = createClientStub();
        const onUserInputRequest = vi.fn(async () => ({
            choice: ['continue']
        }));

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: { handleToolCall: vi.fn() } as never,
            onUserInputRequest
        });

        const handler = handlers.get('item/tool/requestUserInput');
        const params = {
            request: {
                message: 'Choose next step'
            }
        };
        const response = await handler?.(params);

        expect(onUserInputRequest).toHaveBeenCalledWith(params);
        expect(response).toEqual({
            decision: 'accept',
            answers: {
                choice: ['continue']
            }
        });
    });

    it('auto-approves MCP elicitation requests with action/content', async () => {
        const { client, handlers } = createClientStub();
        const handleToolCall = vi.fn(async () => ({ decision: 'approved' as const }));

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: { handleToolCall } as never
        });

        const handler = handlers.get('mcpServer/elicitation/request');
        const response = await handler?.({
            requestId: 'approval-2',
            request: {
                message: 'Allow MCP tool?',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        allow: { type: 'boolean' }
                    }
                },
                _meta: {
                    codex_approval_kind: 'mcp_tool_call',
                    tool_title: 'Read goal snapshot'
                }
            }
        });

        expect(handleToolCall).toHaveBeenCalledWith(
            'approval-2',
            'Read goal snapshot',
            expect.objectContaining({
                message: 'Allow MCP tool?'
            })
        );
        expect(response).toEqual({
            action: 'accept',
            content: {
                allow: true
            }
        });
    });

    it('cancels generic elicitation requests when no handler is registered', async () => {
        const { client, handlers } = createClientStub();

        registerAppServerPermissionHandlers({
            client: client as never,
            permissionHandler: { handleToolCall: vi.fn() } as never
        });

        const handler = handlers.get('mcpServer/elicitation/request');
        const response = await handler?.({
            request: {
                message: 'Need operator input'
            }
        });

        expect(response).toEqual({
            action: 'cancel'
        });
    });
});
