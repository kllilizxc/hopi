import type { PlanTraceTab } from '@/prototype/types'

const TABS: Array<{ id: PlanTraceTab; label: string }> = [
    { id: 'events', label: 'Events' },
    { id: 'state', label: 'State' },
    { id: 'json', label: 'JSON' },
]

function nextTabId(current: PlanTraceTab, direction: 'next' | 'previous'): PlanTraceTab {
    const currentIndex = TABS.findIndex((tab) => tab.id === current)
    if (currentIndex === -1) {
        return 'events'
    }

    if (direction === 'next') {
        return TABS[(currentIndex + 1) % TABS.length]?.id ?? 'events'
    }

    return TABS[(currentIndex - 1 + TABS.length) % TABS.length]?.id ?? 'events'
}

export default function PlanTraceTabs(props: {
    activeTab: PlanTraceTab
    onChange: (tab: PlanTraceTab) => void
}) {
    return (
        <div className="prototype-tab-row prototype-trace-tabs" role="tablist" aria-label="Plan trace sections">
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`prototype-trace-tab-${tab.id}`}
                    aria-selected={props.activeTab === tab.id}
                    aria-controls={`prototype-trace-panel-${tab.id}`}
                    tabIndex={props.activeTab === tab.id ? 0 : -1}
                    className={props.activeTab === tab.id ? 'is-active' : undefined}
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
                            props.onChange('events')
                            return
                        }

                        if (event.key === 'End') {
                            event.preventDefault()
                            props.onChange('json')
                        }
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    )
}
