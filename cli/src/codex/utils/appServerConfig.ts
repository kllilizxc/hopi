import type { EnhancedMode } from '../loop';
import type { CodexCliOverrides } from './codexCliOverrides';
import { resolveCodexModelSpec } from './codexModelConfig';
import { codexSystemPrompt } from './systemPrompt';
import type {
    ApprovalPolicy,
    SandboxMode,
    SandboxPolicy,
    ThreadStartParams,
    TurnStartParams
} from '../appServerTypes';

export type McpServersConfig = Record<string, { command: string; args: string[]; env?: Record<string, string> }>;

const DEFAULT_CODEX_THREAD_INSTRUCTIONS = 'You are Codex, an AI coding agent. Follow the user instructions and repository guidance.';

function hasHardToolRestrictions(mode: EnhancedMode | undefined): boolean {
    return Array.isArray(mode?.disallowedTools) && mode.disallowedTools.length > 0;
}

function resolveApprovalPolicy(mode: EnhancedMode): ApprovalPolicy {
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

function resolveSandbox(mode: EnhancedMode): SandboxMode {
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

function resolveSandboxPolicy(mode: EnhancedMode): SandboxPolicy {
    switch (mode.permissionMode) {
        case 'default': return { type: 'workspaceWrite' };
        case 'read-only': return { type: 'readOnly' };
        case 'safe-yolo': return { type: 'workspaceWrite' };
        case 'yolo': return { type: 'dangerFullAccess' };
        default: {
            throw new Error(`Unknown permission mode: ${mode.permissionMode}`);
        }
    }
}

function resolveSandboxPolicyOverride(value: CodexCliOverrides['sandbox'] | undefined): SandboxPolicy | undefined {
    switch (value) {
        case 'read-only':
            return { type: 'readOnly' };
        case 'workspace-write':
            return { type: 'workspaceWrite' };
        case 'danger-full-access':
            return { type: 'dangerFullAccess' };
        default:
            return undefined;
    }
}

function buildMcpServerConfig(mcpServers: McpServersConfig): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    for (const [name, server] of Object.entries(mcpServers)) {
        config[`mcp_servers.${name}`] = {
            command: server.command,
            args: server.args,
            ...(server.env ? { env: server.env } : {})
        };
    }

    return config;
}

export function buildThreadStartParams(args: {
    mode: EnhancedMode;
    mcpServers: McpServersConfig;
    cwd?: string;
    cliOverrides?: CodexCliOverrides;
    baseInstructions?: string;
    developerInstructions?: string;
}): ThreadStartParams {
    const approvalPolicy = resolveApprovalPolicy(args.mode);
    const sandbox = resolveSandbox(args.mode);
    const allowCliOverrides = args.mode.permissionMode === 'default' && !hasHardToolRestrictions(args.mode);
    const cliOverrides = allowCliOverrides ? args.cliOverrides : undefined;
    const resolvedApprovalPolicy = cliOverrides?.approvalPolicy ?? approvalPolicy;
    const resolvedSandbox = cliOverrides?.sandbox ?? sandbox;

    const config = buildMcpServerConfig(args.mcpServers);
    const configuredBaseInstructions = args.baseInstructions ?? codexSystemPrompt;
    const baseInstructions = configuredBaseInstructions.trim().length > 0
        ? configuredBaseInstructions
        : DEFAULT_CODEX_THREAD_INSTRUCTIONS;
    const resolvedDeveloperInstructions = [
        baseInstructions,
        args.developerInstructions,
        args.mode.appendSystemPrompt
    ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n');
    const configWithInstructions = {
        ...config,
        ...(resolvedDeveloperInstructions ? { developer_instructions: resolvedDeveloperInstructions } : {})
    };

    const params: ThreadStartParams = {
        approvalPolicy: resolvedApprovalPolicy,
        sandbox: resolvedSandbox,
        baseInstructions,
        developerInstructions: resolvedDeveloperInstructions,
        ...(Object.keys(configWithInstructions).length > 0 ? { config: configWithInstructions } : {})
    };

    if (args.cwd) {
        params.cwd = args.cwd;
    }

    const resolvedModelSpec = resolveCodexModelSpec(args.mode.model);
    if (resolvedModelSpec?.model) {
        params.model = resolvedModelSpec.model;
    }

    return params;
}

export function buildTurnStartParams(args: {
    threadId: string;
    message: string;
    cwd?: string;
    mode?: EnhancedMode;
    cliOverrides?: CodexCliOverrides;
    overrides?: {
        approvalPolicy?: TurnStartParams['approvalPolicy'];
        sandboxPolicy?: TurnStartParams['sandboxPolicy'];
        model?: string;
    };
}): TurnStartParams {
    const params: TurnStartParams = {
        threadId: args.threadId,
        input: [{ type: 'text', text: args.message }]
    };

    if (args.cwd) {
        params.cwd = args.cwd;
    }

    const allowCliOverrides = args.mode?.permissionMode === 'default' && !hasHardToolRestrictions(args.mode);
    const cliOverrides = allowCliOverrides ? args.cliOverrides : undefined;
    const hardToolRestrictions = hasHardToolRestrictions(args.mode);
    const approvalPolicy = hardToolRestrictions
        ? (args.mode ? resolveApprovalPolicy(args.mode) : undefined)
        : args.overrides?.approvalPolicy
            ?? cliOverrides?.approvalPolicy
            ?? (args.mode ? resolveApprovalPolicy(args.mode) : undefined);
    if (approvalPolicy) {
        params.approvalPolicy = approvalPolicy;
    }

    const sandboxPolicy = args.overrides?.sandboxPolicy
        ?? resolveSandboxPolicyOverride(cliOverrides?.sandbox)
        ?? (args.mode ? resolveSandboxPolicy(args.mode) : undefined);
    if (sandboxPolicy) {
        params.sandboxPolicy = sandboxPolicy;
    }

    const collaborationMode = args.mode?.collaborationMode;
    const modelSpec = resolveCodexModelSpec(args.overrides?.model ?? args.mode?.model);
    const model = modelSpec?.model;
    const effort = modelSpec?.effort;

    if (collaborationMode) {
        const settings = model ? { model } : undefined;
        params.collaborationMode = settings
            ? { mode: collaborationMode, settings }
            : { mode: collaborationMode };
    } else if (model) {
        params.model = model;
        if (effort) {
            params.effort = effort;
        }
    }

    return params;
}
