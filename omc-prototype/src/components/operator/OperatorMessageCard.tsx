import type { ReactNode } from 'react'

export type OperatorMessageRole = 'assistant' | 'user' | 'system'

function getOperatorMessageBubbleClass(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'bg-white border border-zinc-200 text-zinc-900 rounded-2xl rounded-tl-sm shadow-sm'
    }
    if (role === 'user') {
        return 'bg-blue-600 text-white rounded-2xl rounded-tr-sm shadow-sm'
    }
    return 'bg-zinc-100 text-zinc-700 rounded-2xl rounded-tl-sm border border-zinc-200/50'
}

function getOperatorRoleLabel(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'agent'
    }
    return role
}

export function getOperatorMessageRootClass(role: OperatorMessageRole): string {
    if (role === 'assistant') {
        return 'flex w-full justify-start'
    }
    if (role === 'user') {
        return 'flex w-full justify-end'
    }
    return 'flex w-full justify-start opacity-80'
}

export function OperatorMessageCard(props: {
    role: OperatorMessageRole
    children: ReactNode
    timestampLabel?: string | null
    statusLabel?: string | null
}) {
    const showMeta = Boolean(props.timestampLabel || props.statusLabel)

    return (
        <div className={`max-w-[85%] px-5 py-4 relative flex flex-col gap-2 ${getOperatorMessageBubbleClass(props.role)}`}>
            {showMeta ? (
                <div className={`flex items-center gap-3 text-xs font-mono mb-1 ${props.role === 'user' ? 'text-blue-200' : 'text-zinc-500'}`}>
                    <strong className={`font-semibold uppercase tracking-wider ${props.role === 'user' ? 'text-blue-100' : 'text-zinc-700'}`}>{getOperatorRoleLabel(props.role)}</strong>
                    {props.timestampLabel ? <span>{props.timestampLabel}</span> : null}
                    {props.statusLabel ? <span className={`px-1.5 py-0.5 rounded ${props.role === 'user' ? 'bg-blue-500/50' : 'bg-zinc-200/50 text-zinc-700'}`}>{props.statusLabel}</span> : null}
                </div>
            ) : null}
            <div className={`prose prose-sm max-w-none break-words ${props.role === 'user' ? 'prose-invert prose-p:text-blue-50 prose-a:text-white prose-strong:text-white' : 'prose-zinc prose-a:text-blue-600'}`}>
                {props.children}
            </div>
        </div>
    )
}
