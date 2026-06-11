/**
 * Tests that walkFiles skips symlinks to prevent:
 *   - Escaping the repository boundary via symlink to external dir
 *   - Infinite recursion through symlink cycles
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkFiles } from '../walk.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-walk-symlink-'));
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

describe('walkFiles symlink handling', () => {
  it('skips symlinked files', () => {
    const repo = makeTempDir();
    writeFileSync(join(repo, 'real.ts'), 'export const x = 1;');

    // Create an external file and symlink to it
    const external = makeTempDir();
    writeFileSync(join(external, 'secret.ts'), 'export const secret = true;');
    symlinkSync(join(external, 'secret.ts'), join(repo, 'linked.ts'));

    const results = walkFiles(repo, noExcludes);
    const paths = results.map(e => e.relativePath);

    expect(paths).toContain('real.ts');
    expect(paths).not.toContain('linked.ts');
  });

  it('skips symlinked directories', () => {
    const repo = makeTempDir();
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'index.ts'), 'export {};');

    // Create an external directory and symlink to it
    const external = makeTempDir();
    writeFileSync(join(external, 'external.ts'), 'export const ext = 1;');
    symlinkSync(external, join(repo, 'ext-link'));

    const results = walkFiles(repo, noExcludes);
    const paths = results.map(e => e.relativePath);

    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('ext-link/external.ts');
  });

  it('does not follow symlink cycles', () => {
    const repo = makeTempDir();
    mkdirSync(join(repo, 'a'));
    writeFileSync(join(repo, 'a', 'file.ts'), 'export {};');

    // Create a symlink cycle: a/loop -> repo (parent)
    symlinkSync(repo, join(repo, 'a', 'loop'));

    // This should NOT hang or throw
    const results = walkFiles(repo, noExcludes);
    const paths = results.map(e => e.relativePath);

    expect(paths).toContain('a/file.ts');
    // The symlink 'a/loop' should be skipped
    expect(paths.filter(p => p.includes('loop'))).toHaveLength(0);
  });

  it('still walks regular files and directories', () => {
    const repo = makeTempDir();
    mkdirSync(join(repo, 'src'));
    mkdirSync(join(repo, 'src', 'utils'));
    writeFileSync(join(repo, 'src', 'main.ts'), 'main');
    writeFileSync(join(repo, 'src', 'utils', 'helper.ts'), 'helper');
    writeFileSync(join(repo, 'README.md'), '# readme');

    const results = walkFiles(repo, noExcludes);
    const paths = results.map(e => e.relativePath).sort();

    expect(paths).toEqual(['README.md', 'src/main.ts', 'src/utils/helper.ts']);
  });
});
