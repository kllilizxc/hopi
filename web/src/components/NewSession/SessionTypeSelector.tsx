import type { RefObject } from 'react'
import type { SessionType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { CompactTabs } from '@/components/ui/CompactTabs'

export function SessionTypeSelector(props: {
    sessionType: SessionType
    worktreeName: string
    worktreeInputRef: RefObject<HTMLInputElement | null>
    isDisabled: boolean
    onSessionTypeChange: (value: SessionType) => void
    onWorktreeNameChange: (value: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.type')}
            </label>
            <div className="flex flex-col gap-2">
                <CompactTabs
                    items={[
                        { id: 'simple', label: t('newSession.type.simple') },
                        { id: 'worktree', label: t('newSession.type.worktree') }
                    ]}
                    selectedId={props.sessionType}
                    onSelect={(value) => props.onSessionTypeChange(value as SessionType)}
                    ariaLabel={t('newSession.type')}
                    distribution="equal"
                    disabled={props.isDisabled}
                />

                <div className="text-xs text-[var(--app-hint)]">
                    {props.sessionType === 'worktree'
                        ? t('newSession.type.worktree.desc')
                        : t('newSession.type.simple.desc')}
                </div>

                {props.sessionType === 'worktree' ? (
                    <input
                        ref={props.worktreeInputRef}
                        type="text"
                        placeholder={t('newSession.type.worktree.placeholder')}
                        value={props.worktreeName}
                        onChange={(e) => props.onWorktreeNameChange(e.target.value)}
                        disabled={props.isDisabled}
                        className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-60"
                    />
                ) : null}
            </div>
        </div>
    )
}
