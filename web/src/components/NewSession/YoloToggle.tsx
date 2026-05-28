import { useTranslation } from '@/lib/use-translation'
import { Switch } from '@/components/ui/switch'

export function YoloToggle(props: {
    yoloMode: boolean
    isDisabled: boolean
    onToggle: (value: boolean) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.yolo')}
            </label>
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                    <span className="text-sm text-[var(--app-fg)]">
                        {t('newSession.yolo.title')}
                    </span>
                    <span className="text-xs text-[var(--app-hint)]">
                        {t('newSession.yolo.desc')}
                    </span>
                </div>
                <Switch
                    checked={props.yoloMode}
                    onCheckedChange={(checked) => props.onToggle(checked)}
                    disabled={props.isDisabled}
                    size="2"
                    variant="surface"
                    aria-label={t('newSession.yolo.title')}
                />
            </div>
        </div>
    )
}
