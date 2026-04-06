import type { OperatorThread } from '@/prototype/types'

function labelRefKind(kind: OperatorThread['refs'][number]['kind']) {
    switch (kind) {
        case 'goal':
            return '目标'
        case 'stream':
            return '执行流'
        case 'phase':
            return '阶段'
        case 'plan':
            return '计划'
        case 'impact':
            return '影响'
    }
}

export default function ThreadHeader(props: { thread: OperatorThread }) {
    const contextRefs = props.thread.refs
        .filter((ref) => ref.kind !== 'impact')
        .slice(0, 3)
    const contextLine = contextRefs
        .map((ref) => `${labelRefKind(ref.kind)}：${ref.label}`)
        .join(' · ')

    return (
        <header className="prototype-chat-thread__header">
            <div className="prototype-chat-thread__meta">
                <span className="prototype-chat-thread__status">{props.thread.statusLabel}</span>
                {contextLine ? <p className="prototype-chat-thread__context">{contextLine}</p> : null}
            </div>
        </header>
    )
}
