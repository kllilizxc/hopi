import { describe, expect, it } from 'vitest';
import { normalizeCodexSlashCommand } from './normalizeSlashCommand';

describe('normalizeCodexSlashCommand', () => {
    it('rewrites bare /diff to include staged changes', () => {
        expect(normalizeCodexSlashCommand('/diff')).toBe('/diff HEAD');
        expect(normalizeCodexSlashCommand('  /diff  ')).toBe('/diff HEAD');
    });

    it('keeps /diff with explicit arguments unchanged', () => {
        expect(normalizeCodexSlashCommand('/diff HEAD~1')).toBe('/diff HEAD~1');
    });

    it('keeps non-diff messages unchanged', () => {
        expect(normalizeCodexSlashCommand('hello')).toBe('hello');
    });
});
