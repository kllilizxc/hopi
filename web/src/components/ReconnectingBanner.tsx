import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ReconnectingBanner({ isReconnecting }: { isReconnecting: boolean }) {
    const { t } = useTranslation()
    const isOnline = useOnlineStatus()

    // Don't show if offline (OfflineBanner takes precedence) or if not reconnecting
    if (!isReconnecting || !isOnline) {
        return null
    }

    return (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
            <Spinner size="sm" label={null} className="text-white" />
            {t('reconnecting.message')}
        </div>
    )
}
