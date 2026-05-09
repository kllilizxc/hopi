import { DEFAULT_AGENT_OUTPUT_LANGUAGE, normalizeAgentOutputLanguage } from '@hopi/protocol'
import type { AgentOutputLanguage } from '@/types/api'

type Translate = (key: string) => string

export function getAgentOutputLanguageOptions(t: Translate): Array<{ value: AgentOutputLanguage; label: string }> {
    return [
        { value: DEFAULT_AGENT_OUTPUT_LANGUAGE, label: t('projects.agentOutputLanguage.system') },
        { value: 'en', label: t('projects.agentOutputLanguage.english') },
        { value: 'zh-CN', label: t('projects.agentOutputLanguage.chinese') }
    ]
}

export function normalizeProjectAgentOutputLanguage(value: string | null | undefined): AgentOutputLanguage {
    return normalizeAgentOutputLanguage(value)
}
