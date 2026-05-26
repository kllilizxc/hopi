import { CopyIcon } from '@/assets/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'

export function SessionDebugIdButton(props: { debugId: string; onClick?: () => void }) {
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const label = copied ? t('session.debugId.copied') : t('session.debugId.copy')

    return (
        <button
            type="button"
            className="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[var(--app-hint)] transition-colors hover:text-[var(--app-link)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            title={label}
            aria-label={label}
            onClick={(event) => {
                event.stopPropagation()
                props.onClick?.()
                void copy(props.debugId)
            }}
        >
            <CopyIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{props.debugId}</span>
        </button>
    )
}
