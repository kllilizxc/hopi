import { useTranslation, type Locale } from '@/lib/use-translation'
import { LanguageIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { IconButton } from '@/components/ui/icon-button'

const locales: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export function LanguageSwitcher() {
    const { locale, setLocale, t } = useTranslation()

    return (
        <div>
            <AdaptiveSelect
                title={t('language.title')}
                value={locale}
                options={locales.map((loc) => ({ value: loc.value, label: loc.label }))}
                onValueChange={(nextLocale: Locale) => setLocale(nextLocale)}
                align="end"
                trigger={
                    <IconButton
                        type="button"
                        title={t('language.title')}
                        aria-label={t('language.title')}
                    >
                        <LanguageIcon />
                    </IconButton>
                }
            />
        </div>
    )
}
