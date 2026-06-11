/**
 * Tests for parallel indexing integration.
 *
 *
 *
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { ModelStore } from '@system2-viewer/viewer-store';
import { Indexer } from '../indexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFixtureRepo(
  files: Record<string, string>,
): { repoDir: string; dataDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'par-idx-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'par-idx-data-'));

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

function cleanupDirs(...dirs: string[]): void {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
}

/** Count open (non-closed) nodes/edges/claims. */
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

/** Query all symbol display names sorted. */
function getSymbolNames(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT display_name, path FROM nodes WHERE kind = 'symbol' AND valid_to_revision IS NULL ORDER BY path, display_name`,
      )
      .all() as Array<{ display_name: string; path: string }>;
    return rows.map(r => `${r.path}::${r.display_name}`);
  } finally {
    db.close();
  }
}

/** Query all defines edges as path::symbolName pairs, sorted. */
function getDefinesEdgePairs(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT e.from_node_id, n.display_name, n.path
         FROM edges e JOIN nodes n ON e.to_node_id = n.id
         WHERE e.kind = 'defines' AND e.valid_to_revision IS NULL
         ORDER BY n.path, n.display_name`,
      )
      .all() as Array<{ from_node_id: string; display_name: string; path: string }>;
    return rows.map(r => `${r.path}::${r.display_name}`);
  } finally {
    db.close();
  }
}

