import { describe, expect, it } from 'vitest';

import { CodexPermissionHandler } from './permissionHandler';

type FakeAgentState = {
    controlledByUser?: boolean;
    requests: Record<string, unknown>;
    completedRequests: Record<string, unknown>;
};

function createClient() {
    let state: FakeAgentState = {
        requests: {},
        completedRequests: {}
    };

    const rpcHandlers = new Map<string, (params: unknown) => unknown>();

    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: (params: unknown) => unknown) {
                rpcHandlers.set(method, handler);
            }
        },
        updateAgentState(handler: (current: FakeAgentState) => FakeAgentState) {
            state = handler(state);
        }
    };

    return {
        client,
        getState: () => state,
        rpcHandlers
    };
}

describe('CodexPermissionHandler', () => {
    it('auto-approves new requests in yolo mode', async () => {
        const { client, getState } = createClient();

        let mode: any = 'yolo';
        const handler = new CodexPermissionHandler(
            client as any,
            () => mode
        );

        const result = await handler.handleToolCall('req-1', 'CodexBash', { command: 'echo hello' });
        expect(result.decision).toBe('approved_for_session');

        const state = getState();
        expect(state.requests).toEqual({});
        expect(Object.keys(state.completedRequests)).toEqual(['req-1']);
    });

    it('auto-approves pending requests after switching to yolo', async () => {
        const { client, getState } = createClient();

        let mode: any = 'default';
        const handler = new CodexPermissionHandler(
            client as any,
            () => mode
        );

        const pendingPromise = handler.handleToolCall('req-2', 'CodexPatch', { changes: { 'a.txt': 'hi' } });

        // Pending request registered (default mode).
        expect(Object.keys(getState().requests)).toEqual(['req-2']);

        // Switch mode and reconcile.
        mode = 'yolo';
        handler.reconcileAutoApprovals();

        const resolved = await pendingPromise;
        expect(resolved.decision).toBe('approved_for_session');

        const state = getState();
        expect(state.requests).toEqual({});
        expect(Object.keys(state.completedRequests)).toContain('req-2');
    });
});

