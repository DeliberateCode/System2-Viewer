/**
 * Integration tests for incremental FTS updates.
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

function createFixtureRepo(
  files: Record<string, string>,
): { repoDir: string; dataDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'incr-fts-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'incr-fts-data-'));

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

describe('Incremental FTS updates', () => {
  describe('index 3 files, modify 1, reindex incrementally', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('FTS is correct for all 3 files after incremental reindex', async () => {
      const threeFiles: Record<string, string> = {
        'src/alpha.ts': `export function alpha() { return 1; }\n`,
        'src/beta.ts': `export function beta() { return 2; }\n`,
        'src/gamma.ts': `export function gamma() { return 3; }\n`,
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

      // Verify all 3 files have FTS entries (file + symbol entries)
      const ftsAfterFull = queryFtsRows(dbPath);
      const filePathsInFts = new Set(ftsAfterFull.map(r => r.path).filter(Boolean));
      expect(filePathsInFts.has('src/alpha.ts')).toBe(true);
      expect(filePathsInFts.has('src/beta.ts')).toBe(true);
      expect(filePathsInFts.has('src/gamma.ts')).toBe(true);

      // Record FTS row count for unchanged files
      const betaFtsBefore = queryFtsForPath(dbPath, 'src/beta.ts');
      const gammaFtsBefore = queryFtsForPath(dbPath, 'src/gamma.ts');
      expect(betaFtsBefore.length).toBeGreaterThan(0);
      expect(gammaFtsBefore.length).toBeGreaterThan(0);

      // Modify alpha.ts (add a new symbol)
      writeFileSync(
        join(repoDir, 'src/alpha.ts'),
        `export function alpha() { return 999; }\nexport function alphaNew() { return 42; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'modify alpha'], { cwd: repoDir });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      expect(result.incremental).toBeDefined();
      expect(result.incremental!.changed).toContain('src/alpha.ts');
      expect(result.incremental!.unchanged).toContain('src/beta.ts');
      expect(result.incremental!.unchanged).toContain('src/gamma.ts');

      // Verify FTS for all 3 files still present
      const ftsAfterIncr = queryFtsRows(dbPath);
      const pathsAfterIncr = new Set(ftsAfterIncr.map(r => r.path).filter(Boolean));
      expect(pathsAfterIncr.has('src/alpha.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/beta.ts')).toBe(true);
      expect(pathsAfterIncr.has('src/gamma.ts')).toBe(true);

      // Unchanged files should still have FTS entries
      const betaFtsAfter = queryFtsForPath(dbPath, 'src/beta.ts');
      const gammaFtsAfter = queryFtsForPath(dbPath, 'src/gamma.ts');
      expect(betaFtsAfter.length).toBeGreaterThan(0);
      expect(gammaFtsAfter.length).toBeGreaterThan(0);

      // Alpha should have updated FTS (now 2 symbols instead of 1)
      const alphaFtsAfter = queryFtsForPath(dbPath, 'src/alpha.ts');
      expect(alphaFtsAfter.length).toBeGreaterThan(0);

      store.close();
    });
  });

  describe('full mode uses clearFtsForRepository', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('full reindex rebuilds all FTS entries', async () => {
      const twoFiles: Record<string, string> = {
        'src/one.ts': `export function one() { return 1; }\n`,
        'src/two.ts': `export function two() { return 2; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(twoFiles));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      const ftsCount1 = queryFtsRows(dbPath).length;
      expect(ftsCount1).toBeGreaterThan(0);

      // Second full index (full: true)
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: true,
        skipEmbed: true,
      });

      // FTS should be rebuilt with same content
      const ftsCount2 = queryFtsRows(dbPath).length;
      expect(ftsCount2).toBeGreaterThan(0);

      // Both files should still have FTS entries
      const paths = new Set(queryFtsRows(dbPath).map(r => r.path).filter(Boolean));
      expect(paths.has('src/one.ts')).toBe(true);
      expect(paths.has('src/two.ts')).toBe(true);

      store.close();
    });
  });

  describe('changed files get updated FTS content', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('modified file FTS reflects new symbols', async () => {
      const files: Record<string, string> = {
        'src/mod.ts': `export function original() { return 1; }\n`,
        'src/stable.ts': `export function stable() { return 'ok'; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(files));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify original symbol in FTS
      const ftsBefore = queryFtsForPath(dbPath, 'src/mod.ts');
      const hasOriginal = ftsBefore.some(r => r.text.includes('original'));
      expect(hasOriginal).toBe(true);

      // Modify the file to rename symbol
      writeFileSync(
        join(repoDir, 'src/mod.ts'),
        `export function renamed() { return 2; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'rename symbol'], { cwd: repoDir });

      // Incremental re-index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      // FTS should have the new symbol
      const ftsAfter = queryFtsForPath(dbPath, 'src/mod.ts');
      const hasRenamed = ftsAfter.some(r => r.text.includes('renamed'));
      expect(hasRenamed).toBe(true);

      // Stable file should still have FTS
      const stableFts = queryFtsForPath(dbPath, 'src/stable.ts');
      expect(stableFts.length).toBeGreaterThan(0);

      store.close();
    });
  });
  describe('stale symbol FTS entries are removed on incremental reindex', () => {
    let repoDir: string;
    let dataDir: string;

    afterAll(() => {
      if (repoDir) cleanupDirs(repoDir, dataDir);
    });

    it('index 3 symbols, reduce to 1, reindex -> FTS only has 1 symbol entry', async () => {
      const files: Record<string, string> = {
        'src/multi.ts': [
          'export function alpha() { return 1; }',
          'export function beta() { return 2; }',
          'export function gamma() { return 3; }',
        ].join('\n') + '\n',
        'src/stable.ts': `export function stable() { return 'ok'; }\n`,
      };
      ({ repoDir, dataDir } = createFixtureRepo(files));
      const dbPath = join(dataDir, 'model.sqlite');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      // First full index
      await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        skipEmbed: true,
      });

      // Verify all 3 symbols have FTS entries
      const ftsBefore = queryFtsForPath(dbPath, 'src/multi.ts');
      const symbolsBefore = ftsBefore.filter(r => r.text !== 'multi.ts src/multi.ts');
      expect(symbolsBefore.length).toBe(3);
      expect(symbolsBefore.some(r => r.text.includes('alpha'))).toBe(true);
      expect(symbolsBefore.some(r => r.text.includes('beta'))).toBe(true);
      expect(symbolsBefore.some(r => r.text.includes('gamma'))).toBe(true);

      // Modify multi.ts to have only 1 symbol
      writeFileSync(
        join(repoDir, 'src/multi.ts'),
        `export function onlyOne() { return 42; }\n`,
      );
      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'reduce to 1 symbol'], { cwd: repoDir });

      // Incremental re-index
      const result = await indexer.index({
        repoRoot: repoDir,
        depth: 0,
        full: false,
        skipEmbed: true,
      });

      expect(result.incremental).toBeDefined();
      expect(result.incremental!.changed).toContain('src/multi.ts');

      // After reindex, FTS should only have the 1 remaining symbol + file entry
      const ftsAfter = queryFtsForPath(dbPath, 'src/multi.ts');
      const symbolsAfter = ftsAfter.filter(r => r.text !== 'multi.ts src/multi.ts');
      expect(symbolsAfter.length).toBe(1);
      expect(symbolsAfter[0]!.text).toContain('onlyOne');

      // Stale symbols should NOT be in FTS
      const allFts = queryFtsRows(dbPath);
      const allTexts = allFts.map(r => r.text);
      expect(allTexts.some(t => t.includes('alpha'))).toBe(false);
      expect(allTexts.some(t => t.includes('beta'))).toBe(false);
      expect(allTexts.some(t => t.includes('gamma'))).toBe(false);

      // Stable file should still have FTS
      const stableFts = queryFtsForPath(dbPath, 'src/stable.ts');
      expect(stableFts.length).toBeGreaterThan(0);

      store.close();
    });
  });
}, 120_000);
