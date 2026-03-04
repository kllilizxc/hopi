import type { RefObject } from 'react'
import type { SessionType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { SegmentedControl } from '@/components/ui/segmented-control'

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
                <SegmentedControl.Root
                    value={props.sessionType}
                    onValueChange={(value) => props.onSessionTypeChange(value as SessionType)}
                    disabled={props.isDisabled}
                    size="2"
                    variant="surface"
                >
                    <SegmentedControl.Item value="simple">{t('newSession.type.simple')}</SegmentedControl.Item>
                    <SegmentedControl.Item value="worktree">{t('newSession.type.worktree')}</SegmentedControl.Item>
                </SegmentedControl.Root>

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
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-60"
                    />
                ) : null}
            </div>
        </div>
    )
}
