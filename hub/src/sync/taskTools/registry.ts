import { isObject, unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol'
import type { AgentToolExtractor, ExtractorRegistry, TaskToolResult } from './types'
import { ClaudeToolExtractor } from './extractors/claude'
import { CodexToolExtractor } from './extractors/codex'
import { AcpToolExtractor } from './extractors/acp'

/**
 * Default extractor registry implementation
 */
export class DefaultExtractorRegistry implements ExtractorRegistry {
    private extractors = new Map<string, AgentToolExtractor>()

    constructor() {
        // Register default extractors
        this.register('claude', new ClaudeToolExtractor())
        this.register('codex', new CodexToolExtractor())
        this.register('acp', new AcpToolExtractor())
    }

    register(agentType: string, extractor: AgentToolExtractor): void {
        this.extractors.set(agentType, extractor)
    }

    extract(messageContent: unknown): TaskToolResult | null {
        const record = unwrapRoleWrappedRecordEnvelope(messageContent)
        if (!record) return null

        if (record.role !== 'agent' && record.role !== 'assistant') return null

        if (!isObject(record.content) || typeof record.content.type !== 'string') return null

        // Try each extractor until one succeeds
        for (const extractor of this.extractors.values()) {
            const result = extractor.extractTaskTools(record.content)
            if (result) return result
        }

        return null
    }
}

/**
 * Singleton registry instance
 */
let registryInstance: ExtractorRegistry | null = null

/**
 * Get the global extractor registry
 */
export function getExtractorRegistry(): ExtractorRegistry {
    if (!registryInstance) {
        registryInstance = new DefaultExtractorRegistry()
    }
    return registryInstance
}

/**
 * Set a custom extractor registry (for testing)
 */
export function setExtractorRegistry(registry: ExtractorRegistry): void {
    registryInstance = registry
}

/**
 * Extract task tools from message content using the global registry
 */
export function extractTaskToolsFromMessage(messageContent: unknown): TaskToolResult | null {
    return getExtractorRegistry().extract(messageContent)
}
