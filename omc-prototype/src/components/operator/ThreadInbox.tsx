import type { OperatorThread, ThreadLifecycleState } from '@/prototype/types'
import { Glyph } from '@/components/Visuals'

function iconForThread(thread: OperatorThread) {
    switch (thread.kind) {
        case 'approval':
            return 'approval'
        case 'risk':
            return 'risk'
        case 'direction':
            return 'strategy'
        case 'status':
            return 'digest'
    }
}

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

function toneClass(thread: OperatorThread) {
    if (thread.tone === 'warning') {
        return 'is-warning'
    }
    if (thread.tone === 'accent') {
        return 'is-accent'
    }
    return ''
}

export default function ThreadInbox(props: {
    threads: OperatorThread[]
    activeThreadId: string | null
    showHandled: boolean
    onToggleHandled: () => void
    onSelect: (threadId: string) => void
}) {
    const passiveThreads = props.threads.filter((thread) => thread.passive)
    const inboxBuckets: ThreadLifecycleState[] = ['pending', 'waiting', 'in-progress']
    const handledThreads = props.threads.filter((thread) => thread.lifecycle === 'resolved' || thread.lifecycle === 'silent')

    return (
        <div className="prototype-inbox-shell">
            {passiveThreads.length > 0 ? (
                <section className="prototype-inbox-section">
                    <div className="prototype-inbox-section__label">系统</div>
                    {passiveThreads.map((thread) => (
                        <button
                            key={thread.id}
                            type="button"
                            className={`prototype-inbox-row ${toneClass(thread)}${thread.id === props.activeThreadId ? ' is-active' : ''}`}
                            onClick={() => props.onSelect(thread.id)}
                        >
                            <div className="prototype-inbox-row__icon">
                                <Glyph name={iconForThread(thread)} />
                            </div>
                            <div className="prototype-inbox-row__copy">
                                <strong>{thread.title}</strong>
                                <p>{thread.preview}</p>
                            </div>
                            <span className="prototype-inbox-row__meta">{thread.updatedAt}</span>
                        </button>
                    ))}
                </section>
            ) : null}

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
                        {bucketThreads.map((thread) => (
                            <button
                                key={thread.id}
                                type="button"
                                className={`prototype-inbox-row ${toneClass(thread)}${thread.id === props.activeThreadId ? ' is-active' : ''}`}
                                onClick={() => props.onSelect(thread.id)}
                            >
                                <div className="prototype-inbox-row__icon">
                                    <Glyph name={iconForThread(thread)} />
                                </div>
                                <div className="prototype-inbox-row__copy">
                                    <strong>{thread.title}</strong>
                                    <p>{thread.preview}</p>
                                </div>
                                <div className="prototype-inbox-row__tail">
                                    {thread.unread ? <span className="prototype-thread-dot" /> : null}
                                    <span>{thread.updatedAt}</span>
                                </div>
                            </button>
                        ))}
                    </section>
                )
            })}

            {handledThreads.length > 0 ? (
                <section className="prototype-inbox-section">
                    <button type="button" className="prototype-inbox-toggle" onClick={props.onToggleHandled}>
                        <span>已处理</span>
                        <strong>{handledThreads.length}</strong>
                    </button>
                    {props.showHandled ? handledThreads.map((thread) => (
                        <button
                            key={thread.id}
                            type="button"
                            className={`prototype-inbox-row ${toneClass(thread)}${thread.id === props.activeThreadId ? ' is-active' : ''}`}
                            onClick={() => props.onSelect(thread.id)}
                        >
                            <div className="prototype-inbox-row__icon">
                                <Glyph name={iconForThread(thread)} />
                            </div>
                            <div className="prototype-inbox-row__copy">
                                <strong>{thread.title}</strong>
                                <p>{thread.preview}</p>
                            </div>
                            <span className="prototype-inbox-row__meta">{thread.statusLabel}</span>
                        </button>
                    )) : null}
                </section>
            ) : null}
        </div>
    )
}
