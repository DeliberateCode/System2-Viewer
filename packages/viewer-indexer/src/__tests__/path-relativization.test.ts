/**
 * Tests for path relativization in indexed data.
 *
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Indexer } from '../indexer.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import Database from 'better-sqlite3';

describe('Path relativization', () => {
  it('repository node metadataJson stores repoName not repoRoot', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'path-rel-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'path-rel-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'index.ts'), `export const x = 1;\n`);
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // repoRoot should NOT be present in repository node metadata
      const repoRootResult = db
        .prepare(
          `SELECT json_extract(metadata_json, '$.repoRoot') as val FROM nodes WHERE kind = 'repository'`,
        )
        .get() as { val: unknown } | undefined;
      expect(repoRootResult?.val).toBeNull();

      // repoName should be present and equal to the basename
      const repoNameResult = db
        .prepare(
          `SELECT json_extract(metadata_json, '$.repoName') as val FROM nodes WHERE kind = 'repository'`,
        )
        .get() as { val: string } | undefined;
      expect(repoNameResult?.val).toBe(basename(repoDir));

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('all stored node paths are relative (no leading /)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'path-rel-abs-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'path-rel-abs-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      mkdirSync(join(repoDir, 'src'), { recursive: true });
      writeFileSync(join(repoDir, 'src', 'main.ts'), `export function main() {}\n`);
      writeFileSync(join(repoDir, 'index.ts'), `export { main } from './src/main';\n`);

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // All node paths should be relative (not start with /)
      const nodesWithPaths = db
        .prepare(`SELECT id, path FROM nodes WHERE path IS NOT NULL`)
        .all() as Array<{ id: string; path: string }>;

      expect(nodesWithPaths.length).toBeGreaterThan(0);
      for (const node of nodesWithPaths) {
        expect(node.path.startsWith('/')).toBe(false);
      }

      // No metadataJson should contain the absolute repoDir path
      const metadataRows = db
        .prepare(`SELECT id, metadata_json FROM nodes WHERE metadata_json IS NOT NULL`)
        .all() as Array<{ id: string; metadata_json: string }>;

      for (const row of metadataRows) {
        expect(row.metadata_json).not.toContain(repoDir);
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