/** Query partiality entries for a given revision. */
function getPartiality(
  dbPath: string,
  revision: string,
): Array<{ scope: string; extracted_json: string | null; failed_json: string | null; skipped_json: string | null }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT scope, extracted_json, failed_json, skipped_json FROM partiality WHERE revision = ?`,
      )
      .all(revision) as Array<{
      scope: string;
      extracted_json: string | null;
      failed_json: string | null;
      skipped_json: string | null;
    }>;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Fixture files
// ---------------------------------------------------------------------------

const FIXTURE_FILES: Record<string, string> = {
  'src/index.ts': `export function main() { return 'hello'; }\n`,
  'src/utils.ts': `export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n`,
  'src/config.ts': `export interface AppConfig { debug: boolean; port: number; }\n`,
  'src/types.ts': `export type UserId = string;\nexport type Role = 'admin' | 'user';\n`,
  'src/helpers.ts': `import { add } from './utils.js';\nexport function double(x: number) { return add(x, x); }\n`,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Parallel indexing integration', () => {

  // -------------------------------------------------------------------------
  // Test 1: workerMinFiles=1 forces parallel; model matches sequential
  // -------------------------------------------------------------------------
  describe('parallel vs sequential determinism', () => {
    let seqRepoDir: string;
    let seqDataDir: string;
    let parRepoDir: string;
    let parDataDir: string;

    afterAll(() => {
      if (seqRepoDir) cleanupDirs(seqRepoDir, seqDataDir);
      if (parRepoDir) cleanupDirs(parRepoDir, parDataDir);
    });

    it('parallel extraction (workerMinFiles=1) produces same model as sequential', async () => {
      // Sequential index
      ({ repoDir: seqRepoDir, dataDir: seqDataDir } = createFixtureRepo(FIXTURE_FILES));
      const seqDbPath = join(seqDataDir, 'model.sqlite');
      const seqStore = ModelStore.open(seqDataDir);
      const seqIndexer = new Indexer(seqStore);
      await seqIndexer.index({
        repoRoot: seqRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        // Default: workerMinFiles=500, so 5 files < 500 => sequential
      });

      // Parallel index (same files, workerMinFiles=1 forces parallel)
      ({ repoDir: parRepoDir, dataDir: parDataDir } = createFixtureRepo(FIXTURE_FILES));
      const parDbPath = join(parDataDir, 'model.sqlite');
      const parStore = ModelStore.open(parDataDir);
      const parIndexer = new Indexer(parStore);
      await parIndexer.index({
        repoRoot: parRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      // Compare model counts
      const seqModel = countOpenModel(seqDbPath);
      const parModel = countOpenModel(parDbPath);
      expect(parModel.nodes).toBe(seqModel.nodes);
      expect(parModel.edges).toBe(seqModel.edges);
      expect(parModel.claims).toBe(seqModel.claims);

      // Compare symbol names (repo-ID-independent)
      const seqSymbols = getSymbolNames(seqDbPath);
      const parSymbols = getSymbolNames(parDbPath);
      expect(parSymbols).toEqual(seqSymbols);

      // Compare defines edge pairs
      const seqEdges = getDefinesEdgePairs(seqDbPath);
      const parEdges = getDefinesEdgePairs(parDbPath);
      expect(parEdges).toEqual(seqEdges);

      seqStore.close();
      parStore.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: workerCount=1 behaves like sequential
  // -------------------------------------------------------------------------
  describe('workerCount=1 fallback', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('workerCount=1 uses sequential path even with workerMinFiles=1', async () => {
      ({ repoDir, dataDir } = createFixtureRepo(FIXTURE_FILES));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // workerCount=1 should use sequential regardless of workerMinFiles
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerCount: 1,
        workerMinFiles: 1,
      });

      expect(result.revision).toBeTruthy();

      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(0);
      expect(model.edges).toBeGreaterThan(0);
      expect(model.claims).toBeGreaterThan(0);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Auto-disable threshold
  // -------------------------------------------------------------------------
  describe('auto-disable threshold', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('file count < workerMinFiles uses sequential path', async () => {
      ({ repoDir, dataDir } = createFixtureRepo(FIXTURE_FILES));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // 5 files, workerMinFiles=500 (default) => sequential
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerCount: 4,
        // workerMinFiles defaults to 500, so 5 < 500 => sequential
      });

      expect(result.revision).toBeTruthy();

      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(0);
      expect(model.edges).toBeGreaterThan(0);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Parallel with more workers than files
  // -------------------------------------------------------------------------
  describe('more workers than files', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('handles more workers than files without deadlock', async () => {
      const twoFiles: Record<string, string> = {
        'src/a.ts': `export const A = 1;\n`,
        'src/b.ts': `export const B = 2;\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(twoFiles));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // 2 files, 4 workers, workerMinFiles=1 forces parallel
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerCount: 4,
        workerMinFiles: 1,
      });

      expect(result.revision).toBeTruthy();

      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(0);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Worker error records partiality
  // -------------------------------------------------------------------------
  describe('worker error isolation', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) {
        // Restore permissions before cleanup so rmSync can delete
        const breakPath = join(repoDir, 'src/willbreak.ts');
        try { chmodSync(breakPath, 0o644); } catch { /* may not exist */ }
        cleanupDirs(repoDir, dataDir);
      }
    });

    it('unreadable file records partiality without crashing index', async () => {
      const threeFiles: Record<string, string> = {
        'src/good1.ts': `export function good1() { return 1; }\n`,
        'src/good2.ts': `export function good2() { return 2; }\n`,
        'src/willbreak.ts': `export function willbreak() { return 3; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Make the file unreadable so walkFiles finds it but readFileSync fails
      chmodSync(join(repoDir, 'src/willbreak.ts'), 0o000);

      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      expect(result.revision).toBeTruthy();

      // Check that partiality was recorded for the broken file
      const partialityRows = getPartiality(dbPath, result.revision);
      const contentReadFailure = partialityRows.find(
        p => p.scope === 'src/willbreak.ts' && p.failed_json !== null,
      );
      expect(contentReadFailure).toBeDefined();

      // Other files should have been indexed successfully
      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(0);

      // Verify good files have symbol nodes
      const symbols = getSymbolNames(dbPath);
      const hasGood1 = symbols.some(s => s.includes('good1'));
      const hasGood2 = symbols.some(s => s.includes('good2'));
      expect(hasGood1).toBe(true);
      expect(hasGood2).toBe(true);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Sequential fallback produces valid model
  // -------------------------------------------------------------------------
  describe('sequential fallback', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('no worker config produces valid model (sequential default)', async () => {
      ({ repoDir, dataDir } = createFixtureRepo(FIXTURE_FILES));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // No workerCount or workerMinFiles => defaults => sequential for 5 files
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      expect(result.revision).toBeTruthy();
      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(0);
      expect(model.edges).toBeGreaterThan(0);
      expect(model.claims).toBeGreaterThan(0);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 7: Deterministic output -- same fixture twice with parallel mode
  //   produces identical model state
  // -------------------------------------------------------------------------
  describe('deterministic output: index same fixture twice', () => {
    let repoDir1: string;
    let dataDir1: string;
    let repoDir2: string;
    let dataDir2: string;

    afterAll(() => {
      if (repoDir1) cleanupDirs(repoDir1, dataDir1);
      if (repoDir2) cleanupDirs(repoDir2, dataDir2);
    });

    it('parallel indexing the same fixture twice yields identical model state', async () => {
      // Run 1
      ({ repoDir: repoDir1, dataDir: dataDir1 } = createFixtureRepo(FIXTURE_FILES));
      const dbPath1 = join(dataDir1, 'model.sqlite');
      const store1 = ModelStore.open(dataDir1);
      const indexer1 = new Indexer(store1);
      await indexer1.index({
        repoRoot: repoDir1,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      // Run 2
      ({ repoDir: repoDir2, dataDir: dataDir2 } = createFixtureRepo(FIXTURE_FILES));
      const dbPath2 = join(dataDir2, 'model.sqlite');
      const store2 = ModelStore.open(dataDir2);
      const indexer2 = new Indexer(store2);
      await indexer2.index({
        repoRoot: repoDir2,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      // Model counts must be identical
      const model1 = countOpenModel(dbPath1);
      const model2 = countOpenModel(dbPath2);
      expect(model2.nodes).toBe(model1.nodes);
      expect(model2.edges).toBe(model1.edges);
      expect(model2.claims).toBe(model1.claims);

      // Symbol names (path-relative, repo-ID-independent) must be identical
      const syms1 = getSymbolNames(dbPath1);
      const syms2 = getSymbolNames(dbPath2);
      expect(syms2).toEqual(syms1);

      // Defines edge pairs must be identical
      const edges1 = getDefinesEdgePairs(dbPath1);
      const edges2 = getDefinesEdgePairs(dbPath2);
      expect(edges2).toEqual(edges1);

      store1.close();
      store2.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 8: Auto-disable below threshold -- 3 files with default
  //   workerMinFiles (500) takes sequential path
  // -------------------------------------------------------------------------
  describe('auto-disable below threshold with 3 files', () => {
    let seqRepoDir: string;
    let seqDataDir: string;
    let parRepoDir: string;
    let parDataDir: string;

    afterAll(() => {
      if (seqRepoDir) cleanupDirs(seqRepoDir, seqDataDir);
      if (parRepoDir) cleanupDirs(parRepoDir, parDataDir);
    });

    it('3 files with default workerMinFiles (500) uses sequential path, no WorkerPool created', async () => {
      const threeFiles: Record<string, string> = {
        'src/one.ts': `export function one() { return 1; }\n`,
        'src/two.ts': `export function two() { return 2; }\n`,
        'src/three.ts': `export function three() { return 3; }\n`,
      };

      // Index with default workerMinFiles (500) -- 3 files << 500 => sequential
      ({ repoDir: seqRepoDir, dataDir: seqDataDir } = createFixtureRepo(threeFiles));
      const seqDbPath = join(seqDataDir, 'model.sqlite');
      const seqStore = ModelStore.open(seqDataDir);
      const seqIndexer = new Indexer(seqStore);
      const seqResult = await seqIndexer.index({
        repoRoot: seqRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        // workerMinFiles not set => defaults to 500
        // workerCount defaults to os.availableParallelism() - 1
        // Since 3 < 500, sequential path is used regardless of workerCount
      });
      expect(seqResult.revision).toBeTruthy();

      // Also index the same files with workerMinFiles=1 to force parallel
      ({ repoDir: parRepoDir, dataDir: parDataDir } = createFixtureRepo(threeFiles));
      const parDbPath = join(parDataDir, 'model.sqlite');
      const parStore = ModelStore.open(parDataDir);
      const parIndexer = new Indexer(parStore);
      const parResult = await parIndexer.index({
        repoRoot: parRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });
      expect(parResult.revision).toBeTruthy();

      // Both paths should produce the same model state
      const seqModel = countOpenModel(seqDbPath);
      const parModel = countOpenModel(parDbPath);
      expect(seqModel.nodes).toBe(parModel.nodes);
      expect(seqModel.edges).toBe(parModel.edges);
      expect(seqModel.claims).toBe(parModel.claims);

      // Symbol names should be identical between sequential-by-threshold
      // and parallel paths
      const seqSyms = getSymbolNames(seqDbPath);
      const parSyms = getSymbolNames(parDbPath);
      expect(seqSyms).toEqual(parSyms);

      seqStore.close();
      parStore.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 9: Mixed language parallel -- TS + JSON files in parallel
  //   All symbols extracted correctly
  // -------------------------------------------------------------------------
  describe('mixed language parallel: TS + JSON', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('parallel extraction of TS and JSON files extracts all symbols', async () => {
      const mixedFiles: Record<string, string> = {
        'src/app.ts': `export class App { start() {} }\n`,
        'src/server.ts': `export function listen(port: number) { return port; }\n`,
        'src/utils.ts': `export const VERSION = '1.0';\nexport function greet(name: string) { return name; }\n`,
        'package.json': `{\n  "name": "mixed-test",\n  "version": "1.0.0",\n  "dependencies": {}\n}\n`,
        'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "es2022"\n  }\n}\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(mixedFiles));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Force parallel (workerMinFiles=1)
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });
      expect(result.revision).toBeTruthy();

      const symbols = getSymbolNames(dbPath);

      // TS symbols must be present
      expect(symbols.some(s => s.includes('App'))).toBe(true);
      expect(symbols.some(s => s.includes('listen'))).toBe(true);
      expect(symbols.some(s => s.includes('VERSION'))).toBe(true);
      expect(symbols.some(s => s.includes('greet'))).toBe(true);

      // JSON symbols must be present (top-level keys from package.json)
      expect(symbols.some(s => s.includes('package.json') && s.includes('name'))).toBe(true);
      expect(symbols.some(s => s.includes('package.json') && s.includes('version'))).toBe(true);
      expect(symbols.some(s => s.includes('package.json') && s.includes('dependencies'))).toBe(true);

      // JSON symbols from tsconfig.json
      expect(symbols.some(s => s.includes('tsconfig.json') && s.includes('compilerOptions'))).toBe(true);

      // Verify model counts are non-trivial
      const model = countOpenModel(dbPath);
      expect(model.nodes).toBeGreaterThan(5); // 5 files + multiple symbols
      expect(model.edges).toBeGreaterThan(5); // contains + defines edges
      expect(model.claims).toBeGreaterThan(0);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 10: Incremental + parallel -- index, modify one file, re-index
  //   incrementally with parallel => only changed file re-extracted
  //
  // -------------------------------------------------------------------------
  describe('incremental + parallel', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('parallel incremental re-index processes only the changed file', async () => {
      const threeFiles: Record<string, string> = {
        'src/stable.ts': `export function stable() { return 'unchanged'; }\n`,
        'src/changing.ts': `export function changing() { return 'v1'; }\n`,
        'src/also_stable.ts': `export const FLAG = true;\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index (parallel)
      const result1 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });
      expect(result1.revision).toBeTruthy();

      // Record model state after first index
      const modelAfterFirst = countOpenModel(dbPath);
      const symsAfterFirst = getSymbolNames(dbPath);

      // Modify one file
      writeFileSync(
        join(repoDir, 'src/changing.ts'),
        `export function changing() { return 'v2'; }\nexport function changingExtra() { return 'new'; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify changing'], { cwd: repoDir });

      // Incremental re-index with parallel mode
      const result2 = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });
      expect(result2.revision).toBeTruthy();

      // Verify incremental diff
      expect(result2.incremental).toBeDefined();
      expect(result2.incremental!.changed).toContain('src/changing.ts');
      expect(result2.incremental!.unchanged).toContain('src/stable.ts');
      expect(result2.incremental!.unchanged).toContain('src/also_stable.ts');
      expect(result2.incremental!.added).toHaveLength(0);
      expect(result2.incremental!.removed).toHaveLength(0);

      // The new symbol from the modified file should be present
      const symsAfterIncr = getSymbolNames(dbPath);
      expect(symsAfterIncr.some(s => s.includes('changingExtra'))).toBe(true);

      // The original stable symbols should still be present
      expect(symsAfterIncr.some(s => s.includes('stable'))).toBe(true);
      expect(symsAfterIncr.some(s => s.includes('FLAG'))).toBe(true);

      store.close();
    });
  });
  // -------------------------------------------------------------------------
  // Test 11: TSBackend enrichment -- parallel mode with lsp backend uses
  //   TSBackend to enrich import edges for TS files
  //   (Issue 1: parallel extraction skips TypeScript language service)
  // -------------------------------------------------------------------------
  describe('TSBackend enrichment in parallel mode', () => {
    let seqRepoDir: string;
    let seqDataDir: string;
    let parRepoDir: string;
    let parDataDir: string;

    afterAll(() => {
      if (seqRepoDir) cleanupDirs(seqRepoDir, seqDataDir);
      if (parRepoDir) cleanupDirs(parRepoDir, parDataDir);
    });

    it('parallel mode with lsp backend produces same import edges as sequential', async () => {
      const tsFiles: Record<string, string> = {
        'src/index.ts': `import { helper } from './utils.js';\nexport function main() { return helper(); }\n`,
        'src/utils.ts': `export function helper() { return 42; }\n`,
        'src/types.ts': `export type Config = { debug: boolean };\n`,
      };

      // Sequential index with lsp backend
      ({ repoDir: seqRepoDir, dataDir: seqDataDir } = createFixtureRepo(tsFiles));
      const seqDbPath = join(seqDataDir, 'model.sqlite');
      const seqStore = ModelStore.open(seqDataDir);
      const seqIndexer = new Indexer(seqStore, {
        gitHistoryDepth: 0,
        symbolBackend: 'lsp',
        excludes: [],
      });
      await seqIndexer.index({
        repoRoot: seqRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // Parallel index with lsp backend
      ({ repoDir: parRepoDir, dataDir: parDataDir } = createFixtureRepo(tsFiles));
      const parDbPath = join(parDataDir, 'model.sqlite');
      const parStore = ModelStore.open(parDataDir);
      const parIndexer = new Indexer(parStore, {
        gitHistoryDepth: 0,
        symbolBackend: 'lsp',
        excludes: [],
      });
      await parIndexer.index({
        repoRoot: parRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      // Both should produce the same import edges
      const seqDb = new Database(seqDbPath, { readonly: true });
      const parDb = new Database(parDbPath, { readonly: true });
      try {
        const getImports = (db: InstanceType<typeof Database>) =>
          (db.prepare(
            `SELECT e.epistemic, e.confidence_band, n_from.path as from_path, n_to.path as to_path
             FROM edges e
             JOIN nodes n_from ON e.from_node_id = n_from.id
             JOIN nodes n_to ON e.to_node_id = n_to.id
             WHERE e.kind = 'imports' AND e.valid_to_revision IS NULL
             ORDER BY from_path, to_path`,
          ).all() as Array<{ epistemic: string; confidence_band: string; from_path: string; to_path: string }>);

        const seqImports = getImports(seqDb);
        const parImports = getImports(parDb);

        // Both should have the same number of import edges
        expect(parImports.length).toBe(seqImports.length);

        // For each import, the epistemic and confidence should match
        for (let i = 0; i < seqImports.length; i++) {
          expect(parImports[i]!.from_path).toBe(seqImports[i]!.from_path);
          expect(parImports[i]!.to_path).toBe(seqImports[i]!.to_path);
          expect(parImports[i]!.epistemic).toBe(seqImports[i]!.epistemic);
          expect(parImports[i]!.confidence_band).toBe(seqImports[i]!.confidence_band);
        }

        // Model counts should match
        const seqModel = countOpenModel(seqDbPath);
        const parModel = countOpenModel(parDbPath);
        expect(parModel.nodes).toBe(seqModel.nodes);
        expect(parModel.edges).toBe(seqModel.edges);
      } finally {
        seqDb.close();
        parDb.close();
      }

      seqStore.close();
      parStore.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 12: Shared processFileSymbols helper -- both paths produce identical
  //   symbol nodes, defines edges, and FTS entries (Issue 2 validation)
  // -------------------------------------------------------------------------
  describe('processFileSymbols shared helper (code deduplication)', () => {
    let seqRepoDir: string;
    let seqDataDir: string;
    let parRepoDir: string;
    let parDataDir: string;

    afterAll(() => {
      if (seqRepoDir) cleanupDirs(seqRepoDir, seqDataDir);
      if (parRepoDir) cleanupDirs(parRepoDir, parDataDir);
    });

    it('both paths produce identical symbol nodes and defines edges via shared helper', async () => {
      const files: Record<string, string> = {
        'src/alpha.ts': `export class Alpha { run() {} }\nexport function alphaHelper() {}\n`,
        'src/beta.ts': `export interface Beta { value: number; }\nexport const BETA_CONST = 'beta';\n`,
        'src/gamma.ts': `export enum Gamma { A, B, C }\nexport type GammaAlias = Gamma;\n`,
      };

      // Sequential
      ({ repoDir: seqRepoDir, dataDir: seqDataDir } = createFixtureRepo(files));
      const seqDbPath = join(seqDataDir, 'model.sqlite');
      const seqStore = ModelStore.open(seqDataDir);
      const seqIndexer = new Indexer(seqStore);
      await seqIndexer.index({
        repoRoot: seqRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // Parallel
      ({ repoDir: parRepoDir, dataDir: parDataDir } = createFixtureRepo(files));
      const parDbPath = join(parDataDir, 'model.sqlite');
      const parStore = ModelStore.open(parDataDir);
      const parIndexer = new Indexer(parStore);
      await parIndexer.index({
        repoRoot: parRepoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
        workerMinFiles: 1,
        workerCount: 2,
      });

      // Symbol names must match
      const seqSymbols = getSymbolNames(seqDbPath);
      const parSymbols = getSymbolNames(parDbPath);
      expect(parSymbols).toEqual(seqSymbols);

      // Defines edges must match
      const seqDefines = getDefinesEdgePairs(seqDbPath);
      const parDefines = getDefinesEdgePairs(parDbPath);
      expect(parDefines).toEqual(seqDefines);

      // FTS entry counts must match
      const seqDb = new Database(seqDbPath, { readonly: true });
      const parDb = new Database(parDbPath, { readonly: true });
      try {
        const seqFts = (seqDb.prepare(`SELECT COUNT(*) as cnt FROM fts_text`).get() as { cnt: number }).cnt;
        const parFts = (parDb.prepare(`SELECT COUNT(*) as cnt FROM fts_text`).get() as { cnt: number }).cnt;
        expect(parFts).toBe(seqFts);
      } finally {
        seqDb.close();
        parDb.close();
      }

      seqStore.close();
      parStore.close();
    });
  });
}, 120_000);
