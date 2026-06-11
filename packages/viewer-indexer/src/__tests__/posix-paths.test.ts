/**
 * Tests that stored paths always use POSIX separators (/) regardless of
 * the host platform. This is critical for cross-platform consistency:
 * paths persisted in the SQLite model must be identical on Windows,
 * macOS, and Linux.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkFiles } from '../walk.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-posix-path-'));
  tempDirs.push(dir);
  return dir;
}

const noExcludes = { isExcluded: () => false };

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe('stored paths use POSIX separators', () => {
  it('walkFiles returns forward-slash paths for nested files', () => {
    const repo = makeTempDir();
    mkdirSync(join(repo, 'src'));
    mkdirSync(join(repo, 'src', 'utils'));
    writeFileSync(join(repo, 'src', 'utils', 'helper.ts'), 'export {}');

    const results = walkFiles(repo, noExcludes);
    for (const entry of results) {
      expect(entry.relativePath).not.toContain('\\');
    }
    const paths = results.map(e => e.relativePath);
    expect(paths).toContain('src/utils/helper.ts');
  });

  it('no backslash in any returned relativePath', () => {
    const repo = makeTempDir();
    mkdirSync(join(repo, 'a'));
    mkdirSync(join(repo, 'a', 'b'));
    mkdirSync(join(repo, 'a', 'b', 'c'));
    writeFileSync(join(repo, 'a', 'b', 'c', 'deep.ts'), '1');
    writeFileSync(join(repo, 'a', 'top.ts'), '2');

    const results = walkFiles(repo, noExcludes);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const entry of results) {
      expect(entry.relativePath).not.toContain('\\');
      expect(entry.relativePath).toMatch(/^[^\\]+$/);
    }
  });
});
