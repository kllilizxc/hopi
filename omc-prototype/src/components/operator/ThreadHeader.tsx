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
        <header className="flex flex-col px-6 py-4 bg-zinc-50 border-b border-zinc-200">
            <div className="flex items-center gap-3 w-full">
                <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-white border border-zinc-200 text-zinc-600 rounded shadow-sm">{props.thread.statusLabel}</span>
                {!props.thread.briefing && contextLine ? <p className="text-sm font-medium text-zinc-500 truncate min-w-0">{contextLine}</p> : null}
            </div>
        </header>
    )
}
