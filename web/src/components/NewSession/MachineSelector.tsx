import type { Machine } from '@/types/api'
import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { ChevronDownIcon } from '@/assets/icons'
import { ActionSheetSelect } from '@/components/ui/ActionSheetSelect'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)

    const options = props.machines.map((m) => ({
        value: m.id,
        label: `${getMachineTitle(m)}${m.metadata?.platform ? ` (${m.metadata.platform})` : ''}`,
    }))

    const selectedMachine = props.machineId ? props.machines.find((m) => m.id === props.machineId) : null
    const selectedLabel = selectedMachine
        ? `${getMachineTitle(selectedMachine)}${selectedMachine.metadata?.platform ? ` (${selectedMachine.metadata.platform})` : ''}`
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
            <button
                type="button"
                disabled={isPickerDisabled}
                onClick={() => setOpen(true)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                <span className="min-w-0 flex-1 truncate text-left">
                    {selectedLabel || t('newSession.machine')}
                </span>
                <ChevronDownIcon className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            <ActionSheetSelect
                open={open}
                onOpenChange={setOpen}
                title={t('newSession.machine')}
                value={props.machineId ?? options[0]?.value ?? ''}
                options={options}
                onValueChange={(nextId) => props.onChange(nextId)}
            />
        </div>
    )
}
