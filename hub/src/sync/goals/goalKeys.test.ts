import { describe, expect, it } from 'bun:test'
import { buildUniqueGoalKey, normalizeGoalKey } from '@hopi/protocol'

describe('goal key helpers', () => {
    it('normalizes titles into stable lowercase kebab keys', () => {
        expect(normalizeGoalKey('  Mobile Remote Control  ')).toBe('mobile-remote-control')
        expect(normalizeGoalKey('Goal: CLI + Runner stability')).toBe('goal-cli-runner-stability')
        expect(normalizeGoalKey('中文目标')).toBe('goal')
    })

    it('creates deterministic unique suffixes', () => {
        const existing = new Set(['mobile-remote-control', 'mobile-remote-control-2'])
        expect(buildUniqueGoalKey('Mobile remote control', (key) => existing.has(key))).toBe('mobile-remote-control-3')
    })
})
