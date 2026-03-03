import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import { useTranslation } from '@/lib/use-translation'
import {
    AbortIcon,
    AttachmentIcon,
    LoadingIcon,
    SendIcon,
    SettingsIcon,
    SpeakerIcon,
    StopIcon,
    SwitchToRemoteIcon,
    TerminalIcon,
    VoiceAssistantIcon
} from '@/assets/icons'

function UnifiedButton(props: {
    canSend: boolean
    voiceStatus: ConversationStatus
    voiceEnabled: boolean
    controlsDisabled: boolean
    onSend: () => void
    onVoiceToggle: () => void
}) {
    const { t } = useTranslation()

    // Determine button state
    const isConnecting = props.voiceStatus === 'connecting'
    const isConnected = props.voiceStatus === 'connected'
    const isVoiceActive = isConnecting || isConnected
    const hasText = props.canSend

    // Determine button behavior
    const handleClick = () => {
        if (isVoiceActive) {
            props.onVoiceToggle() // Stop voice
        } else if (hasText) {
            props.onSend() // Send message
        } else if (props.voiceEnabled) {
            props.onVoiceToggle() // Start voice
        }
    }

    // Determine button style and icon
    let icon: React.ReactNode
    let className: string
    let ariaLabel: string

    if (isConnecting) {
        icon = <LoadingIcon />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('voice.connecting')
    } else if (isConnected) {
        icon = <StopIcon />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.stop')
    } else if (hasText) {
        icon = <SendIcon />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.send')
    } else if (props.voiceEnabled) {
        icon = <VoiceAssistantIcon />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.voice')
    } else {
        icon = <SendIcon />
        className = 'bg-[var(--app-border)] text-[var(--app-hint)]'
        ariaLabel = t('composer.send')
    }

    const isDisabled = props.controlsDisabled || (!hasText && !props.voiceEnabled && !isVoiceActive)

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isDisabled}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
            {icon}
        </button>
    )
}

export function ComposerButtons(props: {
    canSend: boolean
    controlsDisabled: boolean
    showSettingsButton: boolean
    onSettingsToggle: () => void
    showTerminalButton: boolean
    terminalDisabled: boolean
    onTerminal: () => void
    showAbortButton: boolean
    abortDisabled: boolean
    isAborting: boolean
    onAbort: () => void
    showSwitchButton: boolean
    switchDisabled: boolean
    isSwitching: boolean
    onSwitch: () => void
    voiceEnabled: boolean
    voiceStatus: ConversationStatus
    voiceMicMuted?: boolean
    onVoiceToggle: () => void
    onVoiceMicToggle?: () => void
    onSend: () => void
}) {
    const { t } = useTranslation()
    const isVoiceConnected = props.voiceStatus === 'connected'

    return (
        <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-2">
                <ComposerPrimitive.AddAttachment
                    aria-label={t('composer.attach')}
                    title={t('composer.attach')}
                    disabled={props.controlsDisabled}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <AttachmentIcon />
                </ComposerPrimitive.AddAttachment>

                {props.showSettingsButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.settings')}
                        title={t('composer.settings')}
                        className="settings-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        onClick={props.onSettingsToggle}
                        disabled={props.controlsDisabled}
                    >
                        <SettingsIcon />
                    </button>
                ) : null}

                {props.showTerminalButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.terminal')}
                        title={t('composer.terminal')}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onTerminal}
                        disabled={props.terminalDisabled}
                    >
                        <TerminalIcon />
                    </button>
                ) : null}

                {props.showAbortButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.abort')}
                        title={t('composer.abort')}
                        disabled={props.abortDisabled}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onAbort}
                    >
                        <AbortIcon spinning={props.isAborting} />
                    </button>
                ) : null}

                {props.showSwitchButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.switchRemote')}
                        title={t('composer.switchRemote')}
                        disabled={props.switchDisabled}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onSwitch}
                    >
                        <SwitchToRemoteIcon />
                    </button>
                ) : null}

                {isVoiceConnected && props.onVoiceMicToggle ? (
                    <button
                        type="button"
                        aria-label={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                        title={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                        className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${
                            props.voiceMicMuted
                                ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                : 'text-[var(--app-fg)]/60 hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                        }`}
                        onClick={props.onVoiceMicToggle}
                    >
                        <SpeakerIcon muted={props.voiceMicMuted} />
                    </button>
                ) : null}
            </div>

            <UnifiedButton
                canSend={props.canSend}
                voiceStatus={props.voiceStatus}
                voiceEnabled={props.voiceEnabled}
                controlsDisabled={props.controlsDisabled}
                onSend={props.onSend}
                onVoiceToggle={props.onVoiceToggle}
            />
        </div>
    )
}
