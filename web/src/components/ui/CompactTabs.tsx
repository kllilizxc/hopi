export type CompactTabItem = {
    id: string
    label: string
    title?: string
}

export function CompactTabs(props: {
    items: CompactTabItem[]
    selectedId: string
    onSelect: (id: string) => void
    ariaLabel: string
    distribution?: 'content' | 'equal'
    disabled?: boolean
    className?: string
}) {
    const isEqual = props.distribution === 'equal'

    return (
        <div
            className={`flex ${isEqual ? 'w-full' : 'max-w-full'} items-center gap-1 overflow-x-auto rounded-lg bg-[var(--app-secondary-bg)] p-1 ${props.className ?? ''}`}
            role="tablist"
            aria-label={props.ariaLabel}
        >
            {props.items.map((item) => {
                const isSelected = item.id === props.selectedId
                return (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => props.onSelect(item.id)}
                        disabled={props.disabled}
                        role="tab"
                        aria-selected={isSelected}
                        aria-current={isSelected ? 'page' : undefined}
                        title={item.title ?? item.label}
                        className={`${isEqual ? 'min-w-0 flex-1 text-center' : 'shrink-0'} rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isSelected
                                ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] font-semibold shadow-sm'
                                : 'text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]'
                        }`}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}
