import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

const harness = vi.hoisted(() => ({
    notifications: [] as Array<{ method: string; params: unknown }>,
    registerRequestCalls: [] as string[],
    startTurnParams: [] as Array<Record<string, unknown>>,
    failOnCollaboration: false,
    emitPlanUpdate: false
}));

vi.mock('./codexAppServerClient', () => {
    class MockCodexAppServerClient {
        private notificationHandler: ((method: string, params: unknown) => void) | null = null;

        async connect(): Promise<void> {}

        async initialize(): Promise<{ protocolVersion: number }> {
            return { protocolVersion: 1 };
        }

        setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
            this.notificationHandler = handler;
        }

        registerRequestHandler(method: string): void {
            harness.registerRequestCalls.push(method);
        }

        async startThread(): Promise<{ thread: { id: string } }> {
            return { thread: { id: 'thread-anonymous' } };
        }

        async resumeThread(): Promise<{ thread: { id: string } }> {
            return { thread: { id: 'thread-anonymous' } };
        }

        async startTurn(params: Record<string, unknown>): Promise<{ turn: Record<string, never> }> {
            harness.startTurnParams.push(params);
            if (harness.failOnCollaboration && 'collaborationMode' in params) {
                throw new Error('Invalid params: unknown field collaborationMode');
            }
            const started = { turn: {} };
            harness.notifications.push({ method: 'turn/started', params: started });
            this.notificationHandler?.('turn/started', started);

            if (harness.emitPlanUpdate) {
                const planUpdated = {
                    turnId: 'turn-plan-1',
                    explanation: 'Split work into plan steps.',
                    plan: [
                        { step: 'Inspect files', status: 'pending' },
                        { step: 'Apply patch', status: 'inProgress' }
                    ]
                };
                harness.notifications.push({ method: 'turn/plan/updated', params: planUpdated });
                this.notificationHandler?.('turn/plan/updated', planUpdated);
            }

            const completed = { status: 'Completed', turn: {} };
            harness.notifications.push({ method: 'turn/completed', params: completed });
            this.notificationHandler?.('turn/completed', completed);

            return { turn: {} };
        }

        async interruptTurn(): Promise<Record<string, never>> {
            return {};
        }

        async disconnect(): Promise<void> {}
    }

    return { CodexAppServerClient: MockCodexAppServerClient };
});

vi.mock('./utils/buildHopiMcpBridge', () => ({
    buildHopiMcpBridge: async () => ({
        server: {
            stop: () => {}
        },
        mcpServers: {}
    })
}));

import { codexRemoteLauncher } from './codexRemoteLauncher';

type FakeAgentState = {
    requests: Record<string, unknown>;
    completedRequests: Record<string, unknown>;
};

function createMode(collaborationMode?: EnhancedMode['collaborationMode']): EnhancedMode {
    return {
        permissionMode: 'default',
        ...(collaborationMode ? { collaborationMode } : {})
    };
}

function createSessionStub(mode: EnhancedMode = createMode()) {
    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
    queue.push('hello from launcher test', mode);
    queue.close();

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const codexMessages: unknown[] = [];
    const thinkingChanges: boolean[] = [];
    const foundSessionIds: string[] = [];
    let agentState: FakeAgentState = {
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
        updateAgentState(handler: (state: FakeAgentState) => FakeAgentState) {
            agentState = handler(agentState);
        },
        sendCodexMessage(message: unknown) {
            codexMessages.push(message);
        },
        sendUserMessage(_text: string) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            sessionEvents.push(event);
        }
    };

    const session = {
        path: '/tmp/hopi-update',
        logPath: '/tmp/hopi-update/test.log',
        client,
        queue,
        codexArgs: undefined,
        codexCliOverrides: undefined,
        sessionId: null as string | null,
        permissionMode: 'default' as EnhancedMode['permissionMode'],
        getPermissionMode() {
            return session.permissionMode;
        },
        setPermissionHandler(_handler: unknown) {},
        thinking: false,
        onThinkingChange(nextThinking: boolean) {
            session.thinking = nextThinking;
            thinkingChanges.push(nextThinking);
        },
        onSessionFound(id: string) {
            session.sessionId = id;
            foundSessionIds.push(id);
        },
        sendCodexMessage(message: unknown) {
            client.sendCodexMessage(message);
        },
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(text: string) {
            client.sendUserMessage(text);
        }
    };

    return {
        session,
        sessionEvents,
        codexMessages,
        thinkingChanges,
        foundSessionIds,
        rpcHandlers,
        getAgentState: () => agentState
    };
}

describe('codexRemoteLauncher', () => {
    afterEach(() => {
        harness.notifications = [];
        harness.registerRequestCalls = [];
        harness.startTurnParams = [];
        harness.failOnCollaboration = false;
        harness.emitPlanUpdate = false;
        delete process.env.CODEX_USE_MCP_SERVER;
    });

    it('finishes a turn and emits ready when task lifecycle events omit turn_id', async () => {
        delete process.env.CODEX_USE_MCP_SERVER;
        const {
            session,
            sessionEvents,
            thinkingChanges,
            foundSessionIds
        } = createSessionStub();

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(foundSessionIds).toContain('thread-anonymous');
        expect(harness.notifications.map((entry) => entry.method)).toEqual(['turn/started', 'turn/completed']);
        const readyEvents = sessionEvents.filter((event) => event.type === 'ready');
        expect(readyEvents.length).toBeGreaterThanOrEqual(1);
        expect(readyEvents.every((event) => event.hasAssistantReply === false)).toBe(true);
        expect(thinkingChanges).toContain(true);
        expect(session.thinking).toBe(false);
    });

    it('retries without collaboration mode when app-server rejects collaborationMode', async () => {
        harness.failOnCollaboration = true;
        const {
            session,
            sessionEvents
        } = createSessionStub(createMode('plan'));

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnParams).toHaveLength(2);
        expect(harness.startTurnParams[0]).toHaveProperty('collaborationMode');
        expect(harness.startTurnParams[1]).not.toHaveProperty('collaborationMode');
        expect(sessionEvents.some((event) => event.type === 'message' && event.message === 'Process exited unexpectedly')).toBe(false);
        expect(
            sessionEvents.some((event) =>
                event.type === 'message'
                && typeof event.message === 'string'
                && event.message.includes('Falling back to default mode')
            )
        ).toBe(true);
    });

    it('emits codex plan messages for turn plan updates', async () => {
        harness.emitPlanUpdate = true;
        const {
            session,
            codexMessages,
            sessionEvents
        } = createSessionStub(createMode('plan'));

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(
            codexMessages.some((message) => {
                if (!message || typeof message !== 'object') return false;
                const record = message as Record<string, unknown>;
                return record.type === 'plan'
                    && Array.isArray(record.entries)
                    && record.entries.length === 2;
            })
        ).toBe(true);
        const readyEvents = sessionEvents.filter((event) => event.type === 'ready');
        expect(readyEvents.length).toBeGreaterThanOrEqual(1);
        expect(readyEvents.some((event) => event.hasAssistantReply === true)).toBe(true);
    });
});
