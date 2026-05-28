import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { SpinnerIcon } from '@/assets/icons'

type SpinnerProps = {
    size?: 'sm' | 'md' | 'lg'
    className?: string
    label?: string | null
}

export function Spinner({
    size = 'md',
    className,
    label
}: SpinnerProps) {
    const { t } = useTranslation()
    const sizeClasses = {
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
        lg: 'h-6 w-6'
    }
    const effectiveLabel = label === undefined ? t('loading') : label
    const accessibilityProps = effectiveLabel === null
        ? { 'aria-hidden': true }
        : { role: 'status', 'aria-label': effectiveLabel }

    return (
        <SpinnerIcon
            className={cn(sizeClasses[size], 'animate-spin text-[var(--app-hint)]', className)}
            {...accessibilityProps}
        />
    )
}
