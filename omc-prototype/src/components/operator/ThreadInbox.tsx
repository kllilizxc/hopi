import { MetaBadge } from '@/components/StatusBadge'
import { getThreadInterventionMeta } from '@/prototype/presenter'
import type { OperatorThread, ThreadLifecycleState } from '@/prototype/types'

function labelForSection(state: ThreadLifecycleState) {
    switch (state) {
        case 'pending':
            return '待处理'
        case 'waiting':
            return '等你回复'
        case 'in-progress':
            return '进行中'
        case 'silent':
            return '静默'
        case 'resolved':
            return '已处理'
    }
}

function previewForThread(thread: OperatorThread) {
    if (thread.lifecycle === 'silent' || thread.lifecycle === 'resolved') {
        return thread.preview || thread.firstMessage.currentStatus
    }
    return thread.firstMessage.currentStatus || thread.preview
}

function contextForThread(thread: OperatorThread) {
    const refs = thread.refs
        .filter((ref) => ref.kind !== 'impact')
        .slice(0, 2)
        .map((ref) => ref.label)
    return refs.join(' · ')
}

function toneClass(thread: OperatorThread) {
    if (thread.tone === 'warning') {
        return 'is-warning'
    }
    if (thread.tone === 'accent') {
        return 'is-accent'
    }
    return ''
}

function renderRow(thread: OperatorThread, activeThreadId: string | null, onSelect: (threadId: string) => void) {
    const context = contextForThread(thread)
    const intervention = getThreadInterventionMeta(thread)
    const isActive = thread.id === activeThreadId
    const isWarning = thread.tone === 'warning'
    const isAccent = thread.tone === 'accent'

    return (
        <button
            key={thread.id}
            type="button"
            className={`flex flex-col w-full text-left p-4 border-b border-zinc-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 relative ${isActive ? 'bg-indigo-50' : 'bg-white hover:bg-zinc-50'}`}
            onClick={() => onSelect(thread.id)}
        >
            {isWarning ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500"></div> : null}
            {isAccent ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500"></div> : null}

            <div className="flex items-start justify-between gap-3 mb-1 w-full">
                <div className="flex items-center gap-2 min-w-0">
                    {thread.unread ? <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" /> : null}
                    <strong className={`text-sm font-semibold truncate ${isActive ? 'text-indigo-900' : 'text-zinc-900'}`}>{thread.title}</strong>
                </div>
                <span className="text-xs text-zinc-400 whitespace-nowrap">{thread.updatedAt}</span>
            </div>
            <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed mb-2">{previewForThread(thread)}</p>
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 mt-auto flex-wrap">
                <span className={`px-2 py-0.5 rounded-md whitespace-nowrap min-w-max ${isWarning ? 'bg-amber-100 text-amber-800' : isAccent ? 'bg-indigo-100 text-indigo-800' : 'bg-zinc-100 text-zinc-700'}`}>{thread.statusLabel}</span>
                {intervention ? (
                    <MetaBadge tone={intervention.tone}>{intervention.label}</MetaBadge>
                ) : null}
                {context ? <span className="truncate">{context}</span> : null}
            </div>
        </button>
    )
}

export default function ThreadInbox(props: {
    threads: OperatorThread[]
    activeThreadId: string | null
    showHandled: boolean
    onToggleHandled: () => void
    onSelect: (threadId: string) => void
}) {
    const inboxBuckets: ThreadLifecycleState[] = ['pending', 'waiting', 'in-progress']
    const passiveThreads = props.threads.filter((thread) => thread.passive || thread.lifecycle === 'silent')
    const handledThreads = props.threads.filter((thread) => thread.lifecycle === 'resolved' && !thread.passive)

    return (
        <div className="flex flex-col flex-1 overflow-y-auto">
            {inboxBuckets.map((bucket) => {
                const bucketThreads = props.threads.filter((thread) => !thread.passive && thread.lifecycle === bucket)
                if (bucketThreads.length === 0) {
                    return null
                }

                return (
                    <section key={bucket} className="flex flex-col">
                        <div className="flex items-center justify-between px-4 py-2 bg-zinc-100/80 border-b border-zinc-200 sticky top-0 z-10 backdrop-blur-sm">
                            <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider">{labelForSection(bucket)}</span>
                            <strong className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold text-zinc-500 bg-zinc-200 rounded-full">{bucketThreads.length}</strong>
                        </div>
                        <div className="flex flex-col">
                            {bucketThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect))}
                        </div>
                    </section>
                )
            })}

            {passiveThreads.length > 0 ? (
                <section className="flex flex-col">
                    <div className="flex items-center justify-between px-4 py-2 bg-zinc-100/80 border-b border-zinc-200 sticky top-0 z-10 backdrop-blur-sm">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider">静默更新</span>
                        <strong className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold text-zinc-500 bg-zinc-200 rounded-full">{passiveThreads.length}</strong>
                    </div>
                    <div className="flex flex-col opacity-80 hover:opacity-100 transition-opacity">
                        {passiveThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect))}
                    </div>
                </section>
            ) : null}

            {handledThreads.length > 0 ? (
                <section className="flex flex-col">
                    <button
                        type="button"
                        className="flex items-center justify-between px-4 py-2 bg-zinc-100/80 border-b border-zinc-200 sticky top-0 z-10 backdrop-blur-sm hover:bg-zinc-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 w-full text-left"
                        onClick={props.onToggleHandled}
                    >
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider flex items-center gap-2">
                            <span className={`transform transition-transform ${props.showHandled ? 'rotate-90' : 'rotate-0'}`}>▶</span>
                            已处理
                        </span>
                        <strong className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold text-zinc-500 bg-zinc-200 rounded-full">{handledThreads.length}</strong>
                    </button>
                    {props.showHandled ? (
                        <div className="flex flex-col opacity-60 hover:opacity-100 transition-opacity">
                            {handledThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect))}
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    )
}
