/**
 * Tests for rename detection: content-hash matching with path similarity tiebreaker.
 */
import { describe, it, expect } from 'vitest';
import { detectRenames, pathSimilarity } from '../rename-detect.js';
import type { RenameCandidate } from '../rename-detect.js';

// ---------------------------------------------------------------------------
// pathSimilarity
// ---------------------------------------------------------------------------

describe('pathSimilarity', () => {
  it('returns 0 for identical strings', () => {
    expect(pathSimilarity('foo.ts', 'foo.ts')).toBe(0);
  });

  it('returns 1 for completely different strings (one empty)', () => {
    expect(pathSimilarity('abc', '')).toBe(1);
    expect(pathSimilarity('', 'abc')).toBe(1);
  });

  it('returns 0 for two empty strings', () => {
    expect(pathSimilarity('', '')).toBe(0);
  });

  it('returns a value in (0,1) for similar strings', () => {
    const score = pathSimilarity('index.ts', 'index.tsx');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns a lower score for more similar strings', () => {
    const closeScore = pathSimilarity('utils.ts', 'utils.tsx');
    const farScore = pathSimilarity('utils.ts', 'server.go');
    expect(closeScore).toBeLessThan(farScore);
  });
});

// ---------------------------------------------------------------------------
// detectRenames
// ---------------------------------------------------------------------------

describe('detectRenames', () => {
  it('returns empty array when removed is empty', () => {
    const result = detectRenames([], ['src/new.ts'], new Map([['src/new.ts', 'hashA']]));
    expect(result).toEqual([]);
  });

  it('returns empty array when added is empty', () => {
    const result = detectRenames(['src/old.ts'], [], new Map([['src/old.ts', 'hashA']]));
    expect(result).toEqual([]);
  });

  it('returns empty array when no hashes match', () => {
    const hashes = new Map([
      ['src/old.ts', 'hashA'],
      ['src/new.ts', 'hashB'],
    ]);
    const result = detectRenames(['src/old.ts'], ['src/new.ts'], hashes);
    expect(result).toEqual([]);
  });

  it('detects a single exact rename with confidence 1.0', () => {
    const hashes = new Map([
      ['src/old.ts', 'hashA'],
      ['lib/new.ts', 'hashA'],
    ]);
    const result = detectRenames(['src/old.ts'], ['lib/new.ts'], hashes);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      oldPath: 'src/old.ts',
      newPath: 'lib/new.ts',
      confidence: 1.0,
    });
  });

  it('detects multiple renames', () => {
    const hashes = new Map([
      ['a.ts', 'hash1'],
      ['b.ts', 'hash2'],
      ['x.ts', 'hash1'],
      ['y.ts', 'hash2'],
    ]);
    const result = detectRenames(['a.ts', 'b.ts'], ['x.ts', 'y.ts'], hashes);
    expect(result).toHaveLength(2);
    const aRename = result.find(r => r.oldPath === 'a.ts');
    const bRename = result.find(r => r.oldPath === 'b.ts');
    expect(aRename).toBeDefined();
    expect(aRename!.newPath).toBe('x.ts');
    expect(aRename!.confidence).toBe(1.0);
    expect(bRename).toBeDefined();
    expect(bRename!.newPath).toBe('y.ts');
    expect(bRename!.confidence).toBe(1.0);
  });

  it('uses basename similarity as tiebreaker when multiple added files share a hash', () => {
    const hashes = new Map([
      ['old/utils.ts', 'hashA'],
      ['new/utils.ts', 'hashA'],
      ['new/helpers.ts', 'hashA'],
    ]);
    const result = detectRenames(
      ['old/utils.ts'],
      ['new/utils.ts', 'new/helpers.ts'],
      hashes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe('old/utils.ts');
    // 'utils.ts' basename matches 'utils.ts' exactly, not 'helpers.ts'
    expect(result[0].newPath).toBe('new/utils.ts');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('does not claim the same added file twice', () => {
    // Both removed files have the same hash, but only one added file matches
    const hashes = new Map([
      ['src/a.ts', 'hashA'],
      ['src/b.ts', 'hashA'],
      ['lib/c.ts', 'hashA'],
    ]);
    const result = detectRenames(['src/a.ts', 'src/b.ts'], ['lib/c.ts'], hashes);
    // Only first removed file gets matched (lib/c.ts is claimed)
    expect(result).toHaveLength(1);
    expect(result[0].newPath).toBe('lib/c.ts');
  });

  it('skips files with no hash in the map', () => {
    const hashes = new Map([
      ['src/old.ts', 'hashA'],
      // 'lib/new.ts' intentionally missing from hashes
    ]);
    const result = detectRenames(['src/old.ts'], ['lib/new.ts'], hashes);
    expect(result).toEqual([]);
  });

  it('tiebreaker confidence is at least 0.5', () => {
    const hashes = new Map([
      ['old/foo.ts', 'hashA'],
      ['new/completely-different-name.ts', 'hashA'],
      ['new/also-different.ts', 'hashA'],
    ]);
    const result = detectRenames(
      ['old/foo.ts'],
      ['new/completely-different-name.ts', 'new/also-different.ts'],
      hashes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('respects custom similarityThreshold', () => {
    const hashes = new Map([
      ['old/foo.ts', 'hashA'],
      ['new/completely-different-name.ts', 'hashA'],
      ['new/also-different.ts', 'hashA'],
    ]);
    const result = detectRenames(
      ['old/foo.ts'],
      ['new/completely-different-name.ts', 'new/also-different.ts'],
      hashes,
      0.7,
    );
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('uses default threshold of 0.5 when not specified', () => {
    const hashes = new Map([
      ['old/x.ts', 'hashA'],
      ['new/y.ts', 'hashA'],
      ['new/z.ts', 'hashA'],
    ]);
    const withDefault = detectRenames(['old/x.ts'], ['new/y.ts', 'new/z.ts'], hashes);
    const withExplicit = detectRenames(['old/x.ts'], ['new/y.ts', 'new/z.ts'], hashes, 0.5);
    expect(withDefault[0].confidence).toBe(withExplicit[0].confidence);
  });

  it('threshold of 0 allows low-confidence matches', () => {
    const hashes = new Map([
      ['old/a.ts', 'hashA'],
      ['new/zzzzzzzzzzzzzzzzzzzzz.ts', 'hashA'],
      ['new/yyyyyyyyyyyyyyyyyyyyyy.ts', 'hashA'],
    ]);
    const result = detectRenames(
      ['old/a.ts'],
      ['new/zzzzzzzzzzzzzzzzzzzzz.ts', 'new/yyyyyyyyyyyyyyyyyyyyyy.ts'],
      hashes,
      0,
    );
    expect(result).toHaveLength(1);
    // With threshold 0, confidence can be below 0.5
    expect(result[0].confidence).toBeGreaterThanOrEqual(0);
  });
});
