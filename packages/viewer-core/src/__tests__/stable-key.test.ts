/**
 * Tests for viewer-core stableKey function.
 *
 */
import { describe, it, expect } from 'vitest';
import { stableKey } from '../stable-key.js';

describe('stableKey', () => {
  it('joins kind, repositoryId, and segments with "::"', () => {
    const key = stableKey('file', 'repo-1', 'src/index.ts');
    expect(key).toBe('file::repo-1::src/index.ts');
  });

  it('handles multiple segments', () => {
    const key = stableKey('symbol', 'repo-1', 'src/index.ts', 'myFunction');
    expect(key).toBe('symbol::repo-1::src/index.ts::myFunction');
  });

  it('handles no segments (just kind and repositoryId)', () => {
    const key = stableKey('repository', 'repo-1');
    expect(key).toBe('repository::repo-1');
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = stableKey('file', 'repo-1', 'src/app.ts');
    const b = stableKey('file', 'repo-1', 'src/app.ts');
    expect(a).toBe(b);
  });

  it('differentiates on kind', () => {
    const fileKey = stableKey('file', 'repo-1', 'src/index.ts');
    const symbolKey = stableKey('symbol', 'repo-1', 'src/index.ts');
    expect(fileKey).not.toBe(symbolKey);
  });

  it('differentiates on repositoryId', () => {
    const a = stableKey('file', 'repo-1', 'src/index.ts');
    const b = stableKey('file', 'repo-2', 'src/index.ts');
    expect(a).not.toBe(b);
  });
});
