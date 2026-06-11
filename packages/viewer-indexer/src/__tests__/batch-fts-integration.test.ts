/**
 * Integration tests for batch write + incremental FTS.
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
  const repoDir = mkdtempSync(join(tmpdir(), 'batch-fts-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'batch-fts-data-'));

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

function queryFtsRows(
  dbPath: string,
): Array<{ object_id: string; text: string; path: string | null }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare('SELECT object_id, text, path FROM fts_text ORDER BY path, object_id')
      .all() as Array<{ object_id: string; text: string; path: string | null }>;
  } finally {
    db.close();
  }
}

function queryFtsForPath(
  dbPath: string,
  filePath: string,
): Array<{ object_id: string; text: string }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare('SELECT object_id, text FROM fts_text WHERE path = ? ORDER BY object_id')
      .all(filePath) as Array<{ object_id: string; text: string }>;
  } finally {
    db.close();
  }
}

function queryFtsSearch(
  dbPath: string,
  query: string,
): Array<{ object_id: string; text: string; path: string | null }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const quoted = `"${query.replace(/"/g, '""')}"`;
    return db
      .prepare('SELECT object_id, text, path FROM fts_text WHERE fts_text MATCH ? ORDER BY rank')
      .all(quoted) as Array<{ object_id: string; text: string; path: string | null }>;
  } finally {
    db.close();
  }
}

function countOpenNodes(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db
        .prepare('SELECT COUNT(*) as cnt FROM nodes WHERE valid_to_revision IS NULL')
        .get() as { cnt: number }
    ).cnt;
  } finally {
    db.close();
  }
}

/**
 * Generate a batch of TypeScript source files for testing.
 * Each file exports a unique function named after its index.
 */
function generateFileSet(
  count: number,
  prefix: string = 'src/mod',
): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const name = `${prefix}${i.toString().padStart(3, '0')}`;
    files[`${name}.ts`] = `export function fn_${i}() { return ${i}; }\n`;
  }
  return files;
}

