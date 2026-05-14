import { describe, expect, it } from 'vitest';
import { PRODUCT_ENV } from '@hopi/protocol/brand';
import {
    buildOperatorToolBridgeMetadataPatch,
    buildOperatorToolBridgeMetadataPatchFromList,
    buildOperatorMcpServerConfig,
    buildOperatorMcpServerList,
    OPERATOR_CONSOLE_CONFIG_ENV,
    OPERATOR_CONSOLE_GOAL_ID_ENV,
    OPERATOR_CONSOLE_PROJECT_ID_ENV,
    OPERATOR_CONSOLE_SESSION_ID_ENV,
    OPERATOR_MCP_SERVER_NAME
} from './consoleTools';
import type { ApiSessionClient } from '@/lib';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';

describe('operator console tool config', () => {
    it('builds a scoped MCP server config from runner operator env', () => {
        const session = { sessionId: 'session-1' } as ApiSessionClient;
        const mcpCommand = getHappyCliCommand(['assistant-operator-mcp']);
        const servers = buildOperatorMcpServerConfig(session, {
            [OPERATOR_CONSOLE_CONFIG_ENV]: JSON.stringify({
                projectId: 'project-1',
                goalId: 'goal-1'
            }),
            [PRODUCT_ENV.API_URL]: 'http://hub.test'
        });

        expect(servers[OPERATOR_MCP_SERVER_NAME]).toMatchObject({
            command: mcpCommand.command,
            args: mcpCommand.args,
            env: {
                [OPERATOR_CONSOLE_SESSION_ID_ENV]: 'session-1',
                [OPERATOR_CONSOLE_PROJECT_ID_ENV]: 'project-1',
                [OPERATOR_CONSOLE_GOAL_ID_ENV]: 'goal-1',
                [PRODUCT_ENV.API_URL]: 'http://hub.test'
            }
        });
    });

    it('omits operator MCP config when the session is not an operator console', () => {
        const session = { sessionId: 'session-1' } as ApiSessionClient;

        expect(buildOperatorMcpServerConfig(session, {})).toEqual({});
    });

    it('marks sessions that were started with the operator MCP bridge', () => {
        const session = { sessionId: 'session-1' } as ApiSessionClient;
        const servers = buildOperatorMcpServerConfig(session, {
            [OPERATOR_CONSOLE_CONFIG_ENV]: JSON.stringify({ projectId: 'project-1' })
        });

        expect(buildOperatorToolBridgeMetadataPatch(servers)).toEqual({
            operatorToolBridgeVersion: 1
        });
        expect(buildOperatorToolBridgeMetadataPatchFromList(buildOperatorMcpServerList(session, {
            [OPERATOR_CONSOLE_CONFIG_ENV]: JSON.stringify({ projectId: 'project-1' })
        }))).toEqual({
            operatorToolBridgeVersion: 1
        });
        expect(buildOperatorToolBridgeMetadataPatch({})).toEqual({});
        expect(buildOperatorToolBridgeMetadataPatchFromList([])).toEqual({});
    });
});
