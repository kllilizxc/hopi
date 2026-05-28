import { memo } from 'react'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { CompactTabs } from '@/components/ui/CompactTabs'

type AgentSelectorProps = {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
    compact?: boolean
}

const AGENTS: AgentType[] = ['claude', 'codex', 'gemini', 'opencode']

const AgentSelectorComponent = (props: AgentSelectorProps) => {
    const { t } = useTranslation()

    const content = (
        <>
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.agent')}
            </label>
            <CompactTabs
                items={AGENTS.map((agent) => ({
                    id: agent,
                    label: t(`agent.${agent}`)
                }))}
                selectedId={props.agent}
                onSelect={(agent) => props.onAgentChange(agent as AgentType)}
                ariaLabel={t('newSession.agent')}
                distribution="equal"
                disabled={props.isDisabled}
            />
        </>
    )

    if (props.compact) {
        return content
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            {content}
        </div>
    )
}

export const AgentSelector = memo(AgentSelectorComponent)
