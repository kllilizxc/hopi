import type { ReactNode } from 'react'
import { BackIcon } from '@/assets/icons'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

export function PageHeader(props: {
    title: ReactNode
    subtitle?: ReactNode
    onBack?: () => void
    backLabel?: string
    right?: ReactNode
    showSafeAreaTop?: boolean
    constrainWidth?: boolean
    borderClassName?: string
    contentClassName?: string
    titleClassName?: string
    subtitleClassName?: string
    className?: string
}) {
    return (
        <div
            className={cn(
                'bg-[var(--app-bg)]',
                props.showSafeAreaTop !== false ? 'pt-[env(safe-area-inset-top)]' : undefined,
                props.className
            )}
        >
            <div
                className={cn(
                    'flex items-center gap-2',
                    props.constrainWidth === false ? 'w-full' : 'mx-auto w-full max-w-content',
                    props.borderClassName ?? 'app-shadow-divider-b',
                    props.contentClassName ?? 'px-3 py-2'
                )}
            >
                {props.onBack ? (
                    <IconButton
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={props.onBack}
                        aria-label={props.backLabel}
                        title={props.backLabel}
                    >
                        <BackIcon className="h-5 w-5" />
                    </IconButton>
                ) : null}
                <div className="min-w-0 flex-1">
                    <div className={cn('truncate font-semibold', props.titleClassName)}>
                        {props.title}
                    </div>
                    {props.subtitle ? (
                        <div className={cn('truncate text-xs text-[var(--app-hint)]', props.subtitleClassName)}>
                            {props.subtitle}
                        </div>
                    ) : null}
                </div>
                {props.right}
            </div>
        </div>
    )
}
