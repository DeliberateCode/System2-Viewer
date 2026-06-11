/**
 * Contract tests for .gitignore exclusion wiring.
 *
 * Validates that `readGitignorePatterns` and `buildExcludeSet` are properly
 * wired in the engine so that .gitignore patterns exclude files from indexing.
 *
 *
 * Test classification:
 *   1. .gitignore patterns exclude files from indexing (missing coverage)
 *   2. missing .gitignore handled gracefully (missing coverage)
 *   3. .gitignore negation patterns work (missing coverage)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import type { ViewerEngine } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix = 'viewer-gitignore-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

/**
 * Creates a minimal TypeScript file that the indexer recognizes as
 * a valid source file. The content is small enough to be parsed.
 */
function writeSourceFile(filePath: string, content?: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    filePath,
    content ?? `export const value = 42;\n`,
  );
}

/**
 * Queries the model.sqlite database for all file-kind nodes.
 * Returns relative paths of file nodes stored in the model.
 */
function getIndexedFilePaths(dataDir: string): string[] {
  const dbPath = join(dataDir, 'model.sqlite');
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT path FROM nodes
         WHERE kind = 'file' AND valid_to_revision IS NULL`,
      )
      .all() as Array<{ path: string }>;
    return rows.map((r) => r.path);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('.gitignore exclusion wiring', () => {
  it('excludes files matching .gitignore patterns from indexing', async () => {
    // Setup: create a temp repo with .gitignore and various files
    const repoDir = makeTempDir();
    const dataDir = makeTempDir();

    // Write .gitignore that excludes dist/, build/, and *.log
    writeFileSync(
      join(repoDir, '.gitignore'),
      'dist/\nbuild/\n*.log\n',
    );

    // Source file that should be indexed
    writeSourceFile(join(repoDir, 'src', 'main.ts'));

    // Build artifacts and logs that should be excluded
    writeSourceFile(join(repoDir, 'dist', 'bundle.js'));
    writeSourceFile(join(repoDir, 'build', 'output.js'));
    writeFileSync(join(repoDir, 'app.log'), 'some log output\n');

    // Create engine with repoRoot pointing to our fixture
    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      // Index the fixture repository
      await engine.indexer.index({ repoRoot: repoDir });

      // Verify which files were indexed
      const indexedPaths = getIndexedFilePaths(dataDir);

      // src/main.ts should be indexed
      expect(
        indexedPaths.some((p) => p.includes('main.ts')),
      ).toBe(true);

      // dist/bundle.js should NOT be indexed
      expect(
        indexedPaths.some((p) => p.includes('bundle.js')),
      ).toBe(false);

      // build/output.js should NOT be indexed
      expect(
        indexedPaths.some((p) => p.includes('output.js')),
      ).toBe(false);

      // app.log should NOT be indexed
      expect(
        indexedPaths.some((p) => p.includes('app.log')),
      ).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('handles missing .gitignore gracefully -- indexing succeeds normally', async () => {
    // Setup: create a repo with NO .gitignore
    const repoDir = makeTempDir();
    const dataDir = makeTempDir();

    // Create a source file
    writeSourceFile(join(repoDir, 'src', 'index.ts'));

    // Create engine -- should not throw even without .gitignore
    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      // Index should succeed without error
      const result = await engine.indexer.index({ repoRoot: repoDir });
      expect(result).toBeDefined();
      expect(result.revision).toBeTruthy();

      // The source file should be indexed
      const indexedPaths = getIndexedFilePaths(dataDir);
      expect(
        indexedPaths.some((p) => p.includes('index.ts')),
      ).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('supports .gitignore negation patterns -- re-included files are indexed', async () => {
    // Setup: create a repo with negation patterns in .gitignore
    const repoDir = makeTempDir();
    const dataDir = makeTempDir();

    // .gitignore excludes all *.log but re-includes important.log
    writeFileSync(
      join(repoDir, '.gitignore'),
      '*.log\n!important.log\n',
    );

    // Create files
    writeSourceFile(join(repoDir, 'src', 'app.ts'));
    writeFileSync(join(repoDir, 'debug.log'), 'debug output\n');
    writeFileSync(
      join(repoDir, 'important.log'),
      'export const importantData = true;\n',
    );

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      await engine.indexer.index({ repoRoot: repoDir });

      const indexedPaths = getIndexedFilePaths(dataDir);

      // src/app.ts should be indexed (not matched by any exclusion)
      expect(
        indexedPaths.some((p) => p.includes('app.ts')),
      ).toBe(true);

      // debug.log should NOT be indexed (matched by *.log)
      expect(
        indexedPaths.some((p) => p.includes('debug.log')),
      ).toBe(false);

      // important.log should be indexed (negation !important.log re-includes it)
      expect(
        indexedPaths.some((p) => p.includes('important.log')),
      ).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('applies both .gitignore and config exclude patterns together', async () => {
    // Setup: .gitignore excludes dist/, config excludes vendor/
    const repoDir = makeTempDir();
    const dataDir = makeTempDir();

    writeFileSync(join(repoDir, '.gitignore'), 'dist/\n');
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { exclude: ['vendor/'] },
      }),
    );

    writeSourceFile(join(repoDir, 'src', 'main.ts'));
    writeSourceFile(join(repoDir, 'dist', 'out.js'));
    writeSourceFile(join(repoDir, 'vendor', 'lib.js'));

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      await engine.indexer.index({ repoRoot: repoDir });

      const indexedPaths = getIndexedFilePaths(dataDir);

      // src/main.ts is indexed
      expect(
        indexedPaths.some((p) => p.includes('main.ts')),
      ).toBe(true);

      // dist/out.js excluded by .gitignore
      expect(
        indexedPaths.some((p) => p.includes('out.js')),
      ).toBe(false);

      // vendor/lib.js excluded by config
      expect(
        indexedPaths.some((p) => p.includes('lib.js')),
      ).toBe(false);
    } finally {
      engine.close();
    }
  });
});
