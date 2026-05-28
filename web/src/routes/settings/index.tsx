import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { getElevenLabsSupportedLanguages, getLanguageDisplayName } from '@/lib/languages'
import { getFontScaleOptions, useFontScale, type FontScale } from '@/hooks/useFontScale'
import { useTheme, type Appearance, type ThemePreset } from '@/hooks/useTheme'
import { useMotionPreference, type MotionPreference } from '@/hooks/useMotionPreference'
import { PROTOCOL_VERSION } from '@hopi/protocol'
import { PRODUCT_DEFAULT_SITE_URL, productStorageKey } from '@hopi/protocol/brand'
import { CheckIcon } from '@/assets/icons'
import { PageHeader } from '@/components/PageHeader'
import { SettingsSelectRow } from '@/components/SettingsSelectRow'

const locales: { value: Locale; nativeLabel: string }[] = [
    { value: 'en', nativeLabel: 'English' },
    { value: 'zh-CN', nativeLabel: '简体中文' },
]
const VOICE_LANG_STORAGE_KEY = productStorageKey('voice-lang')
const OFFICIAL_SITE_HOST = new URL(PRODUCT_DEFAULT_SITE_URL).host

const voiceLanguages = getElevenLabsSupportedLanguages()

export default function SettingsPage() {
    const { t, locale, setLocale } = useTranslation()
    const goBack = useAppGoBack()
    const { appearance, setAppearance, preset, setPreset } = useTheme()
    const { fontScale, setFontScale } = useFontScale()
    const { preference: motionPreference, setPreference: setMotionPreference } = useMotionPreference()

    // Voice language state - read from localStorage
    const [voiceLanguage, setVoiceLanguage] = useState<string | null>(() => {
        return localStorage.getItem(VOICE_LANG_STORAGE_KEY)
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
            <PageHeader
                title={t('settings.title')}
                onBack={goBack}
                backLabel={t('projects.actions.back')}
                borderClassName="app-shadow-divider-b"
                contentClassName="p-3"
            />

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {/* Language section */}
                    <div className="app-shadow-divider-b">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.language.title')}
                        </div>
                        <SettingsSelectRow
                            title={t('settings.language.title')}
                            label={t('settings.language.label')}
                            value={locale}
                            valueLabel={currentLocale?.nativeLabel ?? ''}
                            options={locales.map((loc) => ({ value: loc.value, label: loc.nativeLabel }))}
                            onValueChange={(nextLocale: Locale) => setLocale(nextLocale)}
                        />
                    </div>

                    {/* Display section */}
                    <div className="app-shadow-divider-b">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.display.title')}
                        </div>
                        <SettingsSelectRow
                            title={t('settings.display.fontSize')}
                            label={t('settings.display.fontSize')}
                            value={fontScale}
                            valueLabel={currentFontScaleLabel}
                            options={fontScaleOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                            onValueChange={(nextScale: FontScale) => setFontScale(nextScale)}
                        />

                        <SettingsSelectRow
                            title={t('settings.display.motion')}
                            label={t('settings.display.motion')}
                            value={motionPreference}
                            valueLabel={currentMotionLabel}
                            options={motionOptions}
                            onValueChange={(nextPref: MotionPreference) => setMotionPreference(nextPref)}
                        />
                    </div>

                    {/* Theme section */}
                    <div className="app-shadow-divider-b">
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

                        <SettingsSelectRow
                            title={t('settings.theme.preset')}
                            label={t('settings.theme.preset')}
                            value={preset}
                            valueLabel={currentPresetLabel}
                            options={presetOptions}
                            onValueChange={(nextPreset: ThemePreset) => setPreset(nextPreset)}
                        />
                    </div>

                    {/* Voice Assistant section */}
                    <div className="app-shadow-divider-b">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.voice.title')}
                        </div>
                        <SettingsSelectRow
                            title={t('settings.voice.title')}
                            label={t('settings.voice.language')}
                            value={voiceLanguage}
                            valueLabel={
                                currentVoiceLanguage
                                    ? currentVoiceLanguage.code === null
                                        ? t('settings.voice.autoDetect')
                                        : getLanguageDisplayName(currentVoiceLanguage)
                                    : t('settings.voice.autoDetect')
                            }
                            options={voiceLanguages.map((lang) => ({
                                value: lang.code,
                                label: lang.code === null ? t('settings.voice.autoDetect') : getLanguageDisplayName(lang),
                            }))}
                            onValueChange={(nextCode: string | null) => {
                                setVoiceLanguage(nextCode)
                                if (nextCode === null) {
                                    localStorage.removeItem(VOICE_LANG_STORAGE_KEY)
                                } else {
                                    localStorage.setItem(VOICE_LANG_STORAGE_KEY, nextCode)
                                }
                            }}
                        />
                    </div>

                    {/* About section */}
                    <div className="app-shadow-divider-b">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.about.title')}
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.website')}</span>
                            <a
                                href={PRODUCT_DEFAULT_SITE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--app-link)] hover:underline"
                            >
                                {OFFICIAL_SITE_HOST}
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
