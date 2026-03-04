import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { getMachineDisplayTitle } from '@/lib/displayNames'
import { ChevronDownIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'

export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()

    const options = props.machines.map((m) => ({
        value: m.id,
        label: `${getMachineDisplayTitle(m)}${m.metadata?.platform ? ` (${m.metadata.platform})` : ''}`,
    }))

    const selectedMachine = props.machineId ? props.machines.find((m) => m.id === props.machineId) : null
    const selectedLabel = selectedMachine
        ? `${getMachineDisplayTitle(selectedMachine)}${selectedMachine.metadata?.platform ? ` (${selectedMachine.metadata.platform})` : ''}`
        : props.isLoading
            ? t('loading.machines')
            : props.machines.length === 0
                ? t('misc.noMachines')
                : options[0]?.label ?? ''

    const isPickerDisabled = props.isDisabled || Boolean(props.isLoading) || props.machines.length === 0

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.machine')}
            </label>
            <AdaptiveSelect
                title={t('newSession.machine')}
                value={props.machineId ?? options[0]?.value ?? ''}
                options={options}
                onValueChange={(nextId) => props.onChange(nextId)}
                disabled={isPickerDisabled}
                align="start"
                trigger={
                    <button
                        type="button"
                        disabled={isPickerDisabled}
                        className="group flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">
                            {selectedLabel || t('newSession.machine')}
                        </span>
                        <ChevronDownIcon className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </button>
                }
            />
        </div>
    )
}
