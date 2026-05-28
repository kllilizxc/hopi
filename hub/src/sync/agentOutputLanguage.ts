import { normalizeAgentOutputLanguage } from '@hopi/protocol'
import type { AgentOutputLanguage } from '@hopi/protocol/types'

type SessionLike = {
    metadata?: unknown
} | null | undefined

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

export function normalizeLocaleTag(raw: string | undefined): string | null {
    if (!raw) return null

    let value = raw.trim()
    if (!value) return null

    if (value.includes(':')) {
        value = value.split(':')[0] ?? value
    }
    value = value.split('.')[0] ?? value
    value = value.split('@')[0] ?? value
    value = value.replace(/_/g, '-')

    if (!value) return null
    const lowered = value.toLowerCase()
    if (lowered === 'c' || lowered === 'posix') {
        return null
    }

    try {
        const [canonical] = Intl.getCanonicalLocales(value)
        return canonical ?? null
    } catch {
        return null
    }
}

function resolveSessionLocale(session: SessionLike): string | null {
    const metadata = toRecord(session?.metadata)
    if (!metadata) {
        return null
    }

    const rawLocale = typeof metadata.locale === 'string'
        ? metadata.locale
        : typeof metadata.language === 'string'
            ? metadata.language
            : undefined

    return normalizeLocaleTag(rawLocale)
}

function resolveEnvironmentLocale(): string {
    const envLocale = normalizeLocaleTag(
        process.env.LC_ALL
        ?? process.env.LC_MESSAGES
        ?? process.env.LANGUAGE
        ?? process.env.LANG
    )
    if (envLocale) {
        return envLocale
    }

    const fallbackLocale = normalizeLocaleTag(Intl.DateTimeFormat().resolvedOptions().locale)
    return fallbackLocale ?? 'en'
}

export function resolveAgentOutputLocale(options: {
    agentOutputLanguage?: AgentOutputLanguage | string | null
    preferredLocale?: string
    session?: SessionLike
}): string {
    const projectLanguage = normalizeAgentOutputLanguage(options.agentOutputLanguage)
    if (projectLanguage !== 'system') {
        return projectLanguage
    }

    return normalizeLocaleTag(options.preferredLocale)
        ?? resolveSessionLocale(options.session)
        ?? resolveEnvironmentLocale()
}

export function buildAgentOutputLanguageSection(locale: string): string {
    return [
        '',
        '',
        `Agent output language: ${locale}`,
        `Use ${locale} for HOPI_ACTIONS generated titles, descriptions, decision topics, handoff, evidence, and goal updates unless quoting source text.`
    ].join('\n')
}
