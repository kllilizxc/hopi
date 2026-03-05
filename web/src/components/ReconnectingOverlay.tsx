import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ReconnectingOverlay({ isReconnecting }: { isReconnecting: boolean }) {
    const { t } = useTranslation()

    if (!isReconnecting) {
        return null
    }

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-lg rounded-full px-4 py-2 z-50 flex items-center gap-2 border border-gray-200 dark:border-gray-700">
            <Spinner size="sm" label={null} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('reconnecting.message')}
            </span>
        </div>
    )
}
