import type { ReactNode } from 'react'

export type OperatorMessageRole = 'assistant' | 'user' | 'system'

function getOperatorMessageBubbleClass(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'prototype-thread-bubble--agent'
    }
    if (role === 'user') {
        return 'prototype-thread-bubble--user'
    }
    return 'prototype-thread-bubble--system'
}

function getOperatorRoleLabel(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'agent'
    }
    return role
}

export function getOperatorMessageRootClass(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'prototype-thread-message prototype-thread-message--agent'
    }
    if (role === 'user') {
        return 'prototype-thread-message prototype-thread-message--user'
    }
    return 'prototype-thread-message prototype-thread-message--system'
}

export function OperatorMessageCard(props: {
    role: OperatorMessageRole
    children: ReactNode
    timestampLabel?: string | null
    statusLabel?: string | null
}) {
    const showMeta = Boolean(props.timestampLabel || props.statusLabel)

    return (
        <div className={`prototype-thread-bubble ${getOperatorMessageBubbleClass(props.role)}`}>
            {showMeta ? (
                <div className="prototype-session-log__message-meta">
                    <strong>{getOperatorRoleLabel(props.role)}</strong>
                    {props.timestampLabel ? <span>{props.timestampLabel}</span> : null}
                    {props.statusLabel ? <span>{props.statusLabel}</span> : null}
                </div>
            ) : null}
            <div className="prototype-session-log__body">
                {props.children}
            </div>
        </div>
    )
}
