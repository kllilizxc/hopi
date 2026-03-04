import { memo } from 'react'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'

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
            <div className="inline-flex w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1">
                {AGENTS.map((agent) => (
                    <button
                        key={agent}
                        type="button"
                        disabled={props.isDisabled}
                        onClick={() => props.onAgentChange(agent)}
                        className={`
                            flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all
                            focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] focus:ring-offset-1
                            disabled:cursor-not-allowed disabled:opacity-50
                            ${
                                props.agent === agent
                                    ? 'bg-[var(--app-link)] text-white shadow-sm'
                                    : 'text-[var(--app-fg)] hover:bg-[var(--app-hover)]'
                            }
                        `}
                    >
                        {t(`agent.${agent}`)}
                    </button>
                ))}
            </div>
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