// ---------------------------------------------------------------------------
// Test 1: Index 100 files -- memory usage doesn't spike
// ---------------------------------------------------------------------------
describe('Batch write + FTS integration', () => {
  describe('index 100 files with batch writes', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('indexes 100 files without excessive memory growth', async () => {
      const files = generateFileSet(100);
      ({ repoDir, dataDir } = createFixtureRepo(files));
      const dbPath = join(dataDir, 'model.sqlite');

      // Capture baseline heap before indexing
      global.gc?.(); // optional: only if --expose-gc
      const heapBefore = process.memoryUsage().heapUsed;

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      expect(result.revision).toBeTruthy();

      // Verify all 100 files produced nodes
      const nodeCount = countOpenNodes(dbPath);
      // At minimum: 1 repository node + 100 file nodes + symbol nodes
      expect(nodeCount).toBeGreaterThanOrEqual(101);

      // Verify FTS entries exist for the indexed files
      const ftsRows = queryFtsRows(dbPath);
      const ftsFilePaths = new Set(ftsRows.map((r) => r.path).filter(Boolean));
      // At least 50 of the 100 files should have FTS entries
      // (some may not produce FTS text depending on extraction)
      expect(ftsFilePaths.size).toBeGreaterThanOrEqual(50);

      // Memory check: heap growth should be bounded.
      // With batch writes (1000 item batches), we should not accumulate
      // all edges/evidence in a single array. Allow up to 200MB growth
      // for 100 files (generous bound; actual should be much less).
      const heapAfter = process.memoryUsage().heapUsed;
      const heapGrowthMB = (heapAfter - heapBefore) / (1024 * 1024);
      expect(heapGrowthMB).toBeLessThan(200);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Incremental FTS -- index 5 files, modify 2, reindex
  // -------------------------------------------------------------------------
  describe('incremental FTS: index 5, modify 2, reindex', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('FTS correct for all 5 files and count matches expectation', async () => {
      const fiveFiles: Record<string, string> = {
        'src/alpha.ts': `export function alpha() { return 'alpha'; }\n`,
        'src/beta.ts': `export function beta() { return 'beta'; }\n`,
        'src/gamma.ts': `export function gamma() { return 'gamma'; }\n`,
        'src/delta.ts': `export function delta() { return 'delta'; }\n`,
        'src/epsilon.ts': `export function epsilon() { return 'epsilon'; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(fiveFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Initial full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify all 5 files have FTS entries
      const ftsAfterFull = queryFtsRows(dbPath);
      const pathsAfterFull = new Set(
        ftsAfterFull.map((r) => r.path).filter(Boolean),
      );
      expect(pathsAfterFull.has('src/alpha.ts')).toBe(true);
      expect(pathsAfterFull.has('src/beta.ts')).toBe(true);
      expect(pathsAfterFull.has('src/gamma.ts')).toBe(true);
      expect(pathsAfterFull.has('src/delta.ts')).toBe(true);
      expect(pathsAfterFull.has('src/epsilon.ts')).toBe(true);

      // Record FTS counts for unchanged files
      const gammaFtsBefore = queryFtsForPath(dbPath, 'src/gamma.ts');
      const deltaFtsBefore = queryFtsForPath(dbPath, 'src/delta.ts');
      const epsilonFtsBefore = queryFtsForPath(dbPath, 'src/epsilon.ts');
      expect(gammaFtsBefore.length).toBeGreaterThan(0);
      expect(deltaFtsBefore.length).toBeGreaterThan(0);
      expect(epsilonFtsBefore.length).toBeGreaterThan(0);

      // Modify 2 files: alpha and beta
      writeFileSync(
        join(repoDir, 'src/alpha.ts'),
        `export function alphaUpdated() { return 'alpha-v2'; }\nexport function alphaExtra() { return 42; }\n`,
      );
      writeFileSync(
        join(repoDir, 'src/beta.ts'),
        `export function betaRenamed() { return 'beta-v2'; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify alpha and beta'], {
        cwd: repoDir,
      });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Verify incremental diff
      expect(result.incremental).toBeDefined();
      expect(result.incremental!.changed).toContain('src/alpha.ts');
      expect(result.incremental!.changed).toContain('src/beta.ts');
      expect(result.incremental!.unchanged).toContain('src/gamma.ts');
      expect(result.incremental!.unchanged).toContain('src/delta.ts');
      expect(result.incremental!.unchanged).toContain('src/epsilon.ts');

      // Verify FTS for ALL 5 files still present
      const ftsAfterIncr = queryFtsRows(dbPath);
      const pathsAfterIncr = new Set(
        ftsAfterIncr.map((r) => r.path).filter(Boolean),
      );
      expect(pathsAfterIncr.has('src/alpha.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/beta.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/gamma.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/delta.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/epsilon.ts')).toBe(true);

      // Unchanged files should still have same-count FTS entries
      const gammaFtsAfter = queryFtsForPath(dbPath, 'src/gamma.ts');
      const deltaFtsAfter = queryFtsForPath(dbPath, 'src/delta.ts');
      const epsilonFtsAfter = queryFtsForPath(dbPath, 'src/epsilon.ts');
      expect(gammaFtsAfter.length).toBe(gammaFtsBefore.length);
      expect(deltaFtsAfter.length).toBe(deltaFtsBefore.length);
      expect(epsilonFtsAfter.length).toBe(epsilonFtsBefore.length);

      // Modified files should have updated FTS content
      const alphaFtsAfter = queryFtsForPath(dbPath, 'src/alpha.ts');
      expect(alphaFtsAfter.length).toBeGreaterThan(0);
      // New symbol should appear in FTS text
      const hasAlphaUpdated = alphaFtsAfter.some((r) =>
        r.text.includes('alphaUpdated'),
      );
      expect(hasAlphaUpdated).toBe(true);

      const betaFtsAfter = queryFtsForPath(dbPath, 'src/beta.ts');
      expect(betaFtsAfter.length).toBeGreaterThan(0);
      const hasBetaRenamed = betaFtsAfter.some((r) =>
        r.text.includes('betaRenamed'),
      );
      expect(hasBetaRenamed).toBe(true);

      // Total FTS file count should remain 5
      expect(pathsAfterIncr.size).toBe(pathsAfterFull.size);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Full mode after incremental rebuilds all FTS entries
  // -------------------------------------------------------------------------
  describe('full mode after incremental rebuilds all FTS', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('--full rebuilds all FTS entries after incremental updates', async () => {
      const threeFiles: Record<string, string> = {
        'src/one.ts': `export function one() { return 1; }\n`,
        'src/two.ts': `export function two() { return 2; }\n`,
        'src/three.ts': `export function three() { return 3; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(threeFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Initial full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      const ftsAfterFirst = queryFtsRows(dbPath);
      const firstFtsCount = ftsAfterFirst.length;
      expect(firstFtsCount).toBeGreaterThan(0);

      // Modify one file
      writeFileSync(
        join(repoDir, 'src/two.ts'),
        `export function twoV2() { return 22; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify two'], { cwd: repoDir });

      // Incremental re-index
      const incrResult = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });
      expect(incrResult.incremental).toBeDefined();
      expect(incrResult.incremental!.changed).toContain('src/two.ts');

      // Verify incremental FTS updated the modified file
      const twoFtsAfterIncr = queryFtsForPath(dbPath, 'src/two.ts');
      const hasTwoV2 = twoFtsAfterIncr.some((r) => r.text.includes('twoV2'));
      expect(hasTwoV2).toBe(true);

      // Now do a full re-index
      const fullResult = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // Full mode should not return incremental diff
      expect(fullResult.incremental).toBeUndefined();

      // Verify FTS is fully rebuilt
      const ftsAfterFull = queryFtsRows(dbPath);
      expect(ftsAfterFull.length).toBeGreaterThan(0);

      // All 3 files should still have FTS entries
      const pathsAfterFull = new Set(
        ftsAfterFull.map((r) => r.path).filter(Boolean),
      );
      expect(pathsAfterFull.has('src/one.ts')).toBe(true);
      expect(pathsAfterFull.has('src/two.ts')).toBe(true);
      expect(pathsAfterFull.has('src/three.ts')).toBe(true);

      // The modified file's FTS should still reflect the v2 content
      const twoFtsAfterFull = queryFtsForPath(dbPath, 'src/two.ts');
      const hasTwoV2AfterFull = twoFtsAfterFull.some((r) =>
        r.text.includes('twoV2'),
      );
      expect(hasTwoV2AfterFull).toBe(true);

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: FTS search after incremental update returns correct results
  // -------------------------------------------------------------------------
  describe('FTS search after incremental update', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('search finds new symbols after incremental update', async () => {
      const files: Record<string, string> = {
        'src/calculator.ts': `export function add(a: number, b: number) { return a + b; }\n`,
        'src/formatter.ts': `export function formatCurrency(amount: number) { return '$' + amount; }\n`,
        'src/validator.ts': `export function isValid(input: string) { return input.length > 0; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(files));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Initial full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify initial FTS: search for "add" should find calculator
      const searchBefore = queryFtsSearch(dbPath, 'add');
      const calcHitsBefore = searchBefore.filter(
        (r) => r.path === 'src/calculator.ts',
      );
      expect(calcHitsBefore.length).toBeGreaterThan(0);

      // Search for "multiply" should find nothing
      const mulBefore = queryFtsSearch(dbPath, 'multiply');
      const mulCalcBefore = mulBefore.filter(
        (r) => r.path === 'src/calculator.ts',
      );
      expect(mulCalcBefore).toHaveLength(0);

      // Modify calculator to add multiply function
      writeFileSync(
        join(repoDir, 'src/calculator.ts'),
        `export function add(a: number, b: number) { return a + b; }\nexport function multiply(a: number, b: number) { return a * b; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add multiply'], { cwd: repoDir });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });
      expect(result.incremental).toBeDefined();
      expect(result.incremental!.changed).toContain('src/calculator.ts');
      expect(result.incremental!.unchanged).toContain('src/formatter.ts');
      expect(result.incremental!.unchanged).toContain('src/validator.ts');

      // Search for "multiply" should now find calculator
      const mulAfter = queryFtsSearch(dbPath, 'multiply');
      const mulCalcAfter = mulAfter.filter(
        (r) => r.path === 'src/calculator.ts',
      );
      expect(mulCalcAfter.length).toBeGreaterThan(0);

      // Search for "add" should still find calculator
      const addAfter = queryFtsSearch(dbPath, 'add');
      const addCalcAfter = addAfter.filter(
        (r) => r.path === 'src/calculator.ts',
      );
      expect(addCalcAfter.length).toBeGreaterThan(0);

      // Unchanged file searches should still work
      const formatSearch = queryFtsSearch(dbPath, 'formatCurrency');
      const formatHits = formatSearch.filter(
        (r) => r.path === 'src/formatter.ts',
      );
      expect(formatHits.length).toBeGreaterThan(0);

      const validSearch = queryFtsSearch(dbPath, 'isValid');
      const validHits = validSearch.filter(
        (r) => r.path === 'src/validator.ts',
      );
      expect(validHits.length).toBeGreaterThan(0);

      store.close();
    });

    it('search does not return stale symbols after file modification', async () => {
      const files: Record<string, string> = {
        'src/service.ts': `export function oldOperation() { return 'old'; }\n`,
        'src/util.ts': `export function helper() { return 'help'; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(files));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // Initial full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify oldOperation is in FTS
      const oldBefore = queryFtsSearch(dbPath, 'oldOperation');
      const serviceOldBefore = oldBefore.filter(
        (r) => r.path === 'src/service.ts',
      );
      expect(serviceOldBefore.length).toBeGreaterThan(0);

      // Replace oldOperation with newOperation
      writeFileSync(
        join(repoDir, 'src/service.ts'),
        `export function newOperation() { return 'new'; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'replace operation'], {
        cwd: repoDir,
      });

      // Incremental re-index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // Search for "newOperation" should find service.ts
      const newAfter = queryFtsSearch(dbPath, 'newOperation');
      const serviceNewAfter = newAfter.filter(
        (r) => r.path === 'src/service.ts',
      );
      expect(serviceNewAfter.length).toBeGreaterThan(0);

      // Search for "oldOperation" should NOT find service.ts anymore
      // (the old FTS rows were deleted and replaced)
      const oldAfter = queryFtsSearch(dbPath, 'oldOperation');
      const serviceOldAfter = oldAfter.filter(
        (r) => r.path === 'src/service.ts',
      );
      expect(serviceOldAfter).toHaveLength(0);

      // Unchanged file should still be searchable
      const helperSearch = queryFtsSearch(dbPath, 'helper');
      const utilHits = helperSearch.filter((r) => r.path === 'src/util.ts');
      expect(utilHits.length).toBeGreaterThan(0);

      store.close();
    });
  });
}, 120_000);
