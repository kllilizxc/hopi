import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';
import type { CodexPermissionHandler } from './permissionHandler';
import type { CodexAppServerClient } from '../codexAppServerClient';

type PermissionDecision = 'approved' | 'approved_for_session' | 'denied' | 'abort';

type PermissionResult = {
    decision: PermissionDecision;
    reason?: string;
};

type ElicitResponseValue = string | number | boolean | string[];

type ElicitRequestedSchema = {
    properties?: Record<string, unknown>;
    required?: string[];
    type?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractRequestedSchema(params: Record<string, unknown>): ElicitRequestedSchema | null {
    const raw = asRecord(params.requestedSchema ?? params.requested_schema);
    if (!raw) return null;
    const properties = asRecord(raw.properties) ?? undefined;
    const required = Array.isArray(raw.required)
        ? raw.required.filter((item): item is string => typeof item === 'string')
        : undefined;
    const type = asString(raw.type);
    return { type, properties, required };
}

function extractToolCallId(params: Record<string, unknown>): string | undefined {
    const keys = [
        'mcpToolCallId',
        'mcp_tool_call_id',
        'codexMcpToolCallId',
        'codex_mcp_tool_call_id',
        'toolCallId',
        'tool_call_id',
        'callId',
        'call_id',
        'itemId',
        'item_id',
        'id'
    ];

    for (const key of keys) {
        const value = asString(params[key]);
        if (value) return value;
    }

    return undefined;
}

function buildMcpPermissionToolName(params: Record<string, unknown>): string {
    const server = asString(params.server ?? params.serverName ?? params.server_name ?? params.mcpServerName ?? params.mcp_server_name);
    const tool = asString(params.tool ?? params.toolName ?? params.tool_name ?? params.name);

    if (server && tool) {
        return `mcp__${server}__${tool}`;
    }

    return tool ?? 'CodexPermission';
}

function mapDecision(decision: PermissionDecision): { decision: string } {
    switch (decision) {
        case 'approved':
            return { decision: 'accept' };
        case 'approved_for_session':
            return { decision: 'acceptForSession' };
        case 'denied':
            return { decision: 'decline' };
        case 'abort':
            return { decision: 'cancel' };
    }
}

function buildElicitationResult(
    decision: PermissionDecision,
    requestedSchema: ElicitRequestedSchema | null,
    reason?: string
): {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, ElicitResponseValue>;
    decision: PermissionDecision;
    reason?: string;
} {
    const action: 'accept' | 'decline' | 'cancel' =
        decision === 'approved' || decision === 'approved_for_session'
            ? 'accept'
            : decision === 'abort'
                ? 'cancel'
                : 'decline';

    const base = reason
        ? { action, decision, reason }
        : { action, decision };

    if (action !== 'accept' || !requestedSchema?.properties || Object.keys(requestedSchema.properties).length === 0) {
        return base;
    }

    const content: Record<string, ElicitResponseValue> = {};
    const approved = decision === 'approved' || decision === 'approved_for_session';

    if (Object.prototype.hasOwnProperty.call(requestedSchema.properties, 'decision')) {
        content.decision = decision;
    }
    if (Object.prototype.hasOwnProperty.call(requestedSchema.properties, 'approved')) {
        content.approved = approved;
    }
    if (Object.prototype.hasOwnProperty.call(requestedSchema.properties, 'allow')) {
        content.allow = approved;
    }
    if (reason && Object.prototype.hasOwnProperty.call(requestedSchema.properties, 'reason')) {
        content.reason = reason;
    }
    if (Object.keys(content).length === 0) {
        const [fallbackKey] = Object.keys(requestedSchema.properties);
        if (fallbackKey) {
            content[fallbackKey] = decision;
        }
    }

    return { ...base, content };
}

export function registerAppServerPermissionHandlers(args: {
    client: CodexAppServerClient;
    permissionHandler: CodexPermissionHandler;
    onUserInputRequest?: (request: unknown) => Promise<Record<string, string[]>>;
}): void {
    const { client, permissionHandler, onUserInputRequest } = args;

    client.registerRequestHandler('item/commandExecution/requestApproval', async (params) => {
        const record = asRecord(params) ?? {};
        const toolCallId = asString(record.itemId) ?? randomUUID();
        const reason = asString(record.reason);
        const command = record.command;
        const cwd = asString(record.cwd);

        const result = await permissionHandler.handleToolCall(
            toolCallId,
            'CodexBash',
            {
                message: reason,
                command,
                cwd
            }
        ) as PermissionResult;

        return mapDecision(result.decision);
    });

    client.registerRequestHandler('item/fileChange/requestApproval', async (params) => {
        const record = asRecord(params) ?? {};
        const toolCallId = asString(record.itemId) ?? randomUUID();
        const reason = asString(record.reason);
        const grantRoot = asString(record.grantRoot);

        const result = await permissionHandler.handleToolCall(
            toolCallId,
            'CodexPatch',
            {
                message: reason,
                grantRoot
            }
        ) as PermissionResult;

        return mapDecision(result.decision);
    });

    client.registerRequestHandler('item/tool/requestUserInput', async (params) => {
        if (!onUserInputRequest) {
            logger.debug('[CodexAppServer] No user-input handler registered; cancelling request');
            return { decision: 'cancel' };
        }

        const answers = await onUserInputRequest(params);
        return {
            decision: 'accept',
            answers
        };
    });

    client.registerRequestHandler('mcpServer/elicitation/request', async (params) => {
        const record = asRecord(params) ?? {};
        const toolCallId = extractToolCallId(record) ?? randomUUID();
        const toolName = buildMcpPermissionToolName(record);
        const result = await permissionHandler.handleToolCall(
            toolCallId,
            toolName,
            record
        ) as PermissionResult;

        return buildElicitationResult(result.decision, extractRequestedSchema(record), result.reason);
    });
}
