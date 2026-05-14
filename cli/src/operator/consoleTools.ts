import { PRODUCT_ENV } from '@hopi/protocol/brand';
import { OPERATOR_TOOL_BRIDGE_VERSION } from '@hopi/protocol/operator-console';
import { configuration } from '@/configuration';
import type { ApiSessionClient } from '@/lib';
import type { McpServerStdio } from '@/agent/types';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';

export const OPERATOR_CONSOLE_CONFIG_ENV = 'HOPI_OPERATOR_CONSOLE_CONFIG';
export const OPERATOR_CONSOLE_SESSION_ID_ENV = 'HOPI_OPERATOR_SESSION_ID';
export const OPERATOR_CONSOLE_PROJECT_ID_ENV = 'HOPI_OPERATOR_PROJECT_ID';
export const OPERATOR_CONSOLE_GOAL_ID_ENV = 'HOPI_OPERATOR_GOAL_ID';
export const OPERATOR_CONSOLE_TASK_ID_ENV = 'HOPI_OPERATOR_TASK_ID';
export const OPERATOR_MCP_SERVER_NAME = 'hopi_operator';

export type OperatorConsoleConfig = {
    projectId: string;
    goalId?: string | null;
    taskId?: string | null;
};

export type OperatorMcpServerConfig = {
    command: string;
    args: string[];
    env?: Record<string, string>;
};

export function hasOperatorMcpServer(
    mcpServers: Record<string, OperatorMcpServerConfig>
): boolean {
    return Object.prototype.hasOwnProperty.call(mcpServers, OPERATOR_MCP_SERVER_NAME);
}

export function buildOperatorToolBridgeMetadataPatch(
    mcpServers: Record<string, OperatorMcpServerConfig>
): { operatorToolBridgeVersion?: number } {
    return hasOperatorMcpServer(mcpServers)
        ? { operatorToolBridgeVersion: OPERATOR_TOOL_BRIDGE_VERSION }
        : {};
}

export function buildOperatorToolBridgeMetadataPatchFromList(
    mcpServers: McpServerStdio[]
): { operatorToolBridgeVersion?: number } {
    return mcpServers.some((server) => server.name === OPERATOR_MCP_SERVER_NAME)
        ? { operatorToolBridgeVersion: OPERATOR_TOOL_BRIDGE_VERSION }
        : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseOperatorConsoleConfig(value: unknown): OperatorConsoleConfig | null {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!isRecord(parsed) || typeof parsed.projectId !== 'string' || !parsed.projectId.trim()) {
            return null;
        }
        return {
            projectId: parsed.projectId.trim(),
            goalId: typeof parsed.goalId === 'string' && parsed.goalId.trim() ? parsed.goalId.trim() : null,
            taskId: typeof parsed.taskId === 'string' && parsed.taskId.trim() ? parsed.taskId.trim() : null
        };
    } catch {
        return null;
    }
}

export function getOperatorConsoleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OperatorConsoleConfig | null {
    return parseOperatorConsoleConfig(env[OPERATOR_CONSOLE_CONFIG_ENV]);
}

function buildOperatorEnv(
    sessionId: string,
    config: OperatorConsoleConfig,
    env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
    return {
        [OPERATOR_CONSOLE_SESSION_ID_ENV]: sessionId,
        [OPERATOR_CONSOLE_PROJECT_ID_ENV]: config.projectId,
        ...(config.goalId ? { [OPERATOR_CONSOLE_GOAL_ID_ENV]: config.goalId } : {}),
        ...(config.taskId ? { [OPERATOR_CONSOLE_TASK_ID_ENV]: config.taskId } : {}),
        [PRODUCT_ENV.API_URL]: env[PRODUCT_ENV.API_URL] ?? configuration.apiUrl,
        ...(configuration.cliApiToken ? { CLI_API_TOKEN: configuration.cliApiToken } : {}),
        ...(env[PRODUCT_ENV.HOME] ? { [PRODUCT_ENV.HOME]: env[PRODUCT_ENV.HOME] } : {})
    };
}

export function buildOperatorMcpServerConfig(
    session: ApiSessionClient,
    env: NodeJS.ProcessEnv = process.env
): Record<string, OperatorMcpServerConfig> {
    const config = getOperatorConsoleConfigFromEnv(env);
    if (!config) {
        return {};
    }
    const command = getHappyCliCommand(['assistant-operator-mcp']);
    return {
        [OPERATOR_MCP_SERVER_NAME]: {
            command: command.command,
            args: command.args,
            env: buildOperatorEnv(session.sessionId, config, env)
        }
    };
}

export function buildOperatorMcpServerList(
    session: ApiSessionClient,
    env: NodeJS.ProcessEnv = process.env
): McpServerStdio[] {
    const servers = buildOperatorMcpServerConfig(session, env);
    return Object.entries(servers).map(([name, server]) => ({
        name,
        command: server.command,
        args: server.args,
        env: Object.entries(server.env ?? {}).map(([envName, value]) => ({
            name: envName,
            value
        }))
    }));
}
