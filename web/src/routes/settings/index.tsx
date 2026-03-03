import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { getElevenLabsSupportedLanguages, getLanguageDisplayName } from '@/lib/languages'
import { getFontScaleOptions, useFontScale, type FontScale } from '@/hooks/useFontScale'
import { useTheme, type Appearance, type ThemePreset } from '@/hooks/useTheme'
import { useMotionPreference, type MotionPreference } from '@/hooks/useMotionPreference'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import { BackIcon, CheckIcon, ChevronDownIcon } from '@/assets/icons'
import { ActionSheetSelect } from '@/components/ui/ActionSheetSelect'
import { IconButton } from '@/components/ui/icon-button'

const locales: { value: Locale; nativeLabel: string }[] = [
    { value: 'en', nativeLabel: 'English' },
    { value: 'zh-CN', nativeLabel: '简体中文' },
]

const voiceLanguages = getElevenLabsSupportedLanguages()

export default function SettingsPage() {
    const { t, locale, setLocale } = useTranslation()
    const goBack = useAppGoBack()
    const { appearance, setAppearance, preset, setPreset } = useTheme()
    const [openSheet, setOpenSheet] = useState<'language' | 'font' | 'motion' | 'voice' | 'preset' | null>(null)
    const { fontScale, setFontScale } = useFontScale()
    const { preference: motionPreference, setPreference: setMotionPreference } = useMotionPreference()

    // Voice language state - read from localStorage
    const [voiceLanguage, setVoiceLanguage] = useState<string | null>(() => {
        return localStorage.getItem('hapi-voice-lang')
    })

    const fontScaleOptions = getFontScaleOptions()
    const currentLocale = locales.find((loc) => loc.value === locale)
    const currentFontScaleLabel = fontScaleOptions.find((opt) => opt.value === fontScale)?.label ?? '100%'
    const currentVoiceLanguage = voiceLanguages.find((lang) => lang.code === voiceLanguage)
    const appearanceOptions: { value: Appearance; label: string }[] = [
        { value: 'auto', label: t('settings.theme.auto') },
        { value: 'light', label: t('settings.theme.light') },
        { value: 'dark', label: t('settings.theme.dark') },
    ]
    const presetOptions: { value: ThemePreset; label: string }[] = [
        { value: 'graphite', label: t('settings.theme.preset.graphite') },
        { value: 'soft', label: t('settings.theme.preset.soft') },
        { value: 'contrast', label: t('settings.theme.preset.contrast') },
    ]
    const currentPresetLabel = presetOptions.find((opt) => opt.value === preset)?.label ?? t('settings.theme.preset.graphite')
    const motionOptions: { value: MotionPreference; label: string }[] = [
        { value: 'auto', label: t('settings.motion.auto') },
        { value: 'reduce', label: t('settings.motion.reduce') },
    ]
    const currentMotionLabel = motionOptions.find((opt) => opt.value === motionPreference)?.label ?? t('settings.motion.auto')

    return (
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <IconButton type="button" onClick={goBack}>
                        <BackIcon />
                    </IconButton>
                    <div className="flex-1 font-semibold">{t('settings.title')}</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {/* Language section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.language.title')}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setOpenSheet('language')
                            }}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                            aria-expanded={openSheet === 'language'}
                            aria-haspopup="dialog"
                        >
                            <span className="text-[var(--app-fg)]">{t('settings.language.label')}</span>
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <span>{currentLocale?.nativeLabel}</span>
                                <ChevronDownIcon className={`transition-transform ${openSheet === 'language' ? 'rotate-180' : ''}`} />
                            </span>
                        </button>

                        <ActionSheetSelect
                            open={openSheet === 'language'}
                            onOpenChange={(open) => setOpenSheet(open ? 'language' : null)}
                            title={t('settings.language.title')}
                            value={locale}
                            options={locales.map((loc) => ({ value: loc.value, label: loc.nativeLabel }))}
                            onValueChange={(nextLocale: Locale) => setLocale(nextLocale)}
                        />
                    </div>

                    {/* Display section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.display.title')}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setOpenSheet('font')
                            }}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                            aria-expanded={openSheet === 'font'}
                            aria-haspopup="dialog"
                        >
                            <span className="text-[var(--app-fg)]">{t('settings.display.fontSize')}</span>
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <span>{currentFontScaleLabel}</span>
                                <ChevronDownIcon className={`transition-transform ${openSheet === 'font' ? 'rotate-180' : ''}`} />
                            </span>
                        </button>

                        <ActionSheetSelect
                            open={openSheet === 'font'}
                            onOpenChange={(open) => setOpenSheet(open ? 'font' : null)}
                            title={t('settings.display.fontSize')}
                            value={fontScale}
                            options={fontScaleOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                            onValueChange={(nextScale: FontScale) => setFontScale(nextScale)}
                        />

                        <button
                            type="button"
                            onClick={() => {
                                setOpenSheet('motion')
                            }}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                            aria-expanded={openSheet === 'motion'}
                            aria-haspopup="dialog"
                        >
                            <span className="text-[var(--app-fg)]">{t('settings.display.motion')}</span>
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <span>{currentMotionLabel}</span>
                                <ChevronDownIcon className={`transition-transform ${openSheet === 'motion' ? 'rotate-180' : ''}`} />
                            </span>
                        </button>

                        <ActionSheetSelect
                            open={openSheet === 'motion'}
                            onOpenChange={(open) => setOpenSheet(open ? 'motion' : null)}
                            title={t('settings.display.motion')}
                            value={motionPreference}
                            options={motionOptions}
                            onValueChange={(nextPref: MotionPreference) => setMotionPreference(nextPref)}
                        />
                    </div>

                    {/* Theme section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.theme.title')}
                        </div>
                        {appearanceOptions.map((opt) => {
                            const isSelected = appearance === opt.value
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setAppearance(opt.value)}
                                    className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    <span className="text-[var(--app-fg)]">{opt.label}</span>
                                    {isSelected ? (
                                        <span className="ml-2 text-[var(--app-link)]" aria-hidden="true">
                                            <CheckIcon />
                                        </span>
                                    ) : null}
                                </button>
                            )
                        })}

                        <button
                            type="button"
                            onClick={() => {
                                setOpenSheet('preset')
                            }}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                            aria-expanded={openSheet === 'preset'}
                            aria-haspopup="dialog"
                        >
                            <span className="text-[var(--app-fg)]">{t('settings.theme.preset')}</span>
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <span>{currentPresetLabel}</span>
                                <ChevronDownIcon className={`transition-transform ${openSheet === 'preset' ? 'rotate-180' : ''}`} />
                            </span>
                        </button>

                        <ActionSheetSelect
                            open={openSheet === 'preset'}
                            onOpenChange={(open) => setOpenSheet(open ? 'preset' : null)}
                            title={t('settings.theme.preset')}
                            value={preset}
                            options={presetOptions}
                            onValueChange={(nextPreset: ThemePreset) => setPreset(nextPreset)}
                        />
                    </div>

                    {/* Voice Assistant section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.voice.title')}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setOpenSheet('voice')
                            }}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                            aria-expanded={openSheet === 'voice'}
                            aria-haspopup="dialog"
                        >
                            <span className="text-[var(--app-fg)]">{t('settings.voice.language')}</span>
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <span>
                                    {currentVoiceLanguage
                                        ? currentVoiceLanguage.code === null
                                            ? t('settings.voice.autoDetect')
                                            : getLanguageDisplayName(currentVoiceLanguage)
                                        : t('settings.voice.autoDetect')}
                                </span>
                                <ChevronDownIcon className={`transition-transform ${openSheet === 'voice' ? 'rotate-180' : ''}`} />
                            </span>
                        </button>

                        <ActionSheetSelect
                            open={openSheet === 'voice'}
                            onOpenChange={(open) => setOpenSheet(open ? 'voice' : null)}
                            title={t('settings.voice.title')}
                            value={voiceLanguage}
                            options={voiceLanguages.map((lang) => ({
                                value: lang.code,
                                label: lang.code === null ? t('settings.voice.autoDetect') : getLanguageDisplayName(lang),
                            }))}
                            onValueChange={(nextCode: string | null) => {
                                setVoiceLanguage(nextCode)
                                if (nextCode === null) {
                                    localStorage.removeItem('hapi-voice-lang')
                                } else {
                                    localStorage.setItem('hapi-voice-lang', nextCode)
                                }
                            }}
                        />
                    </div>

                    {/* About section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.about.title')}
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.website')}</span>
                            <a
                                href="https://hapi.run"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--app-link)] hover:underline"
                            >
                                hapi.run
                            </a>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.appVersion')}</span>
                            <span className="text-[var(--app-hint)]">{__APP_VERSION__}</span>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.protocolVersion')}</span>
                            <span className="text-[var(--app-hint)]">{PROTOCOL_VERSION}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
