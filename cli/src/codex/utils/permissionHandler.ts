/**
 * Permission Handler for Codex tool approval integration
 * 
 * Handles tool permission requests and responses for Codex sessions.
 * Simpler than Claude's permission handler since we get tool IDs directly.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { PermissionMode } from "@hopi/protocol/types";
import {
    BasePermissionHandler,
    type PendingPermissionRequest,
    type PermissionCompletion
} from "@/modules/common/permission/BasePermissionHandler";

interface PermissionResponse {
    id: string;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    reason?: string;
}

interface PermissionResult {
    decision: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    reason?: string;
}

const HOPI_OPERATOR_MCP_TOOL_PREFIX = 'mcp__hopi_operator__';

type CodexPermissionHandlerOptions = {
    getDisallowedTools?: () => string[] | undefined;
    onRequest?: (request: { id: string; toolName: string; input: unknown }) => void;
    onComplete?: (result: {
        id: string;
        toolName: string;
        input: unknown;
        approved: boolean;
        decision: PermissionResult['decision'];
        reason?: string;
    }) => void;
};

export class CodexPermissionHandler extends BasePermissionHandler<PermissionResponse, PermissionResult> {
    constructor(
        session: ApiSessionClient,
        private readonly getPermissionMode: () => PermissionMode | undefined,
        private readonly options?: CodexPermissionHandlerOptions
    ) {
        super(session);
    }

    private isToolDisallowed(toolName: string): boolean {
        const disallowedTools = this.options?.getDisallowedTools?.() ?? [];
        if (disallowedTools.length === 0) {
            return false;
        }
        const normalizedToolName = toolName.trim().toLowerCase();
        return disallowedTools.some((tool) => tool.trim().toLowerCase() === normalizedToolName);
    }

    private completeImmediateRequest(
        toolCallId: string,
        toolName: string,
        input: unknown,
        result: PermissionResult,
        completion: {
            approved: boolean;
            status: 'approved' | 'denied';
            mode: PermissionMode;
            reason?: string;
        }
    ): void {
        this.options?.onRequest?.({ id: toolCallId, toolName, input });
        this.options?.onComplete?.({
            id: toolCallId,
            toolName,
            input,
            approved: completion.approved,
            decision: result.decision,
            reason: result.reason
        });

        this.client.updateAgentState((currentState) => ({
            ...currentState,
            completedRequests: {
                ...currentState.completedRequests,
                [toolCallId]: {
                    tool: toolName,
                    arguments: input,
                    createdAt: Date.now(),
                    completedAt: Date.now(),
                    status: completion.status,
                    mode: completion.mode,
                    decision: result.decision,
                    reason: completion.reason
                }
            }
        }));
    }

    protected override onRequestRegistered(id: string, toolName: string, input: unknown): void {
        this.options?.onRequest?.({ id, toolName, input });
    }

    /**
     * Handle a tool permission request
     * @param toolCallId - The unique ID of the tool call
     * @param toolName - The name of the tool being called
     * @param input - The input parameters for the tool
     * @returns Promise resolving to permission result
     */
    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown
    ): Promise<PermissionResult> {
        const mode = this.getPermissionMode() ?? 'default';
        if (this.isToolDisallowed(toolName)) {
            const reason = 'Tool is disallowed for this operator console session';
            const result: PermissionResult = { decision: 'denied', reason };
            this.completeImmediateRequest(toolCallId, toolName, input, result, {
                approved: false,
                status: 'denied',
                mode,
                reason
            });
            logger.debug(`[Codex] Denied disallowed tool ${toolName} (${toolCallId}) mode=${mode}`);
            return result;
        }

        if (toolName.trim().toLowerCase().startsWith(HOPI_OPERATOR_MCP_TOOL_PREFIX)) {
            const result: PermissionResult = { decision: 'approved' };
            this.completeImmediateRequest(toolCallId, toolName, input, result, {
                approved: true,
                status: 'approved',
                mode
            });
            logger.debug(`[Codex] Auto-approved HOPI operator tool ${toolName} (${toolCallId}) mode=${mode}`);
            return result;
        }

        const autoDecision = this.resolveAutoApprovalDecision(mode, toolName, toolCallId);
        if (autoDecision) {
            const result: PermissionResult = { decision: autoDecision };
            this.completeImmediateRequest(toolCallId, toolName, input, result, {
                approved: true,
                status: 'approved',
                mode
            });

            logger.debug(`[Codex] Auto-approved ${toolName} (${toolCallId}) mode=${mode} decision=${result.decision}`);
            return result;
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            // Store the pending request
            this.addPendingRequest(toolCallId, toolName, input, { resolve, reject });

            // Send push notification
            // this.session.api.push().sendToAllDevices(
            //     'Permission Request',
            //     `Codex wants to use ${toolName}`,
            //     {
            //         sessionId: this.session.sessionId,
            //         requestId: toolCallId,
            //         tool: toolName,
            //         type: 'permission_request'
            //     }
            // );

            logger.debug(`[Codex] Permission request sent for tool: ${toolName} (${toolCallId})`);
        });
    }

    reconcileAutoApprovals(): void {
        const mode = this.getPermissionMode() ?? 'default';
        if (this.pendingRequests.size === 0) {
            return;
        }

        for (const [id, pending] of Array.from(this.pendingRequests.entries())) {
            if (this.isToolDisallowed(pending.toolName)) {
                this.pendingRequests.delete(id);
                const reason = 'Tool is disallowed for this operator console session';
                const result: PermissionResult = { decision: 'denied', reason };
                this.options?.onComplete?.({
                    id,
                    toolName: pending.toolName,
                    input: pending.input,
                    approved: false,
                    decision: result.decision,
                    reason
                });
                pending.resolve(result);
                this.finalizeRequest(id, {
                    status: 'denied',
                    mode,
                    decision: result.decision,
                    reason
                });
                logger.debug(`[Codex] Denied pending disallowed ${pending.toolName} (${id}) mode=${mode}`);
                continue;
            }

            if (pending.toolName.trim().toLowerCase().startsWith(HOPI_OPERATOR_MCP_TOOL_PREFIX)) {
                this.pendingRequests.delete(id);
                const result: PermissionResult = { decision: 'approved' };
                this.options?.onComplete?.({
                    id,
                    toolName: pending.toolName,
                    input: pending.input,
                    approved: true,
                    decision: result.decision
                });
                pending.resolve(result);
                this.finalizeRequest(id, {
                    status: 'approved',
                    mode,
                    decision: result.decision
                });
                logger.debug(`[Codex] Auto-approved pending HOPI operator tool ${pending.toolName} (${id}) mode=${mode}`);
                continue;
            }

            const autoDecision = this.resolveAutoApprovalDecision(mode, pending.toolName, id);
            if (!autoDecision) {
                continue;
            }

            this.pendingRequests.delete(id);
            const result: PermissionResult = { decision: autoDecision };

            // Surface completion to UI (tool-call-result etc.)
            this.options?.onComplete?.({
                id,
                toolName: pending.toolName,
                input: pending.input,
                approved: true,
                decision: autoDecision
            });

            pending.resolve(result);

            this.finalizeRequest(id, {
                status: 'approved',
                mode,
                decision: autoDecision
            });

            logger.debug(`[Codex] Auto-approved pending ${pending.toolName} (${id}) mode=${mode} decision=${autoDecision}`);
        }
    }

    /**
     * Handle permission responses
     */
    protected async handlePermissionResponse(
        response: PermissionResponse,
        pending: PendingPermissionRequest<PermissionResult>
    ): Promise<PermissionCompletion> {
        const reason = typeof response.reason === 'string' ? response.reason : undefined;
        const result: PermissionResult = response.approved
            ? {
                decision: response.decision === 'approved_for_session' ? 'approved_for_session' : 'approved',
                reason
            }
            : {
                decision: response.decision === 'denied' ? 'denied' : 'abort',
                reason
            };

        pending.resolve(result);
        logger.debug(`[Codex] Permission ${response.approved ? 'approved' : 'denied'} for ${pending.toolName}`);

        this.options?.onComplete?.({
            id: response.id,
            toolName: pending.toolName,
            input: pending.input,
            approved: response.approved,
            decision: result.decision,
            reason: result.reason
        });

        return {
            status: response.approved ? 'approved' : 'denied',
            decision: result.decision,
            reason: result.reason
        };
    }

    protected handleMissingPendingResponse(_response: PermissionResponse): void {
        logger.debug('[Codex] Permission request not found or already resolved');
    }

    /**
     * Reset state for new sessions
     */
    reset(): void {
        this.cancelPendingRequests({
            completedReason: 'Session reset',
            rejectMessage: 'Session reset'
        });

        logger.debug('[Codex] Permission handler reset');
    }
}
