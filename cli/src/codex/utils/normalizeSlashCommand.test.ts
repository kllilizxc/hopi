import { describe, expect, it } from 'vitest';
import { normalizeCodexSlashCommand } from './normalizeSlashCommand';

describe('normalizeCodexSlashCommand', () => {
    it('rewrites bare /diff to include staged changes by default', () => {
        expect(normalizeCodexSlashCommand('/diff')).toBe('/diff HEAD');
        expect(normalizeCodexSlashCommand('  /diff  ')).toBe('/diff HEAD');
    });

    it('uses session base commit for bare /diff when provided', () => {
        expect(normalizeCodexSlashCommand('/diff', { diffBaseRef: 'abc1234' })).toBe('/diff abc1234');
    });

    it('falls back to HEAD for invalid base refs', () => {
        expect(normalizeCodexSlashCommand('/diff', { diffBaseRef: 'HEAD' })).toBe('/diff HEAD');
        expect(normalizeCodexSlashCommand('/diff', { diffBaseRef: 'not-a-hash' })).toBe('/diff HEAD');
    });

    it('keeps /diff with explicit arguments unchanged', () => {
        expect(normalizeCodexSlashCommand('/diff HEAD~1')).toBe('/diff HEAD~1');
    });

    it('keeps non-diff messages unchanged', () => {
        expect(normalizeCodexSlashCommand('hello')).toBe('hello');
    });
});
