import { describe, expect, it } from 'vitest'
import { getTaskPermissionModeOptionsForFlavor, resolveTaskPermissionModeForFlavor } from './taskPermissionMode'

describe('taskPermissionMode', () => {
    it('adds plan mode to codex task options', () => {
        const options = getTaskPermissionModeOptionsForFlavor('codex')
        expect(options.some((option) => option.mode === 'plan')).toBe(true)
    })

    it('keeps preferred mode when supported for task flavor', () => {
        const mode = resolveTaskPermissionModeForFlavor('codex', 'plan')
        expect(mode).toBe('plan')
    })
})
