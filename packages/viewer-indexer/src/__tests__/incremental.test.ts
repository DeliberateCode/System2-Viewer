/**
 * Tests for incremental indexing: SHA-256 hashing and diff algorithm.
 *
 */
import { describe, it, expect } from 'vitest';
import { hashFileContent, computeIncrementalDiff, computeStatDiff } from '../incremental.js';
import type { IncrementalDiff, StatFingerprint } from '../incremental.js';

describe('hashFileContent', () => {
  it('returns deterministic SHA-256 hex for known input', () => {
    // echo -n "hello" | sha256sum => 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hash = hashFileContent('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns different hash for different input', () => {
    const a = hashFileContent('hello');
    const b = hashFileContent('world');
    expect(a).not.toBe(b);
  });

  it('returns same hash for identical input', () => {
    const a = hashFileContent('const x = 1;');
    const b = hashFileContent('const x = 1;');
    expect(a).toBe(b);
  });

  it('returns 64-char hex string', () => {
    const hash = hashFileContent('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty string', () => {
    // echo -n "" | sha256sum => e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = hashFileContent('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('computeIncrementalDiff', () => {
  it('classifies unchanged files correctly', () => {
    const currentFiles = new Map([
      ['src/a.ts', 'hashA'],
      ['src/b.ts', 'hashB'],
    ]);
    const storedHashes = new Map([
      ['src/a.ts', 'hashA'],
      ['src/b.ts', 'hashB'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('classifies changed files correctly', () => {
    const currentFiles = new Map([
      ['src/a.ts', 'hashA-new'],
      ['src/b.ts', 'hashB'],
    ]);
    const storedHashes = new Map([
      ['src/a.ts', 'hashA-old'],
      ['src/b.ts', 'hashB'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual(['src/b.ts']);
    expect(diff.changed).toEqual(['src/a.ts']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('classifies added files correctly', () => {
    const currentFiles = new Map([
      ['src/a.ts', 'hashA'],
      ['src/c.ts', 'hashC'],
    ]);
    const storedHashes = new Map([
      ['src/a.ts', 'hashA'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual(['src/a.ts']);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual(['src/c.ts']);
    expect(diff.removed).toEqual([]);
  });

  it('classifies removed files correctly', () => {
    const currentFiles = new Map([
      ['src/a.ts', 'hashA'],
    ]);
    const storedHashes = new Map([
      ['src/a.ts', 'hashA'],
      ['src/b.ts', 'hashB'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual(['src/a.ts']);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['src/b.ts']);
  });

  it('handles mixed scenario: unchanged, changed, added, removed', () => {
    const currentFiles = new Map([
      ['src/unchanged.ts', 'hash1'],
      ['src/changed.ts', 'hash2-new'],
      ['src/added.ts', 'hash3'],
    ]);
    const storedHashes = new Map([
      ['src/unchanged.ts', 'hash1'],
      ['src/changed.ts', 'hash2-old'],
      ['src/removed.ts', 'hash4'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual(['src/unchanged.ts']);
    expect(diff.changed).toEqual(['src/changed.ts']);
    expect(diff.added).toEqual(['src/added.ts']);
    expect(diff.removed).toEqual(['src/removed.ts']);
  });

  it('handles empty current files', () => {
    const currentFiles = new Map<string, string>();
    const storedHashes = new Map([
      ['src/a.ts', 'hashA'],
    ]);
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['src/a.ts']);
  });

  it('handles empty stored hashes (first indexing)', () => {
    const currentFiles = new Map([
      ['src/a.ts', 'hashA'],
      ['src/b.ts', 'hashB'],
    ]);
    const storedHashes = new Map<string, string>();
    const diff = computeIncrementalDiff(currentFiles, storedHashes);
    expect(diff.unchanged).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diff.removed).toEqual([]);
  });

  it('handles both empty', () => {
    const diff = computeIncrementalDiff(new Map(), new Map());
    expect(diff.unchanged).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});

describe('computeStatDiff', () => {
  const stat = (mtimeMs: number, size: number): StatFingerprint => ({ mtimeMs, size });

  it('classifies unchanged files when stat matches', () => {
    const current = new Map([
      ['src/a.ts', stat(1000, 200)],
      ['src/b.ts', stat(2000, 300)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', stat(1000, 200)],
      ['src/b.ts', stat(2000, 300)],
    ]);
    const storedPaths = new Set(['src/a.ts', 'src/b.ts']);
    const diff = computeStatDiff(current, stored, storedPaths);
    expect(diff.unchanged).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('classifies changed files when mtime differs', () => {
    const current = new Map([
      ['src/a.ts', stat(9999, 200)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const diff = computeStatDiff(current, stored, new Set(['src/a.ts']));
    expect(diff.changed).toEqual(['src/a.ts']);
    expect(diff.unchanged).toEqual([]);
  });

  it('classifies changed files when size differs', () => {
    const current = new Map([
      ['src/a.ts', stat(1000, 500)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const diff = computeStatDiff(current, stored, new Set(['src/a.ts']));
    expect(diff.changed).toEqual(['src/a.ts']);
  });

  it('treats null stored stat as changed (pre-migration data)', () => {
    const current = new Map([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', null],
    ]);
    const diff = computeStatDiff(current, stored, new Set(['src/a.ts']));
    expect(diff.changed).toEqual(['src/a.ts']);
    expect(diff.unchanged).toEqual([]);
  });

  it('classifies new files as added', () => {
    const current = new Map([
      ['src/a.ts', stat(1000, 200)],
      ['src/new.ts', stat(3000, 100)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const diff = computeStatDiff(current, stored, new Set(['src/a.ts']));
    expect(diff.added).toEqual(['src/new.ts']);
    expect(diff.unchanged).toEqual(['src/a.ts']);
  });

  it('classifies removed files', () => {
    const current = new Map([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/a.ts', stat(1000, 200)],
    ]);
    const storedPaths = new Set(['src/a.ts', 'src/removed.ts']);
    const diff = computeStatDiff(current, stored, storedPaths);
    expect(diff.removed).toEqual(['src/removed.ts']);
    expect(diff.unchanged).toEqual(['src/a.ts']);
  });

  it('handles mixed scenario', () => {
    const current = new Map([
      ['src/unchanged.ts', stat(1000, 100)],
      ['src/changed.ts', stat(9999, 100)],
      ['src/added.ts', stat(5000, 50)],
    ]);
    const stored = new Map<string, StatFingerprint | null>([
      ['src/unchanged.ts', stat(1000, 100)],
      ['src/changed.ts', stat(2000, 100)],
    ]);
    const storedPaths = new Set(['src/unchanged.ts', 'src/changed.ts', 'src/removed.ts']);
    const diff = computeStatDiff(current, stored, storedPaths);
    expect(diff.unchanged).toEqual(['src/unchanged.ts']);
    expect(diff.changed).toEqual(['src/changed.ts']);
    expect(diff.added).toEqual(['src/added.ts']);
    expect(diff.removed).toEqual(['src/removed.ts']);
  });

  it('handles empty inputs', () => {
    const diff = computeStatDiff(new Map(), new Map(), new Set());
    expect(diff.unchanged).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
