import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { DirectoryEntry } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useMachineDirectory(
    api: ApiClient | null,
    machineId: string | null,
    path: string,
    options?: { enabled?: boolean }
): {
    currentPath: string | null
    entries: DirectoryEntry[]
    error: string | null
    isLoading: boolean
    refetch: () => Promise<unknown>
} {
    const resolvedMachineId = machineId ?? 'unknown'
    const enabled = Boolean(api && machineId) && (options?.enabled ?? true)

    const query = useQuery({
        queryKey: queryKeys.machineDirectory(resolvedMachineId, path),
        queryFn: async () => {
            if (!api || !machineId) {
                throw new Error('Machine unavailable')
            }

            const response = await api.listMachineDirectory(machineId, path)
            if (!response.success) {
                return {
                    currentPath: null,
                    entries: [],
                    error: response.error ?? 'Failed to list directory'
                }
            }

            return {
                currentPath: response.path,
                entries: response.entries,
                error: null
            }
        },
        enabled,
    })

    const queryError = query.error instanceof Error
        ? query.error.message
        : query.error
            ? 'Failed to list directory'
            : null

    return {
        currentPath: query.data?.currentPath ?? null,
        entries: query.data?.entries ?? [],
        error: queryError ?? query.data?.error ?? null,
        isLoading: query.isLoading,
        refetch: query.refetch
    }
}
