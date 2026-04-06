import { usePrototypeStore } from '@/prototype/store'
import type { OperatorThread } from '@/prototype/types'

export default function ThreadQuickActions(props: { thread: OperatorThread }) {
    const { actions } = usePrototypeStore()

    if (props.thread.quickActions.length === 0 || props.thread.lifecycle === 'resolved' || props.thread.lifecycle === 'silent') {
        return null
    }

    return (
        <div className="prototype-thread-quick-actions">
            <span className="prototype-thread-quick-actions__label">建议动作</span>
            <div className="prototype-thread-quick-actions__list">
                {props.thread.quickActions.map((action) => (
                    <button
                        key={action.id}
                        type="button"
                        className={action.tone === 'primary' ? 'prototype-primary-button' : 'prototype-button--ghost'}
                        onClick={() => actions.performQuickAction(props.thread.id, action.id)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
