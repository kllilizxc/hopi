import { memo, useEffect, useMemo, useState } from 'react'
import { getModelLabel, getModelOptionsForFlavor, normalizeModelName, stripEffortFromModel, parseEffortFromModel, combineModelAndEffort, CODEX_REASONING_EFFORT_OPTIONS, type CodexReasoningEffort } from '@hopi/protocol'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { AdaptiveSelectTrigger } from '@/components/ui/AdaptiveSelectTrigger'

const CUSTOM_MODEL_VALUE = '__custom__'

export type ModelSelectorProps = {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
    compact?: boolean
}

const ModelSelectorComponent = (props: ModelSelectorProps) => {
    const { t } = useTranslation()
    const options = getModelOptionsForFlavor(props.agent)
    const baseModel = stripEffortFromModel(props.model) ?? props.model
    const hasKnownOption = options.some((opt) => opt.value === baseModel)
    const hasCustomModel = !hasKnownOption && normalizeModelName(baseModel) !== null
    const [customSelected, setCustomSelected] = useState(hasCustomModel)

    useEffect(() => {
        setCustomSelected(hasCustomModel)
    }, [hasCustomModel])

    const selectOptions = useMemo(
        () => [...options, { value: CUSTOM_MODEL_VALUE, label: t('newSession.model.custom') }],
        [options, t]
    )
    const selectValue = customSelected ? CUSTOM_MODEL_VALUE : hasKnownOption ? baseModel : 'auto'

    const selectedLabel = useMemo(
        () => {
            if (selectValue === CUSTOM_MODEL_VALUE) {
                return hasCustomModel
                    ? getModelLabel(baseModel, props.agent) ?? baseModel
                    : t('newSession.model.custom')
            }
            return options.find((opt) => opt.value === selectValue)?.label ?? getModelLabel(baseModel, props.agent) ?? baseModel
        },
        [hasCustomModel, options, props.agent, baseModel, selectValue, t]
    )

    const preserveEffort = (nextBase: string) => {
        const effort = parseEffortFromModel(props.model)
        return effort ? combineModelAndEffort(nextBase, effort) : nextBase
    }

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
                    props.onModelChange(preserveEffort(nextModel))
                }}
                disabled={props.isDisabled}
                align="start"
                trigger={
                    <AdaptiveSelectTrigger
                        disabled={props.isDisabled}
                        size="sm"
                        className="rounded-lg px-3"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
                        <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </AdaptiveSelectTrigger>
                }
            />
            {showCustomInput ? (
                <>
                    <input
                        type="text"
                        value={hasCustomModel ? baseModel : ''}
                        onChange={(event) => {
                            const nextValue = event.target.value
                            props.onModelChange(nextValue.trim() ? preserveEffort(nextValue) : 'auto')
                        }}
                        disabled={props.isDisabled}
                        placeholder={t('newSession.model.custom.placeholder')}
                        className="w-full rounded-lg app-shadow-border bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
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

type EffortSelectorProps = {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
}

const EffortSelectorComponent = (props: EffortSelectorProps) => {
    const { t } = useTranslation()

    if (props.agent !== 'codex') return null

    const currentEffort = parseEffortFromModel(props.model) ?? ''

    const effortLabel = CODEX_REASONING_EFFORT_OPTIONS.find((o) => o.value === currentEffort)?.label ?? 'Auto'

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.model.effort') ?? 'Reasoning Effort'}
            </label>
            <AdaptiveSelect
                title={t('newSession.model.effort') ?? 'Reasoning Effort'}
                value={currentEffort}
                options={CODEX_REASONING_EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                onValueChange={(nextEffort) => {
                    const next = nextEffort as CodexReasoningEffort | ''
                    props.onModelChange(combineModelAndEffort(props.model, next || null))
                }}
                disabled={props.isDisabled}
                align="start"
                trigger={
                    <AdaptiveSelectTrigger
                        disabled={props.isDisabled}
                        size="sm"
                        className="rounded-lg px-3"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">{effortLabel}</span>
                        <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </AdaptiveSelectTrigger>
                }
            />
        </div>
    )
}

export const EffortSelector = memo(EffortSelectorComponent)

type ModelWithEffortProps = {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
    compact?: boolean
}

const ModelWithEffortComponent = (props: ModelWithEffortProps) => {
    const { t } = useTranslation()

    if (props.agent !== 'codex') {
        return <ModelSelector {...props} />
    }

    const currentEffort = parseEffortFromModel(props.model) ?? ''
    const effortLabel = CODEX_REASONING_EFFORT_OPTIONS.find((o) => o.value === currentEffort)?.label ?? 'Auto'

    const content = (
        <>
            <div className="flex gap-2 items-end">
                <div className="flex-1 min-w-0">
                    <ModelSelector
                        agent={props.agent}
                        model={props.model}
                        isDisabled={props.isDisabled}
                        onModelChange={props.onModelChange}
                        compact
                    />
                </div>
                <div className="w-[110px] shrink-0">
                    <AdaptiveSelect
                        title={t('newSession.model.effort') ?? 'Reasoning Effort'}
                        value={currentEffort}
                        options={CODEX_REASONING_EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        onValueChange={(nextEffort) => {
                            const next = nextEffort as CodexReasoningEffort | ''
                            props.onModelChange(combineModelAndEffort(props.model, next || null))
                        }}
                        disabled={props.isDisabled}
                        align="start"
                        trigger={
                            <AdaptiveSelectTrigger
                                disabled={props.isDisabled}
                                size="sm"
                                className="rounded-lg px-3"
                            >
                                <span className="min-w-0 flex-1 truncate text-left">{effortLabel}</span>
                                <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                            </AdaptiveSelectTrigger>
                        }
                    />
                </div>
            </div>
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

export const ModelWithEffort = memo(ModelWithEffortComponent)
