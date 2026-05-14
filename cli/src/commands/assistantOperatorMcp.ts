import axios from 'axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { configuration } from '@/configuration';
import { getAuthToken } from '@/api/auth';
import { initializeToken } from '@/ui/tokenInit';
import {
    OPERATOR_CONSOLE_PROJECT_ID_ENV,
    OPERATOR_CONSOLE_SESSION_ID_ENV
} from '@/operator/consoleTools';
import type { CommandDefinition } from './types';

const projectScopeSchema = z.object({
    projectId: z.string().trim().min(1).optional()
});

const toolSchemas = {
    hopi_project_snapshot: projectScopeSchema.extend({
        goalId: z.string().trim().min(1).nullable().optional()
    }),
    hopi_resolve_decision: projectScopeSchema.extend({
        topicId: z.string().trim().min(1),
        resolution: z.string().trim().min(1).max(20_000)
    }),
    hopi_send_planner_mail: projectScopeSchema.extend({
        goalId: z.string().trim().min(1),
        kind: z.enum(['idea', 'request', 'preference']),
        body: z.string().trim().min(1).max(20_000),
        quote: z.string().trim().max(2_000).optional()
    }),
    hopi_retry_blocked_merge: projectScopeSchema.extend({
        taskId: z.string().trim().min(1),
        note: z.string().trim().max(2_000).optional()
    }),
    hopi_unblock_task: projectScopeSchema.extend({
        taskId: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(2_000),
        userConfirmationQuote: z.string().trim().min(1).max(2_000)
    }),
    hopi_pause_goal_automation: projectScopeSchema.extend({
        goalId: z.string().trim().min(1)
    }),
    hopi_resume_goal_automation: projectScopeSchema.extend({
        goalId: z.string().trim().min(1)
    }),
    hopi_read_preference: projectScopeSchema.extend({
        path: z.string().trim().optional()
    }),
    hopi_write_preference: projectScopeSchema.extend({
        path: z.string().trim().optional(),
        markdown: z.string().trim().min(1).max(50_000)
    })
} as const;

type ToolName = keyof typeof toolSchemas;

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function defaultProjectScope(input: Record<string, unknown>): Record<string, unknown> {
    return {
        projectId: process.env[OPERATOR_CONSOLE_PROJECT_ID_ENV],
        ...input
    };
}

async function callOperatorTool(toolName: ToolName, input: Record<string, unknown>) {
    const sessionId = requiredEnv(OPERATOR_CONSOLE_SESSION_ID_ENV);
    const token = getAuthToken();
    const response = await axios.post(
        `${configuration.apiUrl}/cli/operator-tools/call`,
        {
            sessionId,
            toolName,
            input: defaultProjectScope(input)
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 60_000
        }
    );
    return response.data as unknown;
}

function toolResult(value: unknown, isError = false) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(value, null, 2)
            }
        ],
        isError
    };
}

function registerOperatorTool(
    server: McpServer,
    name: ToolName,
    description: string
): void {
    server.registerTool(
        name,
        {
            description,
            inputSchema: toolSchemas[name]
        },
        async (input: unknown) => {
            try {
                const result = await callOperatorTool(name, input as Record<string, unknown>);
                const ok = typeof result === 'object' && result !== null && 'ok' in result
                    ? (result as { ok?: unknown }).ok === true
                    : true;
                return toolResult(result, !ok);
            } catch (error) {
                const message = axios.isAxiosError(error)
                    ? error.response?.data ?? error.message
                    : error instanceof Error
                        ? error.message
                        : String(error);
                return toolResult({ ok: false, error: message }, true);
            }
        }
    );
}

export const assistantOperatorMcpCommand: CommandDefinition = {
    name: 'assistant-operator-mcp',
    requiresRuntimeAssets: true,
    run: async () => {
        await initializeToken();
        requiredEnv(OPERATOR_CONSOLE_SESSION_ID_ENV);
        requiredEnv(OPERATOR_CONSOLE_PROJECT_ID_ENV);

        const server = new McpServer({
            name: 'hopi-assistant-operator',
            version: '1.0.0'
        });

        registerOperatorTool(server, 'hopi_project_snapshot', 'Read the current HOPI project, goal, task, decision, and preference snapshot.');
        registerOperatorTool(server, 'hopi_resolve_decision', 'Resolve a waiting HOPI decision topic in this assistant scope.');
        registerOperatorTool(server, 'hopi_send_planner_mail', 'Send scoped operator guidance mail to the planner.');
        registerOperatorTool(server, 'hopi_retry_blocked_merge', 'Retry a blocked auto-merge for a task in this assistant scope.');
        registerOperatorTool(server, 'hopi_unblock_task', 'Move a user-confirmed non-merge, non-decision blocked task back to planned.');
        registerOperatorTool(server, 'hopi_pause_goal_automation', 'Pause goal automation for a scoped goal.');
        registerOperatorTool(server, 'hopi_resume_goal_automation', 'Resume goal automation for a scoped goal.');
        registerOperatorTool(server, 'hopi_read_preference', 'Read the global .hopi/preference.md preference memory.');
        registerOperatorTool(server, 'hopi_write_preference', 'Replace the global .hopi/preference.md preference memory.');

        await server.connect(new StdioServerTransport());
    }
};
