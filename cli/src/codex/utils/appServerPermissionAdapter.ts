import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';
import type { CodexPermissionHandler } from './permissionHandler';
import type { CodexAppServerClient } from '../codexAppServerClient';

type PermissionDecision = 'approved' | 'approved_for_session' | 'denied' | 'abort';

type PermissionResult = {
    decision: PermissionDecision;
    reason?: string;
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

function mapUserInputDecision(decision: PermissionDecision): { decision: 'accept' | 'decline' | 'cancel' } {
    switch (decision) {
        case 'approved':
        case 'approved_for_session':
            return { decision: 'accept' };
        case 'denied':
            return { decision: 'decline' };
        case 'abort':
            return { decision: 'cancel' };
    }
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const items = value.filter((entry): entry is string => typeof entry === 'string');
    return items.length > 0 ? items : undefined;
}

function extractUserInputRequest(record: Record<string, unknown>): Record<string, unknown> {
    return asRecord(record.request) ?? record;
}

function extractUserInputMeta(record: Record<string, unknown>): Record<string, unknown> | null {
    const request = extractUserInputRequest(record);
    return asRecord(request._meta);
}

function isMcpToolApprovalUserInput(record: Record<string, unknown>): boolean {
    const meta = extractUserInputMeta(record);
    return asString(meta?.codex_approval_kind) === 'mcp_tool_call';
}

function extractRequestedSchemaProperties(record: Record<string, unknown>): string[] {
    const request = extractUserInputRequest(record);
    const requestedSchema = asRecord(request.requestedSchema ?? request.requested_schema);
    const properties = asRecord(requestedSchema?.properties);
    return properties ? Object.keys(properties) : [];
}

function buildApprovalAnswers(record: Record<string, unknown>, decision: PermissionDecision): Record<string, string[]> {
    const propertyKeys = extractRequestedSchemaProperties(record);
    if (propertyKeys.length === 0) {
        return {};
    }

    const approved = decision === 'approved' || decision === 'approved_for_session';
    const answers: Record<string, string[]> = {};

    for (const key of propertyKeys) {
        if (key === 'decision') {
            answers[key] = [decision];
            continue;
        }
        if (key === 'approved' || key === 'allow') {
            answers[key] = [approved ? 'true' : 'false'];
        }
    }

    return answers;
}

function buildApprovalContent(record: Record<string, unknown>, decision: PermissionDecision): Record<string, string | boolean> {
    const propertyKeys = extractRequestedSchemaProperties(record);
    if (propertyKeys.length === 0) {
        return {};
    }

    const approved = decision === 'approved' || decision === 'approved_for_session';
    const content: Record<string, string | boolean> = {};

    for (const key of propertyKeys) {
        if (key === 'decision') {
            content[key] = decision;
            continue;
        }
        if (key === 'approved' || key === 'allow') {
            content[key] = approved;
        }
    }

    return content;
}

function buildPermissionPrompt(record: Record<string, unknown>): {
    toolCallId: string;
    toolName: string;
    payload: {
        message?: string;
        toolDescription?: string;
        persist?: string[];
        request: Record<string, unknown>;
    };
} {
    const meta = extractUserInputMeta(record);
    const request = extractUserInputRequest(record);
    const toolCallId = asString(record.id)
        ?? asString(record.requestId)
        ?? asString(meta?.mcp_tool_call_id)
        ?? asString(meta?.codex_mcp_tool_call_id)
        ?? randomUUID();
    const toolName = asString(meta?.tool_title) ?? 'CodexMcpTool';
    return {
        toolCallId,
        toolName,
        payload: {
            message: asString(request.message),
            toolDescription: asString(meta?.tool_description),
            persist: asStringArray(meta?.persist),
            request
        }
    };
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
        const record = asRecord(params) ?? {};

        if (isMcpToolApprovalUserInput(record)) {
            const prompt = buildPermissionPrompt(record);
            const result = await permissionHandler.handleToolCall(
                prompt.toolCallId,
                prompt.toolName,
                prompt.payload
            ) as PermissionResult;

            const mappedDecision = mapUserInputDecision(result.decision);
            return mappedDecision.decision === 'accept'
                ? {
                    ...mappedDecision,
                    answers: buildApprovalAnswers(record, result.decision)
                }
                : mappedDecision;
        }

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

        if (isMcpToolApprovalUserInput(record)) {
            const prompt = buildPermissionPrompt(record);
            const result = await permissionHandler.handleToolCall(
                prompt.toolCallId,
                prompt.toolName,
                prompt.payload
            ) as PermissionResult;

            const action = mapUserInputDecision(result.decision).decision;
            return action === 'accept'
                ? {
                    action,
                    content: buildApprovalContent(record, result.decision)
                }
                : { action };
        }

        if (!onUserInputRequest) {
            logger.debug('[CodexAppServer] No elicitation handler registered; cancelling request');
            return { action: 'cancel' };
        }

        const answers = await onUserInputRequest(params);
        const content: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(answers)) {
            content[key] = value.length === 1 ? value[0] : value;
        }
        return {
            action: 'accept',
            content
        };
    });
}
