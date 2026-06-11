/**
 * Regression tests for:
 *   - Re-indexing unchanged repo preserves overview file count
 *     (contains edges update from_node_id to new repo node)
 *   - `viewer overview .` resolves path to repository node ID
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createViewerEngine } from '../engine.js';
import type { ViewerEngine } from '../types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-reindex-test-'));
  tempDirs.push(dir);
  return dir;
}

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

describe('Re-indexing unchanged repo preserves overview', () => {
  it('overview reports same file count after two index runs', async () => {
    const repoDir = makeTempDir();
    mkdirSync(join(repoDir, 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'index.ts'), 'export const a = 1;\n');
    writeFileSync(join(repoDir, 'src', 'util.ts'), 'export const b = 2;\n');
    writeFileSync(join(repoDir, 'src', 'config.ts'), 'export const c = 3;\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1 }),
    );

    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    try {
      // First index
      const { revision: rev1 } = await engine.indexer.index({ repoRoot: repoDir });

      // Overview after first index
      const overview1 = engine.getRepositoryOverview({ repo: rev1 });
      const data1 = overview1.data as { structure: { totalFiles: number } };
      expect(data1.structure.totalFiles).toBeGreaterThanOrEqual(3);

      const firstFileCount = data1.structure.totalFiles;

      // Second index (same repo, no changes)
      const { revision: rev2 } = await engine.indexer.index({ repoRoot: repoDir });
      expect(rev2).not.toBe(rev1);

      // Overview after second index should report same file count
      const overview2 = engine.getRepositoryOverview({ repo: rev2 });
      const data2 = overview2.data as { structure: { totalFiles: number } };
      expect(data2.structure.totalFiles).toBe(firstFileCount);
    } finally {
      engine.close();
    }
  });

  it('overview with no repo arg still works after re-index', async () => {
    const repoDir = makeTempDir();
    writeFileSync(join(repoDir, 'main.ts'), 'export {};\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1 }),
    );

    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    try {
      await engine.indexer.index({ repoRoot: repoDir });
      await engine.indexer.index({ repoRoot: repoDir });

      // No repo arg -> defaults to latest revision (which is the repo node)
      const overview = engine.getRepositoryOverview({});
      const data = overview.data as { structure: { totalFiles: number } };
      expect(data.structure.totalFiles).toBeGreaterThanOrEqual(1);
    } finally {
      engine.close();
    }
  });
});

describe('overview resolves path argument to repository node', () => {
  it('overview with absolute path resolves to repo node', async () => {
    const repoDir = makeTempDir();
    mkdirSync(join(repoDir, 'lib'), { recursive: true });
    writeFileSync(join(repoDir, 'lib', 'core.ts'), 'export const core = true;\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1 }),
    );

    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    try {
      await engine.indexer.index({ repoRoot: repoDir });

      // Pass the absolute path as repo arg (simulates `viewer overview /path/to/repo`)
      const overview = engine.getRepositoryOverview({ repo: repoDir });
      const data = overview.data as { structure: { totalFiles: number } };
      expect(data.structure.totalFiles).toBeGreaterThanOrEqual(1);
    } finally {
      engine.close();
    }
  });

  it('overview with "." does not crash (resolves or falls back)', async () => {
    const repoDir = makeTempDir();
    writeFileSync(join(repoDir, 'app.ts'), 'export {};\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1 }),
    );

    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    try {
      await engine.indexer.index({ repoRoot: repoDir });

      // "." looks like a path and should trigger resolution logic
      // Even if "." doesn't resolve to the exact repo (since cwd may differ),
      // it should not crash.
      const overview = engine.getRepositoryOverview({ repo: '.' });
      expect(overview).toBeDefined();
      expect(overview.data).toBeDefined();
    } finally {
      engine.close();
    }
  });

  it('overview with revision-like ID still works (no false positive path detection)', async () => {
    const repoDir = makeTempDir();
    writeFileSync(join(repoDir, 'index.ts'), 'export {};\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1 }),
    );

    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    try {
      const { revision } = await engine.indexer.index({ repoRoot: repoDir });

      // Pass the actual revision as repo arg (should NOT be treated as path)
      const overview = engine.getRepositoryOverview({ repo: revision });
      const data = overview.data as { structure: { totalFiles: number } };
      expect(data.structure.totalFiles).toBeGreaterThanOrEqual(1);
    } finally {
      engine.close();
    }
  });
});
