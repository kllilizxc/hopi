import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ReconnectingOverlay({
    isReconnecting,
    label
}: {
    isReconnecting: boolean
    label?: string | null
}) {
    const { t } = useTranslation()

    if (!isReconnecting) {
        return null
    }

    const displayLabel = label ?? t('reconnecting.message')

    return (
        <div className="pointer-events-none fixed bottom-4 right-4 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-lg rounded-full px-3 py-2 z-50 flex items-center gap-2 border border-gray-200 dark:border-gray-700">
            <Spinner size="sm" label={null} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {displayLabel}
            </span>
        </div>
    )
}
