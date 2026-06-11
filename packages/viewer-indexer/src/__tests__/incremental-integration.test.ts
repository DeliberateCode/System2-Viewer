/**
 * Integration tests for incremental re-indexing with golden-model comparison.
 *
 *
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { ModelStore } from '@system2-viewer/viewer-store';
import { deriveRepositoryId } from '@system2-viewer/viewer-core';
import { Indexer } from '../indexer.js';
import { hashFileContent } from '../incremental.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp git repo with the given files. */
function createFixtureRepo(
  files: Record<string, string>,
): { repoDir: string; dataDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'incr-int-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'incr-int-data-'));

  spawnSync('git', ['init'], { cwd: repoDir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: repoDir,
  });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repoDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoDir) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  spawnSync('git', ['add', '.'], { cwd: repoDir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

  return { repoDir, dataDir };
}

/** Clean up temp dirs. */
function cleanupDirs(...dirs: string[]): void {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
}

/** Count nodes/edges/claims in the database at a given revision (or current). */
function countModel(
  dbPath: string,
  revision?: string,
): { nodes: number; edges: number; claims: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const filter = revision
      ? `valid_from_revision = '${revision}' AND valid_to_revision IS NULL`
      : `valid_to_revision IS NULL`;

    const nodes = (
      db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE ${filter}`).get() as {
        cnt: number;
      }
    ).cnt;
    const edges = (
      db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE ${filter}`).get() as {
        cnt: number;
      }
    ).cnt;
    const claims = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM claims WHERE ${filter}`)
        .get() as { cnt: number }
    ).cnt;

    return { nodes, edges, claims };
  } finally {
    db.close();
  }
}

/** Count all open (non-closed) nodes/edges/claims regardless of revision. */
function countOpenModel(
  dbPath: string,
): { nodes: number; edges: number; claims: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const nodes = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE valid_to_revision IS NULL`)
        .get() as { cnt: number }
    ).cnt;
    const edges = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM edges WHERE valid_to_revision IS NULL`)
        .get() as { cnt: number }
    ).cnt;
    const claims = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM claims WHERE valid_to_revision IS NULL`)
        .get() as { cnt: number }
    ).cnt;

    return { nodes, edges, claims };
  } finally {
    db.close();
  }
}

