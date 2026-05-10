import type { HopiActionPacketView, HopiActionView } from '@/lib/hopi-action-packet'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
    const value = t(key)
    return value === key ? fallback : value
}

function actionToneClass(action: HopiActionView): string {
    if (action.status === 'blocked') {
        return 'shadow-[inset_0_0_0_1px_rgb(239_68_68_/_0.35)] bg-red-500/5'
    }
    if (action.status === 'finished') {
        return 'shadow-[inset_0_0_0_1px_rgb(16_185_129_/_0.30)] bg-emerald-500/5'
    }
    if (action.status === 'in_review') {
        return 'shadow-[inset_0_0_0_1px_rgb(245_158_11_/_0.30)] bg-amber-500/5'
    }
    return 'app-shadow-border bg-[var(--app-subtle-bg)]'
}

function ActionTextSection(props: { label: string; text: string }) {
    return (
        <div className="min-w-0">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                {props.label}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--app-fg)]">
                {props.text}
            </div>
        </div>
    )
}

function HopiActionItem(props: { action: HopiActionView }) {
    const { t } = useTranslation()
    const title = translateWithFallback(t, props.action.titleKey, props.action.titleFallback)
    const handoffLabel = props.action.status === 'blocked'
        ? t('hopiActions.field.why')
        : t('hopiActions.field.handoff')

    return (
        <div className={cn('rounded-lg p-3', actionToneClass(props.action))}>
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                <div className="min-w-0 text-sm font-semibold text-[var(--app-fg)]">
                    {title}
                </div>
                <div className="rounded app-shadow-border px-1.5 py-0.5 font-mono text-[11px] text-[var(--app-hint)]">
                    {props.action.type}
                </div>
            </div>
            <div className="space-y-3">
                {props.action.handoff ? (
                    <ActionTextSection label={handoffLabel} text={props.action.handoff} />
                ) : null}
                {props.action.evidence ? (
                    <ActionTextSection label={t('hopiActions.field.evidence')} text={props.action.evidence} />
                ) : null}
                {props.action.description ? (
                    <ActionTextSection label={t('hopiActions.field.details')} text={props.action.description} />
                ) : null}
            </div>
        </div>
    )
}

export function HopiActionPacketCard(props: { packet: HopiActionPacketView }) {
    const { t } = useTranslation()

    return (
        <div className="min-w-0 max-w-full rounded-lg app-shadow-border bg-[var(--app-bg)] p-3">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                        HOPI_ACTIONS
                    </div>
                    <div className="text-sm font-semibold text-[var(--app-fg)]">
                        {t('hopiActions.title')}
                    </div>
                </div>
            </div>
            <div className="space-y-3">
                {props.packet.actions.map((action, index) => (
                    <HopiActionItem
                        key={`${action.type}:${action.status ?? 'none'}:${index}`}
                        action={action}
                    />
                ))}
            </div>
            <details className="mt-3">
                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                    {t('hopiActions.raw')}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--app-code-bg)] p-2 text-xs text-[var(--app-fg)]">{props.packet.rawPayload}</pre>
            </details>
        </div>
    )
}
