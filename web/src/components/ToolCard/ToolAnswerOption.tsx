import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToolAnswerOptionTone = 'neutral' | 'success' | 'info'

const toneClasses: Record<ToolAnswerOptionTone, {
    container: string
    marker: string
    label: string
}> = {
    neutral: {
        container: 'app-shadow-border bg-[var(--app-bg)]',
        marker: 'text-[var(--app-hint)]',
        label: 'text-[var(--app-fg)]'
    },
    success: {
        container: 'app-shadow-border-success bg-emerald-50 dark:bg-emerald-950/30',
        marker: 'text-emerald-600',
        label: 'text-emerald-700 dark:text-emerald-300 font-medium'
    },
    info: {
        container: 'app-shadow-border-info bg-blue-50 dark:bg-blue-950/30',
        marker: 'text-blue-500',
        label: 'text-blue-700 dark:text-blue-300'
    }
}

export function ToolAnswerOption(props: {
    tone?: ToolAnswerOptionTone
    marker?: ReactNode
    label: ReactNode
    description?: ReactNode
    className?: string
}) {
    const tone = toneClasses[props.tone ?? 'neutral']

    return (
        <div className={cn('rounded-md px-2 py-2', tone.container, props.className)}>
            <div className="flex items-start gap-2">
                {props.marker ? (
                    <span className={cn('shrink-0 text-sm', tone.marker)}>
                        {props.marker}
                    </span>
                ) : null}
                <div className="min-w-0 flex-1">
                    <div className={cn('text-sm break-words', tone.label)}>
                        {props.label}
                    </div>
                    {props.description ? (
                        <div className="mt-0.5 text-xs text-[var(--app-hint)] break-words">
                            {props.description}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