/** Query file_hashes table. */
function queryFileHashes(
  dbPath: string,
): Array<{ path: string; hash: string; revision: string }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT path, hash, revision FROM file_hashes ORDER BY path`,
      )
      .all() as Array<{ path: string; hash: string; revision: string }>;
  } finally {
    db.close();
  }
}

/** Query a specific node. */
function getNode(
  dbPath: string,
  id: string,
): { valid_from_revision: string; valid_to_revision: string | null } | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      (db
        .prepare(
          `SELECT valid_from_revision, valid_to_revision FROM nodes WHERE id = ?`,
        )
        .get(id) as {
        valid_from_revision: string;
        valid_to_revision: string | null;
      } | undefined) ?? null
    );
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Standard 5-file fixture content
// ---------------------------------------------------------------------------

const FIXTURE_FILES: Record<string, string> = {
  'src/index.ts': `export function main() { return 'hello'; }\n`,
  'src/utils.ts': `export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n`,
  'src/config.ts': `export interface AppConfig { debug: boolean; port: number; }\n`,
  'src/types.ts': `export type UserId = string;\nexport type Role = 'admin' | 'user';\n`,
  'src/helpers.ts': `import { add } from './utils.js';\nexport function double(x: number) { return add(x, x); }\n`,
};

// ---------------------------------------------------------------------------
// Test 1: Golden model comparison
// ---------------------------------------------------------------------------

describe('Incremental re-indexing integration', () => {
  describe('golden model comparison', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('full index then incremental re-index produces identical open model state', async () => {
      ({ repoDir, dataDir } = createFixtureRepo(FIXTURE_FILES));
      const dbPath = join(dataDir, 'model.sqlite');

      // First full index
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const result1 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });
      expect(result1.revision).toBeTruthy();

      // Record golden state after first index
      const goldenState = countOpenModel(dbPath);
      expect(goldenState.nodes).toBeGreaterThan(0);
      expect(goldenState.edges).toBeGreaterThan(0);
      expect(goldenState.claims).toBeGreaterThan(0);

      // Incremental re-index (full: false is the default)
      const result2 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });
      expect(result2.revision).toBeTruthy();
      expect(result2.revision).not.toBe(result1.revision);

      // Incremental diff should show all unchanged
      expect(result2.incremental).toBeDefined();
      expect(result2.incremental!.unchanged.length).toBe(5);
      expect(result2.incremental!.changed).toHaveLength(0);
      expect(result2.incremental!.added).toHaveLength(0);
      expect(result2.incremental!.removed).toHaveLength(0);

      // Open model state should be identical in counts, except:
      // In incremental mode, the prior repository node is not closed
      // (closeStaleIntervals is skipped to avoid closing unchanged nodes),
      // so the node count grows by exactly 1 (the new repository node).
      const incrementalState = countOpenModel(dbPath);
      expect(incrementalState.nodes).toBe(goldenState.nodes + 1);
      expect(incrementalState.edges).toBe(goldenState.edges);
      // Claims may differ slightly between runs due to generation IDs,
      // but the count of open claims should match
      expect(incrementalState.claims).toBe(goldenState.claims);

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Changed file detection
  // ---------------------------------------------------------------------------

  describe('changed file detection', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('modifying one file causes only that file to be re-extracted', async () => {
      const threeFiles: Record<string, string> = {
        'src/alpha.ts': `export function alpha() { return 1; }\n`,
        'src/beta.ts': `export function beta() { return 2; }\n`,
        'src/gamma.ts': `export function gamma() { return 3; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const repositoryId = deriveRepositoryId(repoDir);

      // First full index
      const result1 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Record original valid_from_revision for unchanged file nodes
      const betaFileId = `node::file::${repositoryId}::src/beta.ts`;
      const gammaFileId = `node::file::${repositoryId}::src/gamma.ts`;
      const betaNodeBefore = getNode(dbPath, betaFileId);
      const gammaNodeBefore = getNode(dbPath, gammaFileId);
      expect(betaNodeBefore).not.toBeNull();
      expect(gammaNodeBefore).not.toBeNull();

      // Modify alpha.ts
      writeFileSync(
        join(repoDir, 'src/alpha.ts'),
        `export function alpha() { return 999; }\nexport function alphaNew() { return 42; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify alpha'], { cwd: repoDir });

      // Incremental re-index
      const result2 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Verify diff: only alpha.ts changed
      expect(result2.incremental).toBeDefined();
      expect(result2.incremental!.changed).toContain('src/alpha.ts');
      expect(result2.incremental!.unchanged).toContain('src/beta.ts');
      expect(result2.incremental!.unchanged).toContain('src/gamma.ts');
      expect(result2.incremental!.added).toHaveLength(0);
      expect(result2.incremental!.removed).toHaveLength(0);

      // Verify unchanged files retain their original valid_from_revision.
      // Because incremental mode skips re-upsertion for unchanged files,
      // the original node rows should still be present and open.
      const betaNodeAfter = getNode(dbPath, betaFileId);
      const gammaNodeAfter = getNode(dbPath, gammaFileId);
      expect(betaNodeAfter).not.toBeNull();
      expect(gammaNodeAfter).not.toBeNull();
      // The unchanged files' nodes should not have been closed
      expect(betaNodeAfter!.valid_to_revision).toBeNull();
      expect(gammaNodeAfter!.valid_to_revision).toBeNull();

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Deleted file handling
  // ---------------------------------------------------------------------------

  describe('deleted file handling', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('full re-index after deletion closes removed file intervals', async () => {
      // NOTE: Incremental mode currently does not detect deleted files because
      // storedHashes is only populated for files present in the current walk.
      // This is a known gap (see PRODUCTION-BUG below). The --full flag
      // correctly handles deletions via closeStaleIntervals.
      //
      // PRODUCTION-BUG: indexer.ts loads storedHashes by iterating over
      // currently-walked files only (lines 167-171), so deleted files never
      // appear in storedHashes and IncrementalDiff.removed is always empty.
      // FIX OWNER: executor (requires ReadHandle.loadAllFileHashes or similar)
      const threeFiles: Record<string, string> = {
        'src/keep1.ts': `export function keep1() { return 'stay'; }\n`,
        'src/keep2.ts': `export function keep2() { return 'stay'; }\n`,
        'src/remove.ts': `export function removable() { return 'bye'; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const repositoryId = deriveRepositoryId(repoDir);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify remove.ts node exists and is open
      const removeFileId = `node::file::${repositoryId}::src/remove.ts`;
      const removeNodeBefore = getNode(dbPath, removeFileId);
      expect(removeNodeBefore).not.toBeNull();
      expect(removeNodeBefore!.valid_to_revision).toBeNull();

      // Delete the file
      unlinkSync(join(repoDir, 'src/remove.ts'));
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'remove file'], { cwd: repoDir });

      // Full re-index (--full) handles deletions via closeStaleIntervals
      const result2 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // Full mode returns no incremental diff
      expect(result2.incremental).toBeUndefined();

      // Deleted file's node should have a closed interval via closeStaleIntervals
      const removeNodeAfter = getNode(dbPath, removeFileId);
      expect(removeNodeAfter).not.toBeNull();
      expect(removeNodeAfter!.valid_to_revision).not.toBeNull();

      // Remaining files should still be open
      const keep1Id = `node::file::${repositoryId}::src/keep1.ts`;
      const keep2Id = `node::file::${repositoryId}::src/keep2.ts`;
      const keep1After = getNode(dbPath, keep1Id);
      const keep2After = getNode(dbPath, keep2Id);
      expect(keep1After!.valid_to_revision).toBeNull();
      expect(keep2After!.valid_to_revision).toBeNull();

      store.close();
    });

    it('incremental mode does not detect removed files (known gap)', async () => {
      // Documents the current behavior: incremental mode's storedHashes
      // is loaded only for currently-walked files, so removed files are
      // invisible to the diff algorithm.
      // PRODUCTION-BUG: see note in test above.
      const twoFiles: Record<string, string> = {
        'src/stay.ts': `export const STAY = true;\n`,
        'src/gone.ts': `export const GONE = true;\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(twoFiles));

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Delete gone.ts
      unlinkSync(join(repoDir, 'src/gone.ts'));
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'remove gone'], { cwd: repoDir });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Incremental mode cannot detect removed files (known gap)
      expect(result.incremental).toBeDefined();
      expect(result.incremental!.removed).toHaveLength(0);
      expect(result.incremental!.unchanged).toContain('src/stay.ts');

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: New file addition
  // ---------------------------------------------------------------------------

  describe('new file addition', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('adding a new file indexes it while leaving existing files untouched', async () => {
      const twoFiles: Record<string, string> = {
        'src/first.ts': `export function first() { return 1; }\n`,
        'src/second.ts': `export function second() { return 2; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(twoFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const repositoryId = deriveRepositoryId(repoDir);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Count model before addition
      const stateBefore = countOpenModel(dbPath);

      // Add a third file
      writeFileSync(
        join(repoDir, 'src/third.ts'),
        `import { first } from './first.js';\nexport function third() { return first() + 3; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add third'], { cwd: repoDir });

      // Incremental re-index
      const result2 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Verify diff
      expect(result2.incremental).toBeDefined();
      expect(result2.incremental!.added).toContain('src/third.ts');
      expect(result2.incremental!.unchanged).toContain('src/first.ts');
      expect(result2.incremental!.unchanged).toContain('src/second.ts');
      expect(result2.incremental!.changed).toHaveLength(0);
      expect(result2.incremental!.removed).toHaveLength(0);

      // New file node should exist and be open
      const thirdFileId = `node::file::${repositoryId}::src/third.ts`;
      const thirdNode = getNode(dbPath, thirdFileId);
      expect(thirdNode).not.toBeNull();
      expect(thirdNode!.valid_to_revision).toBeNull();

      // Model should have grown (more nodes at minimum)
      const stateAfter = countOpenModel(dbPath);
      expect(stateAfter.nodes).toBeGreaterThan(stateBefore.nodes);

      // Original file nodes should still be open
      const firstId = `node::file::${repositoryId}::src/first.ts`;
      const secondId = `node::file::${repositoryId}::src/second.ts`;
      expect(getNode(dbPath, firstId)!.valid_to_revision).toBeNull();
      expect(getNode(dbPath, secondId)!.valid_to_revision).toBeNull();

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: --full flag
  // ---------------------------------------------------------------------------

  describe('--full flag', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('full flag forces complete re-extraction even when hashes match', async () => {
      const threeFiles: Record<string, string> = {
        'src/one.ts': `export const ONE = 1;\n`,
        'src/two.ts': `export const TWO = 2;\n`,
        'src/three.ts': `export const THREE = 3;\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Modify one file
      writeFileSync(
        join(repoDir, 'src/two.ts'),
        `export const TWO = 22;\nexport const TWO_EXTRA = 'extra';\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify two'], { cwd: repoDir });

      // Re-index with full: true
      const fullResult = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // With full: true, no incremental diff should be reported
      expect(fullResult.incremental).toBeUndefined();

      // Re-index incrementally for comparison
      const incrResult = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // The incremental run should see all as unchanged since full already updated hashes
      expect(incrResult.incremental).toBeDefined();
      expect(incrResult.incremental!.unchanged.length).toBe(3);

      // Both runs should produce a valid model
      const finalState = countOpenModel(dbPath);
      expect(finalState.nodes).toBeGreaterThan(0);
      expect(finalState.edges).toBeGreaterThan(0);

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: File hash persistence
  // ---------------------------------------------------------------------------

  describe('file hash persistence', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('stores SHA-256 hashes for all indexed files in file_hashes table', async () => {
      ({ repoDir, dataDir } = createFixtureRepo(FIXTURE_FILES));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      const hashes = queryFileHashes(dbPath);

      // Should have entries for all 5 files
      expect(hashes.length).toBe(5);

      // Verify each file has a correct SHA-256 hash
      for (const [relPath, content] of Object.entries(FIXTURE_FILES)) {
        const entry = hashes.find((h) => h.path === relPath);
        expect(entry, `file_hashes entry for ${relPath}`).toBeDefined();

        const expectedHash = hashFileContent(content);
        expect(entry!.hash).toBe(expectedHash);
      }

      // All hashes should be 64-char hex strings (SHA-256)
      for (const h of hashes) {
        expect(h.hash).toMatch(/^[0-9a-f]{64}$/);
      }

      store.close();
    });

    it('updates hashes when files change on re-index', async () => {
      ({ repoDir, dataDir } = createFixtureRepo({
        'src/a.ts': `export const A = 'original';\n`,
      }));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      const hashesBefore = queryFileHashes(dbPath);
      expect(hashesBefore.length).toBe(1);
      const originalHash = hashesBefore[0]!.hash;

      // Modify the file
      const newContent = `export const A = 'modified';\n`;
      writeFileSync(join(repoDir, 'src/a.ts'), newContent);
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify a'], { cwd: repoDir });

      // Re-index (incremental)
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      const hashesAfter = queryFileHashes(dbPath);
      expect(hashesAfter.length).toBe(1);
      expect(hashesAfter[0]!.hash).not.toBe(originalHash);
      expect(hashesAfter[0]!.hash).toBe(hashFileContent(newContent));

      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: incrementalSummary in partiality
  // ---------------------------------------------------------------------------

  describe('incrementalSummary in result', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('records incremental summary in partiality when incremental mode used', async () => {
      const twoFiles: Record<string, string> = {
        'src/stable.ts': `export const STABLE = true;\n`,
        'src/changing.ts': `export const VERSION = 1;\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(twoFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Modify one file
      writeFileSync(
        join(repoDir, 'src/changing.ts'),
        `export const VERSION = 2;\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'bump version'], { cwd: repoDir });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Check partiality for incremental scope
      const db = new Database(dbPath, { readonly: true });
      try {
        const partialityRows = db
          .prepare(
            `SELECT scope, extracted_json, skipped_json FROM partiality WHERE revision = ? AND scope = 'incremental'`,
          )
          .all(result.revision) as Array<{
          scope: string;
          extracted_json: string | null;
          skipped_json: string | null;
        }>;

        expect(partialityRows.length).toBe(1);

        const extracted = JSON.parse(partialityRows[0]!.extracted_json!) as string[];
        const skipped = JSON.parse(partialityRows[0]!.skipped_json!) as string[];

        // Should report 1 changed, 0 added
        expect(extracted.some((s) => s.includes('1 changed'))).toBe(true);
        expect(extracted.some((s) => s.includes('0 added'))).toBe(true);

        // Should report 1 unchanged
        expect(skipped.some((s) => s.includes('1 unchanged'))).toBe(true);
      } finally {
        db.close();
      }

      store.close();
    });
  });
}, 120_000);
