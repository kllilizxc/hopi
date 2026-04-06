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

    return (
        <button
            key={thread.id}
            type="button"
            className={`prototype-inbox-row ${toneClass(thread)}${thread.id === activeThreadId ? ' is-active' : ''}`}
            onClick={() => onSelect(thread.id)}
        >
            <div className="prototype-inbox-row__content">
                <div className="prototype-inbox-row__topline">
                    <div className="prototype-inbox-row__title">
                        {thread.unread ? <span className="prototype-thread-dot" /> : null}
                        <strong>{thread.title}</strong>
                    </div>
                    <span>{thread.updatedAt}</span>
                </div>
                <p>{previewForThread(thread)}</p>
                <div className="prototype-inbox-row__meta">
                    <span>{thread.statusLabel}</span>
                    {context ? <span>{context}</span> : null}
                </div>
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
        <div className="prototype-inbox-shell">
            {inboxBuckets.map((bucket) => {
                const bucketThreads = props.threads.filter((thread) => !thread.passive && thread.lifecycle === bucket)
                if (bucketThreads.length === 0) {
                    return null
                }

                return (
                    <section key={bucket} className="prototype-inbox-section">
                        <div className="prototype-inbox-section__label">
                            <span>{labelForSection(bucket)}</span>
                            <strong>{bucketThreads.length}</strong>
                        </div>
                        {bucketThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect))}
                    </section>
                )
            })}

            {passiveThreads.length > 0 ? (
                <section className="prototype-inbox-section">
                    <div className="prototype-inbox-section__label">
                        <span>静默更新</span>
                        <strong>{passiveThreads.length}</strong>
                    </div>
                    {passiveThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect))}
                </section>
            ) : null}

            {handledThreads.length > 0 ? (
                <section className="prototype-inbox-section">
                    <button type="button" className="prototype-inbox-toggle" onClick={props.onToggleHandled}>
                        <span>已处理</span>
                        <strong>{handledThreads.length}</strong>
                    </button>
                    {props.showHandled ? handledThreads.map((thread) => renderRow(thread, props.activeThreadId, props.onSelect)) : null}
                </section>
            ) : null}
        </div>
    )
}
