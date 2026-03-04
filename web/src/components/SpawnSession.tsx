import { useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { getMachineDisplayTitle } from '@/lib/displayNames'

type SessionType = 'simple' | 'worktree'

export function SpawnSession(props: {
    api: ApiClient
    machineId: string
    machine: Machine | null
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const [directory, setDirectory] = useState('')
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)

    const machineTitle = useMemo(() => getMachineDisplayTitle(props.machine, 'Machine'), [props.machine])

    async function spawn() {
        const trimmed = directory.trim()
        if (!trimmed) return

        setError(null)
        try {
            const result = await spawnSession({
                machineId: props.machineId,
                directory: trimmed,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined
            })
            if (result.type === 'success') {
                haptic.notification('success')
                props.onSuccess(result.sessionId)
                return
            }
            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to spawn session')
        }
    }

    return (
        <div className="p-3">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle>Create Session</CardTitle>
                    <CardDescription className="truncate">
                        {machineTitle}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="flex flex-col gap-3">
                        <input
                            type="text"
                            placeholder="/path/to/project"
                            value={directory}
                            onChange={(e) => setDirectory(e.target.value)}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />

                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                Session type
                            </label>
                            <div className="flex flex-col gap-2">
                                <SegmentedControl.Root
                                    value={sessionType}
                                    onValueChange={(value) => setSessionType(value as SessionType)}
                                    disabled={isPending}
                                    size="2"
                                    variant="surface"
                                >
                                    <SegmentedControl.Item value="simple">Simple</SegmentedControl.Item>
                                    <SegmentedControl.Item value="worktree">Worktree</SegmentedControl.Item>
                                </SegmentedControl.Root>

                                <div className="text-xs text-[var(--app-hint)]">
                                    {sessionType === 'worktree'
                                        ? 'Create a new worktree next to the repo'
                                        : 'Use the selected directory as-is'}
                                </div>

                                {sessionType === 'worktree' ? (
                                    <input
                                        type="text"
                                        placeholder="feature-x (default 1228-xxxx)"
                                        value={worktreeName}
                                        onChange={(e) => setWorktreeName(e.target.value)}
                                        disabled={isPending}
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-60"
                                    />
                                ) : null}
                            </div>
                        </div>

                        {(error ?? spawnError) ? (
                            <div className="text-sm text-red-600">
                                {error ?? spawnError}
                            </div>
                        ) : null}

                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={props.onCancel}
                                disabled={isPending}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={spawn}
                                disabled={isPending || !directory.trim()}
                            >
                                {isPending ? 'Creating…' : 'Create Session'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
