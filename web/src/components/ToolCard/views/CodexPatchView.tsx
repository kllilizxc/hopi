import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { basename, resolveDisplayPath } from '@/utils/path'
import { getCodexPatchInputPaths } from '@/components/ToolCard/codexPatchTargets'

export function CodexPatchView(props: ToolViewProps) {
    const files = getCodexPatchInputPaths(props.block.tool.input)
    if (files.length === 0) return null

    return (
        <div className="flex flex-col gap-1">
            {files.map((file) => {
                const display = resolveDisplayPath(file, props.metadata)
                return (
                    <div key={file} className="text-sm text-[var(--app-fg)] font-mono break-all">
                        {basename(display)}
                    </div>
                )
            })}
        </div>
    )
}
