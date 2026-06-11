/**
 * Drift-detection tests verifying that the runtime validateSchema() in
 * config.ts stays consistent with config-schema.json.
 *
 * These tests read the JSON Schema to extract structural expectations, then
 * run representative inputs through loadConfigResult and assert agreement.
 * This catches drift without adding a runtime JSON Schema dependency (e.g. ajv).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfigResult } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '..',
  'config-schema.json',
);

function readSchema(): Record<string, unknown> {
  const text = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  return JSON.parse(text) as Record<string, unknown>;
}

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-schema-sync-'));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, obj: unknown): void {
  fs.writeFileSync(
    path.join(dir, 'viewer.config.json'),
    JSON.stringify(obj),
    'utf-8',
  );
}

function hasError(dir: string): boolean {
  const result = loadConfigResult(dir);
  return result.issues.some((i) => i.severity === 'error');
}

function hasIssueAtPath(dir: string, issuePath: string): boolean {
  const result = loadConfigResult(dir);
  return result.issues.some((i) => i.path === issuePath);
}

import { afterEach } from 'vitest';
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
// Schema structure assertions
// ---------------------------------------------------------------------------

describe('config-schema.json structural sync', () => {
  it('schema file exists and is valid JSON', () => {
    const schema = readSchema();
    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');
  });

  it('schema requires "version" field', () => {
    const schema = readSchema();
    const required = schema.required as string[];
    expect(required).toContain('version');
  });

  it('schema version is const 1', () => {
    const schema = readSchema();
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.version.const).toBe(1);
  });

  it('schema symbolBackend enum matches runtime VALID_SYMBOL_BACKENDS', () => {
    const schema = readSchema();
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const indexingProps = (props.indexing as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    const backendEnum = indexingProps.symbolBackend.enum as string[];
    expect(backendEnum).toEqual(
      expect.arrayContaining(['treesitter', 'lsp', 'scip']),
    );
    expect(backendEnum).toHaveLength(3);
  });

  it('schema gitHistoryDepth minimum matches runtime (>= 0)', () => {
    const schema = readSchema();
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const indexingProps = (props.indexing as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(indexingProps.gitHistoryDepth.minimum).toBe(0);
  });

  it('schema sqlite.pageSize constraints match runtime', () => {
    const schema = readSchema();
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const indexingProps = (props.indexing as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    const sqliteProps = (indexingProps.sqlite as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(sqliteProps.pageSize.minimum).toBe(512);
    expect(sqliteProps.pageSize.maximum).toBe(65536);
  });
});

// ---------------------------------------------------------------------------
// Behavioral agreement: valid configs
// ---------------------------------------------------------------------------

describe('schema-runtime agreement: valid configs', () => {
  it('minimal valid config passes runtime validation', () => {
    const dir = makeTmpDir();
    writeConfig(dir, { version: 1 });
    expect(hasError(dir)).toBe(false);
  });

  it('full valid config passes runtime validation', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      repository: { name: 'test', exclude: ['dist'] },
      indexing: {
        gitHistoryDepth: 100,
        symbolBackend: 'lsp',
        sqlite: { pageSize: 8192, cacheSize: -32000, mmapSize: 0, busyTimeout: 3000 },
        workerCount: 4,
        workerMinFiles: 200,
      },
      subsystems: [{ id: 's1', name: 'Sub 1', paths: ['src/s1'] }],
      rules: [
        {
          name: 'r1',
          type: 'no-import',
          from: { pathGlob: 'a/**' },
          to: { pathGlob: 'b/**' },
          severity: 'error',
        },
      ],
      remote: { enabled: false },
    });
    expect(hasError(dir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behavioral agreement: invalid version fails both
// ---------------------------------------------------------------------------

describe('schema-runtime agreement: invalid version', () => {
  it('version: 2 is rejected by runtime', () => {
    const dir = makeTmpDir();
    writeConfig(dir, { version: 2 });
    expect(hasError(dir)).toBe(true);
    expect(hasIssueAtPath(dir, 'version')).toBe(true);
  });

  it('missing version is rejected by runtime', () => {
    const dir = makeTmpDir();
    writeConfig(dir, { repository: {} });
    expect(hasError(dir)).toBe(true);
    expect(hasIssueAtPath(dir, 'version')).toBe(true);
  });

  it('non-integer version is rejected by runtime', () => {
    const dir = makeTmpDir();
    writeConfig(dir, { version: 'one' });
    expect(hasError(dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Behavioral agreement: invalid pageSize fails both
// ---------------------------------------------------------------------------

describe('schema-runtime agreement: invalid pageSize', () => {
  it('negative pageSize falls back to default (not accepted)', () => {
    const dir = makeTmpDir();
    writeConfig(dir, { version: 1, indexing: { sqlite: { pageSize: -1 } } });
    const result = loadConfigResult(dir);
    // Runtime silently falls back; schema would reject via minimum: 512
    expect(result.config.indexing.sqlite!.pageSize).toBe(4096);
  });

  it('pageSize above 65536 falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      indexing: { sqlite: { pageSize: 131072 } },
    });
    const result = loadConfigResult(dir);
    expect(result.config.indexing.sqlite!.pageSize).toBe(4096);
  });

  it('non-power-of-2 pageSize falls back to default', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      indexing: { sqlite: { pageSize: 3000 } },
    });
    const result = loadConfigResult(dir);
    expect(result.config.indexing.sqlite!.pageSize).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// Behavioral agreement: invalid symbolBackend fails both
// ---------------------------------------------------------------------------

describe('schema-runtime agreement: invalid symbolBackend', () => {
  it('unknown backend string is rejected by runtime', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      indexing: { symbolBackend: 'magic' },
    });
    expect(hasIssueAtPath(dir, 'indexing.symbolBackend')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Behavioral agreement: unknown fields pass runtime (lenient parsing)
// ---------------------------------------------------------------------------

describe('schema-runtime agreement: unknown fields', () => {
  it('extra top-level fields do not cause runtime errors', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      extraField: 'hello',
      anotherUnknown: 42,
    });
    // Runtime is lenient: unknown fields are ignored, no errors
    expect(hasError(dir)).toBe(false);
  });

  it('extra nested fields do not cause runtime errors', () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      version: 1,
      indexing: { symbolBackend: 'treesitter', customFlag: true },
    });
    expect(hasError(dir)).toBe(false);
  });
});
