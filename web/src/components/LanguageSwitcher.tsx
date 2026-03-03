import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { LanguageIcon } from '@/assets/icons'
import { ActionSheetSelect } from '@/components/ui/ActionSheetSelect'
import { IconButton } from '@/components/ui/icon-button'

const locales: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export function LanguageSwitcher() {
    const { locale, setLocale, t } = useTranslation()
    const [open, setOpen] = useState(false)

    return (
        <div>
            <IconButton
                type="button"
                onClick={() => setOpen(true)}
                title={t('language.title')}
                aria-label={t('language.title')}
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                <LanguageIcon />
            </IconButton>

            <ActionSheetSelect
                open={open}
                onOpenChange={setOpen}
                title={t('language.title')}
                value={locale}
                options={locales.map((loc) => ({ value: loc.value, label: loc.label }))}
                onValueChange={(nextLocale: Locale) => setLocale(nextLocale)}
            />
        </div>
    )
}
