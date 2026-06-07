import { convertAgentMessage, type CodexMessage } from '@/agent/messageConverter';
import type { AgentMessage, PlanItem } from '@/agent/types';

type GeminiTranscriptMessage = {
    type?: string;
    content?: unknown;
    [key: string]: unknown;
};

export type GeminiTranscriptDispatch =
    | { kind: 'user'; text: string }
    | { kind: 'codex'; message: CodexMessage };

function isPlanItem(value: unknown): value is PlanItem {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.content === 'string'
        && (record.priority === 'high' || record.priority === 'medium' || record.priority === 'low')
        && (record.status === 'pending' || record.status === 'in_progress' || record.status === 'completed');
}

function toAgentMessage(value: unknown): AgentMessage | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : null;
    if (!type) {
        return null;
    }

    switch (type) {
        case 'text':
            return typeof record.text === 'string'
                ? { type: 'text', text: record.text }
                : null;
        case 'tool_call':
            return typeof record.id === 'string'
                && typeof record.name === 'string'
                && (record.status === 'pending'
                    || record.status === 'in_progress'
                    || record.status === 'completed'
                    || record.status === 'failed')
                ? {
                    type: 'tool_call',
                    id: record.id,
                    name: record.name,
                    input: record.input,
                    status: record.status
                }
                : null;
        case 'tool_result':
            return typeof record.id === 'string'
                && (record.status === 'completed' || record.status === 'failed')
                ? {
                    type: 'tool_result',
                    id: record.id,
                    output: record.output,
                    status: record.status
                }
                : null;
        case 'plan':
            return Array.isArray(record.items) && record.items.every(isPlanItem)
                ? { type: 'plan', items: record.items }
                : null;
        case 'error':
            return typeof record.message === 'string'
                ? { type: 'error', message: record.message }
                : null;
        case 'turn_complete':
            return typeof record.stopReason === 'string'
                ? { type: 'turn_complete', stopReason: record.stopReason }
                : null;
        default:
            return null;
    }
}

function toCodexDispatch(agentMessage: AgentMessage | null): GeminiTranscriptDispatch | null {
    if (!agentMessage) {
        return null;
    }
    const converted = convertAgentMessage(agentMessage);
    return converted ? { kind: 'codex', message: converted } : null;
}

export function convertGeminiTranscriptMessage(message: GeminiTranscriptMessage): GeminiTranscriptDispatch | null {
    if (message.type === 'user' && typeof message.content === 'string') {
        return { kind: 'user', text: message.content };
    }

    if (message.type === 'gemini' && typeof message.content === 'string') {
        return {
            kind: 'codex',
            message: {
                type: 'message',
                message: message.content
            }
        };
    }

    const directAgentMessage = toAgentMessage(message);
    if (directAgentMessage) {
        return toCodexDispatch(directAgentMessage);
    }

    if ((message.type === 'gemini' || message.type === 'assistant') && message.content) {
        return toCodexDispatch(toAgentMessage(message.content));
    }

    return null;
}
