import { memo, useEffect, useMemo, useState } from 'react'
import { getModelLabel, getModelOptionsForFlavor, normalizeModelName } from '@hopi/protocol'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'

const CUSTOM_MODEL_VALUE = '__custom__'

type ModelSelectorProps = {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
    compact?: boolean
}

const ModelSelectorComponent = (props: ModelSelectorProps) => {
    const { t } = useTranslation()
    const options = getModelOptionsForFlavor(props.agent)
    const hasKnownOption = options.some((opt) => opt.value === props.model)
    const hasCustomModel = !hasKnownOption && normalizeModelName(props.model) !== null
    const [customSelected, setCustomSelected] = useState(hasCustomModel)

    useEffect(() => {
        setCustomSelected(hasCustomModel)
    }, [hasCustomModel])

    const selectOptions = useMemo(
        () => [...options, { value: CUSTOM_MODEL_VALUE, label: t('newSession.model.custom') }],
        [options, t]
    )
    const selectValue = customSelected ? CUSTOM_MODEL_VALUE : hasKnownOption ? props.model : 'auto'

    const selectedLabel = useMemo(
        () => {
            if (selectValue === CUSTOM_MODEL_VALUE) {
                return hasCustomModel
                    ? getModelLabel(props.model, props.agent) ?? props.model
                    : t('newSession.model.custom')
            }
            return options.find((opt) => opt.value === selectValue)?.label ?? getModelLabel(props.model, props.agent) ?? props.model
        },
        [hasCustomModel, options, props.agent, props.model, selectValue, t]
    )

    if (options.length === 0) {
        return null
    }

    const showCustomInput = customSelected || hasCustomModel

    const content = (
        <>
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.model')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <AdaptiveSelect
                title={t('newSession.model')}
                value={selectValue}
                options={selectOptions}
                onValueChange={(nextModel) => {
                    if (nextModel === CUSTOM_MODEL_VALUE) {
                        setCustomSelected(true)
                        return
                    }
                    setCustomSelected(false)
                    props.onModelChange(nextModel)
                }}
                disabled={props.isDisabled}
                align="start"
                trigger={
                    <button
                        type="button"
                        disabled={props.isDisabled}
                        className="group flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
                        <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </button>
                }
            />
            {showCustomInput ? (
                <>
                    <input
                        type="text"
                        value={hasCustomModel ? props.model : ''}
                        onChange={(event) => {
                            const nextValue = event.target.value
                            props.onModelChange(nextValue.trim() ? nextValue : 'auto')
                        }}
                        disabled={props.isDisabled}
                        placeholder={t('newSession.model.custom.placeholder')}
                        className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <div className="text-xs text-[var(--app-hint)]">{t('newSession.model.custom.hint')}</div>
                </>
            ) : null}
        </>
    )

    if (props.compact) {
        return content
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            {content}
        </div>
    )
}

export const ModelSelector = memo(ModelSelectorComponent)
