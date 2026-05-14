import type { CodexSessionConfig } from '../types';
import type { EnhancedMode } from '../loop';
import type { CodexCliOverrides } from './codexCliOverrides';
import { resolveCodexModelSpec } from './codexModelConfig';
import { codexSystemPrompt } from './systemPrompt';

function hasHardToolRestrictions(mode: EnhancedMode): boolean {
    return Array.isArray(mode.disallowedTools) && mode.disallowedTools.length > 0;
}

function resolveApprovalPolicy(mode: EnhancedMode): CodexSessionConfig['approval-policy'] {
    if (hasHardToolRestrictions(mode)) {
        return 'on-request';
    }
    switch (mode.permissionMode) {
        case 'default': return 'untrusted';
        case 'read-only': return 'never';
        case 'safe-yolo': return 'on-failure';
        case 'yolo': return 'on-failure';
        default: {
            throw new Error(`Unknown permission mode: ${mode.permissionMode}`);
        }
    }
}

function resolveSandbox(mode: EnhancedMode): CodexSessionConfig['sandbox'] {
    switch (mode.permissionMode) {
        case 'default': return 'workspace-write';
        case 'read-only': return 'read-only';
        case 'safe-yolo': return 'workspace-write';
        case 'yolo': return 'danger-full-access';
        default: {
            throw new Error(`Unknown permission mode: ${mode.permissionMode}`);
        }
    }
}

export function buildCodexStartConfig(args: {
    message: string;
    mode: EnhancedMode;
    first: boolean;
    cwd?: string;
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    cliOverrides?: CodexCliOverrides;
    developerInstructions?: string;
}): CodexSessionConfig {
    const approvalPolicy = resolveApprovalPolicy(args.mode);
    const sandbox = resolveSandbox(args.mode);
    const allowCliOverrides = args.mode.permissionMode === 'default' && !hasHardToolRestrictions(args.mode);
    const cliOverrides = allowCliOverrides ? args.cliOverrides : undefined;
    const resolvedApprovalPolicy = cliOverrides?.approvalPolicy ?? approvalPolicy;
    const resolvedSandbox = cliOverrides?.sandbox ?? sandbox;

    const prompt = args.message;
    const baseInstructions = codexSystemPrompt;
    const developerInstructions = [
        baseInstructions,
        args.developerInstructions,
        args.mode.appendSystemPrompt
    ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n');
    const config: Record<string, unknown> = {
        ...(Object.keys(args.mcpServers).length > 0 ? { mcp_servers: args.mcpServers } : {}),
        ...(developerInstructions ? { developer_instructions: developerInstructions } : {})
    };
    const startConfig: CodexSessionConfig = {
        prompt,
        sandbox: resolvedSandbox,
        'approval-policy': resolvedApprovalPolicy,
        config
    };

    if (args.cwd) {
        startConfig.cwd = args.cwd;
    }

    const modelSpec = resolveCodexModelSpec(args.mode.model);
    if (modelSpec?.model) {
        startConfig.model = modelSpec.model;
    }

    return startConfig;
}
