import type { PlanTraceTab } from '@/prototype/types'

const TABS: Array<{ id: PlanTraceTab; label: string }> = [
    { id: 'logs', label: 'Logs' },
    { id: 'events', label: 'Events' },
    { id: 'state', label: 'State' },
    { id: 'json', label: 'JSON' },
    { id: 'diff', label: 'Diff' },
]

function nextTabId(current: PlanTraceTab, direction: 'next' | 'previous'): PlanTraceTab {
    const currentIndex = TABS.findIndex((tab) => tab.id === current)
    if (currentIndex === -1) {
        return 'logs'
    }

    if (direction === 'next') {
        return TABS[(currentIndex + 1) % TABS.length]?.id ?? 'logs'
    }

    return TABS[(currentIndex - 1 + TABS.length) % TABS.length]?.id ?? 'logs'
}

export default function PlanTraceTabs(props: {
    activeTab: PlanTraceTab
    onChange: (tab: PlanTraceTab) => void
}) {
    return (
        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg w-full" role="tablist" aria-label="Plan trace sections">
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`prototype-trace-tab-${tab.id}`}
                    aria-selected={props.activeTab === tab.id}
                    aria-controls={`prototype-trace-panel-${tab.id}`}
                    tabIndex={props.activeTab === tab.id ? 0 : -1}
                    className={`flex-1 py-1.5 text-sm font-medium text-center rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${props.activeTab === tab.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'}`}
                    onClick={() => props.onChange(tab.id)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowRight') {
                            event.preventDefault()
                            props.onChange(nextTabId(props.activeTab, 'next'))
                            return
                        }

                        if (event.key === 'ArrowLeft') {
                            event.preventDefault()
                            props.onChange(nextTabId(props.activeTab, 'previous'))
                            return
                        }

                        if (event.key === 'Home') {
                            event.preventDefault()
                            props.onChange('logs')
                            return
                        }

                        if (event.key === 'End') {
                            event.preventDefault()
                            props.onChange('diff')
                        }
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    )
}
