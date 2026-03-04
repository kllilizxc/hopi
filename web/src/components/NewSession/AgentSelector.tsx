import { memo } from 'react'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { SegmentedControl } from '@/components/ui/segmented-control'

const AgentSelectorComponent = (props: {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) => {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.agent')}
            </label>
            <SegmentedControl.Root
                value={props.agent}
                onValueChange={(value) => props.onAgentChange(value as AgentType)}
                disabled={props.isDisabled}
                size="2"
                variant="surface"
            >
                <SegmentedControl.Item value="claude">{t('agent.claude')}</SegmentedControl.Item>
                <SegmentedControl.Item value="codex">{t('agent.codex')}</SegmentedControl.Item>
                <SegmentedControl.Item value="gemini">{t('agent.gemini')}</SegmentedControl.Item>
                <SegmentedControl.Item value="opencode">{t('agent.opencode')}</SegmentedControl.Item>
            </SegmentedControl.Root>
        </div>
    )
}

export const AgentSelector = memo(AgentSelectorComponent)
