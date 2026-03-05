/**
 * Unified MCP bridge setup for Codex local and remote modes.
 *
 * This module provides a single source of truth for starting the hopi MCP
 * bridge server and generating the MCP server configuration that Codex needs.
 */

import { startHappyServer } from '@/claude/utils/startHappyServer';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import type { ApiSessionClient } from '@/api/apiSession';
import { PRODUCT_SLUG } from '@hopi/protocol/brand';

/**
 * MCP server entry configuration.
 */
export interface McpServerEntry {
    command: string;
    args: string[];
}

/**
 * Map of MCP server names to their configurations.
 */
export type McpServersConfig = Record<string, McpServerEntry>;

/**
 * Result of starting the hopi MCP bridge.
 */
export interface HopiMcpBridge {
    /** The running server instance */
    server: {
        url: string;
        stop: () => void;
    };
    /** MCP server config to pass to Codex (works for both CLI and SDK) */
    mcpServers: McpServersConfig;
}

/**
 * Start the hopi MCP bridge server and return the configuration
 * needed to connect Codex to it.
 *
 * This is the single source of truth for MCP bridge setup,
 * used by both local and remote launchers.
 */
export async function buildHopiMcpBridge(client: ApiSessionClient): Promise<HopiMcpBridge> {
    const happyServer = await startHappyServer(client);
    const bridgeCommand = getHappyCliCommand(['mcp', '--url', happyServer.url]);

    return {
        server: {
            url: happyServer.url,
            stop: happyServer.stop
        },
        mcpServers: {
            [PRODUCT_SLUG]: {
                command: bridgeCommand.command,
                args: bridgeCommand.args
            }
        }
    };
}
