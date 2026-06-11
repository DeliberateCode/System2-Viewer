/**
 * Tests that Indexer.index() rejects repoRoot values containing ".."
 * path segments to prevent arbitrary filesystem traversal (F-4).
 *
 */
import { describe, it, expect } from 'vitest';
import { Indexer, hasTraversalSegment } from '../indexer.js';
import type { ModelStore } from '@system2-viewer/viewer-store';

// Minimal stub -- the validation fires before any store interaction.
const stubStore = {} as unknown as ModelStore;

describe('Indexer path traversal rejection', () => {
  const indexer = new Indexer(stubStore);

  it('rejects repoRoot containing ".." segment', async () => {
    await expect(
      indexer.index({ repoRoot: '../../etc' }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('rejects repoRoot with embedded ".." segment', async () => {
    await expect(
      indexer.index({ repoRoot: '/foo/../bar' }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('rejects repoRoot ending with "/.."', async () => {
    await expect(
      indexer.index({ repoRoot: '/home/user/..' }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('rejects repoRoot that is exactly ".."', async () => {
    await expect(
      indexer.index({ repoRoot: '..' }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('does not reject a normal absolute path', async () => {
    // This will fail later (no real store), but the path validation should pass.
    await expect(
      indexer.index({ repoRoot: '/home/user/repo' }),
    ).rejects.not.toThrow('must not contain ".."');
  });

  it('accepts paths with ".." as substring but not as a path segment', async () => {
    // /tmp/my..repo contains ".." as a substring but not as a path segment.
    // The validation should NOT reject it.
    await expect(
      indexer.index({ repoRoot: '/tmp/my..repo' }),
    ).rejects.not.toThrow('must not contain ".."');
  });

  it('accepts paths with double dots in directory names', async () => {
    await expect(
      indexer.index({ repoRoot: '/home/user/project..v2/src' }),
    ).rejects.not.toThrow('must not contain ".."');
  });
});

describe('hasTraversalSegment', () => {
  it('detects ".." as standalone path segment', () => {
    expect(hasTraversalSegment('../../etc')).toBe(true);
    expect(hasTraversalSegment('/foo/../bar')).toBe(true);
    expect(hasTraversalSegment('/home/user/..')).toBe(true);
    expect(hasTraversalSegment('..')).toBe(true);
  });

  it('allows ".." as substring within path segments', () => {
    expect(hasTraversalSegment('/tmp/my..repo')).toBe(false);
    expect(hasTraversalSegment('/home/user/project..v2')).toBe(false);
    expect(hasTraversalSegment('/tmp/..hidden')).toBe(false);
    expect(hasTraversalSegment('/tmp/file..ext')).toBe(false);
  });

  it('handles backslash separators on Windows-style paths', () => {
    expect(hasTraversalSegment('C:\\Users\\..\\Admin')).toBe(true);
    expect(hasTraversalSegment('C:\\Users\\my..project')).toBe(false);
  });
});
