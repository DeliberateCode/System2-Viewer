/**
 * Tests for viewer-config configuration loading.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, loadConfigResult, BUILT_IN_CLAIM_TYPES } from '../config.js';
import {
  DEFAULT_GIT_HISTORY_DEPTH,
  DEFAULT_SQLITE_PAGE_SIZE,
  DEFAULT_SQLITE_CACHE_SIZE,
  DEFAULT_SQLITE_MMAP_SIZE,
  DEFAULT_SQLITE_BUSY_TIMEOUT,
  DEFAULT_WORKER_MIN_FILES,
} from '../constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-config-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, 'viewer.config.json'), content, 'utf-8');
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  it('loads a valid config file', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        repository: { name: 'test-repo', exclude: ['dist'] },
        indexing: { gitHistoryDepth: 100, symbolBackend: 'lsp' },
        remote: { enabled: false },
      }),
    );

    const config = loadConfig(dir);
    expect(config.version).toBe(1);
    expect(config.repository.name).toBe('test-repo');
    expect(config.repository.exclude).toEqual(['dist']);
    expect(config.indexing.gitHistoryDepth).toBe(100);
    expect(config.indexing.symbolBackend).toBe('lsp');
    expect(config.remote.enabled).toBe(false);
  });

  it('returns defaults when config file is missing', () => {
    const dir = makeTmpDir();
    // No config file written

    const config = loadConfig(dir);
    expect(config.version).toBe(1);
    expect(config.indexing.gitHistoryDepth).toBe(DEFAULT_GIT_HISTORY_DEPTH);
    expect(config.indexing.symbolBackend).toBe('treesitter');
    expect(config.remote.enabled).toBe(false);
  });

  it('returns defaults when config file contains malformed JSON', () => {
    const dir = makeTmpDir();
    writeConfig(dir, '{not valid json!!!');

    const config = loadConfig(dir);
    expect(config.version).toBe(1);
    expect(config.indexing.gitHistoryDepth).toBe(DEFAULT_GIT_HISTORY_DEPTH);
    expect(config.indexing.symbolBackend).toBe('treesitter');
    expect(config.remote.enabled).toBe(false);
  });

  it('returns defaults when config has schema errors', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 99, // invalid version
        indexing: { gitHistoryDepth: -5 }, // invalid depth
      }),
    );

    const config = loadConfig(dir);
    // Should fall back to defaults due to version error
    expect(config.version).toBe(1);
    expect(config.indexing.gitHistoryDepth).toBe(DEFAULT_GIT_HISTORY_DEPTH);
  });
});

// ---------------------------------------------------------------------------
// Defaults verification
// ---------------------------------------------------------------------------

describe('defaults', () => {
  it('gitHistoryDepth defaults to 500', () => {
    const dir = makeTmpDir();
    const config = loadConfig(dir);
    expect(config.indexing.gitHistoryDepth).toBe(500);
  });

  it('symbolBackend defaults to treesitter', () => {
    const dir = makeTmpDir();
    const config = loadConfig(dir);
    expect(config.indexing.symbolBackend).toBe('treesitter');
  });

  it('remote.enabled defaults to false', () => {
    const dir = makeTmpDir();
    const config = loadConfig(dir);
    expect(config.remote.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadConfigResult
// ---------------------------------------------------------------------------

describe('loadConfigResult', () => {
  it('returns empty issues for valid config', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        repository: {},
        indexing: { gitHistoryDepth: 50, symbolBackend: 'treesitter' },
        remote: { enabled: false },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues).toHaveLength(0);
    expect(result.config.indexing.gitHistoryDepth).toBe(50);
  });

  it('returns issues for validation errors', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 99,
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('returns issues for malformed JSON', () => {
    const dir = makeTmpDir();
    writeConfig(dir, '{{{{');

    const result = loadConfigResult(dir);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.message).toContain('Malformed JSON');
  });

  it('returns no issues for missing file', () => {
    const dir = makeTmpDir();
    const result = loadConfigResult(dir);
    expect(result.issues).toHaveLength(0);
    expect(result.config.version).toBe(1);
  });

  it('reports invalid symbolBackend', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { symbolBackend: 'invalid-backend' },
      }),
    );

    const result = loadConfigResult(dir);
    expect(
      result.issues.some((i) => i.path === 'indexing.symbolBackend'),
    ).toBe(true);
  });

  it('reports non-integer gitHistoryDepth', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { gitHistoryDepth: 3.14 },
      }),
    );

    const result = loadConfigResult(dir);
    expect(
      result.issues.some((i) => i.path === 'indexing.gitHistoryDepth'),
    ).toBe(true);
  });

  it('merges valid rules from config', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        rules: [
          {
            name: 'no-direct-db',
            type: 'forbidden_import',
            from: { pathGlob: 'packages/api/**' },
            to: { pathGlob: 'packages/db/**' },
            severity: 'error',
          },
        ],
      }),
    );

    const config = loadConfig(dir);
    expect(config.rules).toHaveLength(1);
    expect(config.rules![0]!.name).toBe('no-direct-db');
  });

  it('merges valid subsystems from config', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        subsystems: [
          { id: 'auth', name: 'Authentication', paths: ['src/auth'] },
        ],
      }),
    );

    const config = loadConfig(dir);
    expect(config.subsystems).toHaveLength(1);
    expect(config.subsystems![0]!.id).toBe('auth');
  });
});

// ---------------------------------------------------------------------------
// claimTypes
// ---------------------------------------------------------------------------

describe('claimTypes', () => {
  it('valid claimTypes loads without errors', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        claimTypes: [
          {
            id: 'custom-claim',
            displayTemplate: '{subject} custom-relates-to {object}',
            severity: 'high',
          },
          {
            id: 'another-claim',
            displayTemplate: '{subject} is linked to {object}',
            defaultVerificationRecipes: [
              { recipeType: 'grep-search', description: 'Search for references' },
            ],
            evidenceRequirements: ['source-file'],
          },
        ],
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues).toHaveLength(0);
    expect(result.config.claimTypes).toHaveLength(2);
    expect(result.config.claimTypes![0]!.id).toBe('custom-claim');
    expect(result.config.claimTypes![0]!.displayTemplate).toBe('{subject} custom-relates-to {object}');
    expect(result.config.claimTypes![0]!.severity).toBe('high');
    expect(result.config.claimTypes![1]!.defaultVerificationRecipes).toHaveLength(1);
    expect(result.config.claimTypes![1]!.evidenceRequirements).toEqual(['source-file']);
  });

  it('malformed entry produces issue but other entries load', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        claimTypes: [
          { id: 123, displayTemplate: 'bad id type' }, // malformed: id not a string
          {
            id: 'good-claim',
            displayTemplate: '{subject} relates to {object}',
          },
        ],
      }),
    );

    const result = loadConfigResult(dir);
    // Should have a warning for the malformed entry
    expect(result.issues.some((i) => i.path === 'claimTypes[0].id')).toBe(true);
    // But the valid entry should still load
    expect(result.config.claimTypes).toHaveLength(1);
    expect(result.config.claimTypes![0]!.id).toBe('good-claim');
  });

  it('built-in collision produces error issue', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        claimTypes: [
          {
            id: 'file-defines-symbol',
            displayTemplate: 'overriding built-in',
          },
        ],
      }),
    );

    const result = loadConfigResult(dir);
    const collisionIssue = result.issues.find(
      (i) => i.path === 'claimTypes[0].id' && i.severity === 'error',
    );
    expect(collisionIssue).toBeDefined();
    expect(collisionIssue!.message).toContain('built-in');
  });

  it('BUILT_IN_CLAIM_TYPES contains expected IDs', () => {
    expect(BUILT_IN_CLAIM_TYPES.has('file-defines-symbol')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.has('file-defines-symbols')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.has('package-imports-package')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.has('directory-derived-subsystem-hypothesis')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.has('subsystem-owns-file')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.has('likely-entrypoint')).toBe(true);
    expect(BUILT_IN_CLAIM_TYPES.size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// indexing.sqlite
// ---------------------------------------------------------------------------

describe('indexing.sqlite', () => {
  it('valid sqlite config is loaded without error', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { cacheSize: -128000 } },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues).toHaveLength(0);
    expect(result.config.indexing.sqlite!.cacheSize).toBe(-128000);
    expect(result.config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
    expect(result.config.indexing.sqlite!.mmapSize).toBe(DEFAULT_SQLITE_MMAP_SIZE);
  });

  it('valid sqlite config with all keys is loaded', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: 8192, cacheSize: -32000, mmapSize: 0 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.pageSize).toBe(8192);
    expect(config.indexing.sqlite!.cacheSize).toBe(-32000);
    expect(config.indexing.sqlite!.mmapSize).toBe(0);
  });

  it('invalid pageSize (negative) falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: -1 } },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues).toHaveLength(0);
    expect(result.config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
  });

  it('invalid pageSize (not power of 2) falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: 3000 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
  });

  it('invalid pageSize (too large) falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: 131072 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
  });

  it('invalid mmapSize (negative) falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { mmapSize: -100 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.mmapSize).toBe(DEFAULT_SQLITE_MMAP_SIZE);
  });

  it('invalid cacheSize (float) falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { cacheSize: 3.14 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.cacheSize).toBe(DEFAULT_SQLITE_CACHE_SIZE);
  });

  it('missing sqlite key uses defaults', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { gitHistoryDepth: 200 },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite).toBeDefined();
    expect(config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
    expect(config.indexing.sqlite!.cacheSize).toBe(DEFAULT_SQLITE_CACHE_SIZE);
    expect(config.indexing.sqlite!.mmapSize).toBe(DEFAULT_SQLITE_MMAP_SIZE);
  });

  it('missing config file uses sqlite defaults', () => {
    const dir = makeTmpDir();
    const config = loadConfig(dir);
    expect(config.indexing.sqlite).toBeDefined();
    expect(config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
    expect(config.indexing.sqlite!.cacheSize).toBe(DEFAULT_SQLITE_CACHE_SIZE);
    expect(config.indexing.sqlite!.mmapSize).toBe(DEFAULT_SQLITE_MMAP_SIZE);
  });

  it('non-object sqlite value produces warning and uses defaults', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: 'not-an-object' },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues.some((i) => i.path === 'indexing.sqlite' && i.severity === 'warning')).toBe(true);
    expect(result.config.indexing.sqlite!.pageSize).toBe(DEFAULT_SQLITE_PAGE_SIZE);
  });

  it('accepts boundary pageSize values (512 and 65536)', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: 512 } },
      }),
    );
    expect(loadConfig(dir).indexing.sqlite!.pageSize).toBe(512);

    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { pageSize: 65536 } },
      }),
    );
    expect(loadConfig(dir).indexing.sqlite!.pageSize).toBe(65536);
  });
});

// ---------------------------------------------------------------------------
// indexing.workerCount + workerMinFiles
// ---------------------------------------------------------------------------

describe('indexing.workerCount and workerMinFiles', () => {
  it('valid workerCount is loaded', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerCount: 4 },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.workerCount).toBe(4);
  });

  it('workerCount below 1 produces warning and is not set', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerCount: 0 },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues.some((i) => i.path === 'indexing.workerCount' && i.severity === 'warning')).toBe(true);
    expect(result.config.indexing.workerCount).toBeUndefined();
  });

  it('workerCount above 16 produces warning and is not set', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerCount: 99 },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues.some((i) => i.path === 'indexing.workerCount' && i.severity === 'warning')).toBe(true);
    expect(result.config.indexing.workerCount).toBeUndefined();
  });

  it('workerCount boundary values accepted (1 and 16)', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerCount: 1 },
      }),
    );
    expect(loadConfig(dir).indexing.workerCount).toBe(1);

    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerCount: 16 },
      }),
    );
    expect(loadConfig(dir).indexing.workerCount).toBe(16);
  });

  it('valid workerMinFiles is loaded', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerMinFiles: 1000 },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.workerMinFiles).toBe(1000);
  });

  it('missing workerMinFiles defaults to 500', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { gitHistoryDepth: 100 },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.workerMinFiles).toBe(DEFAULT_WORKER_MIN_FILES);
  });

  it('invalid workerMinFiles (zero) produces warning and uses default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { workerMinFiles: 0 },
      }),
    );

    const result = loadConfigResult(dir);
    expect(result.issues.some((i) => i.path === 'indexing.workerMinFiles' && i.severity === 'warning')).toBe(true);
    expect(result.config.indexing.workerMinFiles).toBe(DEFAULT_WORKER_MIN_FILES);
  });
});

// ---------------------------------------------------------------------------
// indexing.sqlite.busyTimeout
// ---------------------------------------------------------------------------

describe('indexing.sqlite.busyTimeout', () => {
  it('configured busyTimeout is loaded', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { busyTimeout: 10000 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.busyTimeout).toBe(10000);
  });

  it('defaults to 5000 when omitted', () => {
    const dir = makeTmpDir();
    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.busyTimeout).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT);
    expect(config.indexing.sqlite!.busyTimeout).toBe(5000);
  });

  it('busyTimeout 0 is accepted (disables waiting)', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { busyTimeout: 0 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.busyTimeout).toBe(0);
  });

  it('negative busyTimeout falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { busyTimeout: -100 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.busyTimeout).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT);
  });

  it('non-integer busyTimeout falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(
      dir,
      JSON.stringify({
        version: 1,
        indexing: { sqlite: { busyTimeout: 3.14 } },
      }),
    );

    const config = loadConfig(dir);
    expect(config.indexing.sqlite!.busyTimeout).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT);
  });
});
