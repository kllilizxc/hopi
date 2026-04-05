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
    return (
        <header className="prototype-thread-header">
            <div className="prototype-thread-header__title">
                <div>
                    <span className="prototype-thread-header__status">{props.thread.statusLabel}</span>
                    <h3>{props.thread.title}</h3>
                </div>
                <small>{props.thread.updatedAt}</small>
            </div>

            <div className="prototype-thread-header__refs">
                {props.thread.refs.map((ref) => (
                    <span key={`${ref.kind}:${ref.id}`} className="prototype-thread-ref">
                        <strong>{labelRefKind(ref.kind)}</strong>
                        <span>{ref.label}</span>
                    </span>
                ))}
            </div>
        </header>
    )
}
