import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { useTranslation } from '@/lib/use-translation'
import { Tag } from '@/components/ui/tag'

export function DirectorySection(props: {
    directory: string
    suggestions: readonly Suggestion[]
    selectedIndex: number
    isDisabled: boolean
    recentPaths: string[]
    onDirectoryChange: (value: string) => void
    onDirectoryFocus: () => void
    onDirectoryBlur: () => void
    onDirectoryKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
    onSuggestionSelect: (index: number) => void
    onPathClick: (path: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.directory')}
            </label>
            <div className="relative">
                <input
                    type="text"
                    placeholder={t('newSession.placeholder')}
                    value={props.directory}
                    onChange={(event) => props.onDirectoryChange(event.target.value)}
                    onKeyDown={props.onDirectoryKeyDown}
                    onFocus={props.onDirectoryFocus}
                    onBlur={props.onDirectoryBlur}
                    disabled={props.isDisabled}
                    className="w-full rounded-lg app-shadow-border bg-[var(--app-bg)] px-3 py-3 text-sm text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                {props.suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1">
                        <FloatingOverlay maxHeight={200}>
                            <Autocomplete
                                suggestions={props.suggestions}
                                selectedIndex={props.selectedIndex}
                                onSelect={props.onSuggestionSelect}
                            />
                        </FloatingOverlay>
                    </div>
                )}
            </div>

            {props.recentPaths.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('newSession.recent')}:</span>
                    <div className="flex flex-wrap gap-1">
                        {props.recentPaths.map((path) => (
                            <Tag
                                key={path}
                                asChild
                                variant="default"
                                size="lg"
                                className="max-w-[200px] truncate cursor-pointer hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                <button
                                    type="button"
                                    onClick={() => props.onPathClick(path)}
                                    disabled={props.isDisabled}
                                    title={path}
                                >
                                    {path}
                                </button>
                            </Tag>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
