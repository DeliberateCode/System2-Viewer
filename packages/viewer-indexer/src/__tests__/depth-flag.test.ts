/**
 * Tests for --depth flag wiring: input.depth overrides config.gitHistoryDepth.
 *
 * Verifies Finding 3: the depth parameter in index() input controls
 * git history mining depth.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Indexer } from '../indexer.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import Database from 'better-sqlite3';

describe('Indexer depth flag', () => {
  it('index input accepts depth parameter', async () => {
    const indexer = new Indexer({} as any);
    // Verify the type accepts depth by calling with an invalid path
    await expect(
      indexer.index({ repoRoot: '..', depth: 10 }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('depth=0 produces no git evidence', async () => {
    // Create a temp git repo with a few commits
    const repoDir = mkdtempSync(join(tmpdir(), 'depth-test-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'depth-test-data-'));

    try {
      // Initialize a git repo and make commits
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file1.ts'), 'export const a = 1;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 1'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file2.ts'), 'export const b = 2;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 2'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file3.ts'), 'export const c = 3;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 3'], { cwd: repoDir });

      // Index with depth=0 (no git history)
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      // Verify: no git_commit evidence rows
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      const gitEvidence = db.prepare(
        "SELECT COUNT(*) as cnt FROM evidence WHERE kind = 'git_commit' AND revision = ?",
      ).get(revision) as { cnt: number };
      expect(gitEvidence.cnt).toBe(0);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('depth=1 limits git evidence to 1 commit', async () => {
    // Create a temp git repo with multiple commits
    const repoDir = mkdtempSync(join(tmpdir(), 'depth-test-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'depth-test-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file1.ts'), 'export const a = 1;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 1'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file2.ts'), 'export const b = 2;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 2'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file3.ts'), 'export const c = 3;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 3'], { cwd: repoDir });

      // Index with depth=1
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 1 });

      // Verify: exactly 1 git_commit evidence row
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      const gitEvidence = db.prepare(
        "SELECT COUNT(*) as cnt FROM evidence WHERE kind = 'git_commit' AND revision = ?",
      ).get(revision) as { cnt: number };
      expect(gitEvidence.cnt).toBe(1);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('input.depth overrides config.gitHistoryDepth', async () => {
    // Create a temp git repo with 3 commits
    const repoDir = mkdtempSync(join(tmpdir(), 'depth-test-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'depth-test-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file1.ts'), 'export const a = 1;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 1'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file2.ts'), 'export const b = 2;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 2'], { cwd: repoDir });

      writeFileSync(join(repoDir, 'file3.ts'), 'export const c = 3;');
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'commit 3'], { cwd: repoDir });

      // Config says depth 500, but input says depth 2
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store, {
        gitHistoryDepth: 500,
        symbolBackend: 'treesitter',
        excludes: [],
      });
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 2 });

      // Verify: exactly 2 git_commit evidence rows (input.depth=2 overrides config 500)
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      const gitEvidence = db.prepare(
        "SELECT COUNT(*) as cnt FROM evidence WHERE kind = 'git_commit' AND revision = ?",
      ).get(revision) as { cnt: number };
      expect(gitEvidence.cnt).toBe(2);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
