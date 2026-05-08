import { usePrototypeStore } from '@/prototype/store'
import type { OperatorThread } from '@/prototype/types'

export default function ThreadQuickActions(props: { thread: OperatorThread }) {
    const { actions } = usePrototypeStore()

    if (props.thread.quickActions.length === 0 || props.thread.lifecycle === 'resolved' || props.thread.lifecycle === 'silent') {
        return null
    }

    return (
        <div className="prototype-thread-quick-actions flex flex-col gap-2 p-4 bg-zinc-50 border border-zinc-200 rounded-xl mt-2 shadow-sm">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">建议动作</span>
            <div className="flex flex-wrap items-center gap-2">
                {props.thread.quickActions.map((action) => (
                    <button
                        key={action.id}
                        type="button"
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 shadow-sm ${action.tone === 'primary' ? 'bg-zinc-900 text-white hover:bg-zinc-800 focus:ring-zinc-900' : 'bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50 focus:ring-zinc-500'}`}
                        onClick={() => actions.performQuickAction(props.thread.id, action.id)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
