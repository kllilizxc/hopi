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
    className?: string
}) {
    return (
        <div
            className={`flex items-center gap-1 overflow-x-auto ${props.className ?? ''}`}
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
                        role="tab"
                        aria-selected={isSelected}
                        aria-current={isSelected ? 'page' : undefined}
                        title={item.title ?? item.label}
                        className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-md transition-colors border ${
                            isSelected
                                ? 'text-[var(--app-link)] bg-[var(--app-link)]/15 border-[var(--app-link)]/40 font-semibold shadow-sm'
                                : 'text-[var(--app-hint)] border-transparent hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                        }`}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}

