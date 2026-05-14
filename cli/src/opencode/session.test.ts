import { describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { Metadata } from '@/api/types';
import type { ApiClient, ApiSessionClient } from '@/lib';
import { OPERATOR_TOOL_BRIDGE_VERSION } from '@hopi/protocol/operator-console';
import { OpencodeSession } from './session';

describe('OpencodeSession', () => {
    it('marks metadata when started with the operator MCP bridge', () => {
        let metadata: Metadata = {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'opencode'
        };
        const client = {
            sessionId: 'hopi-session-1',
            keepAlive: vi.fn(),
            updateMetadata: (update: (current: Metadata) => Metadata) => {
                metadata = update(metadata);
            }
        } as unknown as ApiSessionClient;
        const session = new OpencodeSession({
            api: {} as ApiClient,
            client,
            path: '/tmp/project',
            logPath: '/tmp/opencode.log',
            sessionId: null,
            messageQueue: new MessageQueue2(() => 'mode'),
            onModeChange: vi.fn(),
            mode: 'remote',
            startedBy: 'runner',
            startingMode: 'remote',
            mcpServers: [{
                name: 'hopi_operator',
                command: 'hopi',
                args: ['assistant-operator-mcp'],
                env: []
            }]
        });

        session.onSessionFound('opencode-session-1');
        session.stopKeepAlive();

        expect(metadata).toMatchObject({
            opencodeSessionId: 'opencode-session-1',
            operatorToolBridgeVersion: OPERATOR_TOOL_BRIDGE_VERSION
        });
    });
});
