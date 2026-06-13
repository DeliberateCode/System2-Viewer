/**
 * Tests for doctor utilities -- secret redaction and REDACTED sentinel.
 *
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';

vi.mock('@system2-viewer/viewer-indexer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@system2-viewer/viewer-indexer')>();
  return {
    ...original,
    probeEmbedderStatus: vi.fn(async () => ({ status: 'not_installed' as const })),
  };
});
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  looksLikeSecretValue,
  redactConfigValues,
  buildDoctorReport,
  REDACTED,
} from '../doctor.js';

// ---------------------------------------------------------------------------
// REDACTED constant
// ---------------------------------------------------------------------------

describe('REDACTED', () => {
  it('equals "[REDACTED]"', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// looksLikeSecretValue
// ---------------------------------------------------------------------------

describe('looksLikeSecretValue', () => {
  // Known secret prefixes
  it('returns true for sk- prefixed keys', () => {
    expect(looksLikeSecretValue('sk-abc123longkey')).toBe(true);
  });

  it('returns true for ghp_ prefixed tokens', () => {
    expect(looksLikeSecretValue('ghp_xxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('returns true for gho_ prefixed tokens', () => {
    expect(looksLikeSecretValue('gho_xxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('returns true for Bearer prefixed tokens', () => {
    expect(looksLikeSecretValue('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe(true);
  });

  it('returns true for xox prefixed Slack tokens', () => {
    expect(looksLikeSecretValue('xoxb-12345678901-12345678901-abcde')).toBe(true);
  });

  it('returns true for AKIA prefixed AWS keys', () => {
    expect(looksLikeSecretValue('AKIAIOSFODNN7EXAMPLE')).toBe(true);
  });

  // Non-secret values
  it('returns false for "hello"', () => {
    expect(looksLikeSecretValue('hello')).toBe(false);
  });

  it('returns false for "viewer-core"', () => {
    expect(looksLikeSecretValue('viewer-core')).toBe(false);
  });

  it('returns false for short strings', () => {
    expect(looksLikeSecretValue('abc')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(looksLikeSecretValue('')).toBe(false);
  });

  it('returns false for normal paths', () => {
    expect(looksLikeSecretValue('/usr/local')).toBe(false);
  });

  it('returns false for normal package names', () => {
    expect(looksLikeSecretValue('@system2-viewer/viewer-core')).toBe(false);
  });

  // Hex-like patterns
  it('returns true for long hex strings (>= 24 chars)', () => {
    expect(looksLikeSecretValue('abcdef1234567890abcdef1234')).toBe(true);
  });

  // Base64-like patterns
  it('returns true for long base64-like strings', () => {
    expect(looksLikeSecretValue('ABCDEFGHIJKLMNOPQRSTUVWXYZab==')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// redactConfigValues
// ---------------------------------------------------------------------------

describe('redactConfigValues', () => {
  it('replaces secret-shaped values with [REDACTED]', () => {
    const config = {
      name: 'viewer',
      apiKey: 'sk-super-secret-key-12345',
      version: '1.0.0',
    };
    const result = redactConfigValues(config);
    expect(result['name']).toBe('viewer');
    expect(result['apiKey']).toBe('[REDACTED]');
    expect(result['version']).toBe('1.0.0');
  });

  it('handles nested objects', () => {
    const config = {
      outer: {
        token: 'ghp_xxxxxxxxxxxxxxxxxxxxx',
        name: 'test',
      },
    };
    const result = redactConfigValues(config);
    const inner = result['outer'] as Record<string, unknown>;
    expect(inner['token']).toBe('[REDACTED]');
    expect(inner['name']).toBe('test');
  });

  it('handles arrays with secret-shaped values', () => {
    const config = {
      tokens: ['sk-1234567890abcdef', 'public-value'],
    };
    const result = redactConfigValues(config);
    const arr = result['tokens'] as string[];
    expect(arr[0]).toBe('[REDACTED]');
    expect(arr[1]).toBe('public-value');
  });

  it('preserves non-string values', () => {
    const config = {
      count: 42,
      enabled: true,
      nothing: null,
    };
    const result = redactConfigValues(config);
    expect(result['count']).toBe(42);
    expect(result['enabled']).toBe(true);
    expect(result['nothing']).toBeNull();
  });

  it('does not modify the original config object', () => {
    const config = { key: 'sk-super-secret-key-12345' };
    redactConfigValues(config);
    expect(config.key).toBe('sk-super-secret-key-12345');
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- grammars field
// ---------------------------------------------------------------------------

describe('buildDoctorReport grammars field', () => {
  const EXPECTED_LANGUAGES = ['typescript', 'json', 'python', 'rust', 'go', 'java'];
  const VALID_STATUSES = ['available', 'load_failed', 'not_installed'];

  it('includes a grammars field with entries for all supported languages', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(report.grammars).toBeDefined();
    for (const lang of EXPECTED_LANGUAGES) {
      expect(report.grammars).toHaveProperty(lang);
    }
  });

  it('each grammar entry has a valid status string', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(report.grammars).toBeDefined();
    for (const lang of EXPECTED_LANGUAGES) {
      const status = report.grammars![lang];
      expect(VALID_STATUSES).toContain(status);
    }
  });

  it('preserves backward-compatible grammarAvailability field', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(report.grammarAvailability).toBeDefined();
    expect(typeof report.grammarAvailability['typescript']).toBe('boolean');
    expect(typeof report.grammarAvailability['json']).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- embeddingModel field
// ---------------------------------------------------------------------------

describe('buildDoctorReport embeddingModel field', () => {
  it('includes an embeddingModel field in the report', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(report.embeddingModel).toBeDefined();
    expect(report.embeddingModel!.status).toBeDefined();
  });

  it('embeddingModel status is a valid value', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(['available', 'not_installed', 'load_failed']).toContain(
      report.embeddingModel!.status,
    );
  });

  it('status is "not_installed" when ONNX runtime is unavailable', async () => {
    // In the test environment, onnxruntime-node is not installed,
    // so probeEmbedderStatus returns 'not_installed'.
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(report.embeddingModel!.status).toBe('not_installed');
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- configuredBackend from config
//
// ---------------------------------------------------------------------------

describe('buildDoctorReport configuredBackend', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reflects config value when symbolBackend is set to "lsp"', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-backend-test-'));
    writeFileSync(
      join(tmpDir, 'viewer.config.json'),
      JSON.stringify({ version: 1, indexing: { symbolBackend: 'lsp' } }),
    );

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    // The config sets 'lsp', so configuredBackend must reflect that -- not the hardcoded default.
    expect(report.configuredBackend).toBe('lsp');
    // effectiveBackend depends on whether typescript package is resolvable.
    // In this test environment typescript is a devDependency, so it IS available,
    // and selectSymbolBackend('lsp') returns 'lsp' without degradation.
    // We verify that the report populates the field, not that it degrades.
    expect(typeof report.effectiveBackend).toBe('string');
    expect(report.effectiveBackend.length).toBeGreaterThan(0);
  });

  it('defaults to "treesitter" when config has no symbolBackend', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-backend-default-test-'));
    // No viewer.config.json at all -- loadConfig returns defaults
    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.configuredBackend).toBe('treesitter');
    expect(report.effectiveBackend).toBe('treesitter');
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- suggestions array
//
// ---------------------------------------------------------------------------

describe('buildDoctorReport suggestions', () => {
  it('suggestions array is always present', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    expect(Array.isArray(report.suggestions)).toBe(true);
  });

  it('produces model_not_indexed suggestion when model does not exist', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    const modelSuggestion = report.suggestions.find(s => s.issue === 'model_not_indexed');
    expect(modelSuggestion).toBeDefined();
    expect(modelSuggestion!.severity).toBe('warning');
    expect(modelSuggestion!.command).toBe('viewer index .');
  });

  it('produces onnx_not_installed suggestion when ONNX runtime is missing', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    const onnxSuggestion = report.suggestions.find(s => s.issue === 'onnx_not_installed');
    expect(onnxSuggestion).toBeDefined();
    expect(onnxSuggestion!.severity).toBe('info');
    expect(onnxSuggestion!.command).toContain('onnxruntime-node');
  });

  it('has no error-severity suggestions when all healthy', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'doctor-healthy-'));
    try {
      // Create a model.sqlite so modelStatus=indexed
      const dbPath = join(tmpDir, 'model.sqlite');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.close();

      const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });
      const errorSuggestions = report.suggestions.filter(s => s.severity === 'error');
      expect(errorSuggestions).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('each suggestion has valid severity', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    for (const s of report.suggestions) {
      expect(['error', 'warning', 'info']).toContain(s.severity);
      expect(typeof s.issue).toBe('string');
      expect(typeof s.command).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- grammar install commands in suggestions
//
// Verifies that doctor suggestions for missing grammars include
// copy-paste install commands (e.g. `npm install tree-sitter-python`).
// ---------------------------------------------------------------------------

describe('buildDoctorReport grammar install suggestions', () => {
  it('includes npm install commands for missing grammars', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    const grammarSuggestions = report.suggestions.filter(
      s => s.issue === 'grammar_not_installed',
    );
    // At least some grammars are not installed in the test environment
    // (e.g. tree-sitter-python, tree-sitter-rust, tree-sitter-go, tree-sitter-java).
    // Each one must produce a suggestion with a copy-paste npm install command.
    for (const s of grammarSuggestions) {
      expect(s.command).toMatch(/^npm install tree-sitter-/);
      expect(s.severity).toBe('warning');
    }
  });

  it('grammar install command references the correct package name', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-doctor-test' });
    const grammarSuggestions = report.suggestions.filter(
      s => s.issue === 'grammar_not_installed',
    );
    // Every command must be a valid npm install invocation
    for (const s of grammarSuggestions) {
      const pkgName = s.command.replace('npm install ', '');
      expect(pkgName).toMatch(/^tree-sitter-[a-z]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- schemaMigration field
//
// ---------------------------------------------------------------------------

describe('buildDoctorReport schemaMigration', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports schemaMigration when model.sqlite exists with schema_migrations table', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-migration-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Create schema_migrations table with sample data
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (1, '001-initial-schema', '2026-01-01T00:00:00Z');
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (2, '002-embeddings', '2026-01-02T00:00:00Z');
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (3, '003-file-hashes', '2026-01-03T00:00:00Z');
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (4, '004-file-hash-stat', '2026-01-04T00:00:00Z');
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (5, '005-query-indexes', '2026-01-05T00:00:00Z');
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (6, '006-expand-edges-epistemic-declared', '2026-01-06T00:00:00Z');
    `);
    db.pragma('user_version = 6');
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.schemaMigration).toBeDefined();
    expect(report.schemaMigration!.currentVersion).toBe(6);
    expect(report.schemaMigration!.latestVersion).toBe(6);
    expect(report.schemaMigration!.pendingMigrations).toBe(0);
    expect(report.schemaMigration!.appliedMigrations).toHaveLength(6);
  });

  it('omits schemaMigration when model.sqlite does not exist', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-migration-none-'));
    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });
    expect(report.schemaMigration).toBeUndefined();
  });

  it('reports pending migrations and adds schema_pending suggestion', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-migration-pending-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Create schema_migrations with only version 1 applied
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (1, '001-initial-schema', '2026-01-01T00:00:00Z');
    `);
    db.pragma('user_version = 1');
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.schemaMigration).toBeDefined();
    expect(report.schemaMigration!.currentVersion).toBe(1);
    expect(report.schemaMigration!.pendingMigrations).toBeGreaterThan(0);

    const pendingSuggestion = report.suggestions.find(s => s.issue === 'schema_pending');
    expect(pendingSuggestion).toBeDefined();
    expect(pendingSuggestion!.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- sqlitePragmas field
//
// ---------------------------------------------------------------------------

describe('buildDoctorReport sqlitePragmas', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports sqlitePragmas when model.sqlite exists', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-pragma-test-'));
    // Create a minimal SQLite database so doctor can read PRAGMAs
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -32000');
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.sqlitePragmas).toBeDefined();
    expect(typeof report.sqlitePragmas!.pageSize).toBe('number');
    expect(typeof report.sqlitePragmas!.cacheSize).toBe('number');
    expect(typeof report.sqlitePragmas!.mmapSize).toBe('number');
    expect(report.sqlitePragmas!.pageSize).toBeGreaterThanOrEqual(512);
  });

  it('omits sqlitePragmas when model.sqlite does not exist', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-pragma-empty-'));
    // No model.sqlite -- doctor should not report pragmas
    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.sqlitePragmas).toBeUndefined();
  });

  it('reports numeric mmap_size from existing database', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-pragma-mmap-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    // mmap_size is session-scoped; doctor reads default from a fresh connection.
    // We verify it returns a valid number (the SQLite default).
    expect(report.sqlitePragmas).toBeDefined();
    expect(typeof report.sqlitePragmas!.mmapSize).toBe('number');
  });

  it('reports busyTimeout in sqlitePragmas', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-pragma-busy-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.sqlitePragmas).toBeDefined();
    expect(typeof report.sqlitePragmas!.busyTimeout).toBe('number');
    // A fresh readonly connection returns the SQLite default (0) for busy_timeout
    // since it is session-scoped and not persisted.
    expect(report.sqlitePragmas!.busyTimeout).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// buildDoctorReport -- absolutePathsDetected field
//
// ---------------------------------------------------------------------------

describe('buildDoctorReport absolutePathsDetected', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects legacy repoRoot in repository node metadata (legacy format)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-abs-paths-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Create minimal nodes table with a legacy format repository node storing repoRoot
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        display_name TEXT,
        repository_id TEXT NOT NULL,
        path TEXT,
        language TEXT,
        file_class TEXT,
        provenance_method TEXT NOT NULL,
        extractor TEXT NOT NULL,
        metadata_json TEXT,
        valid_from_revision TEXT NOT NULL,
        valid_to_revision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO nodes (id, kind, stable_key, display_name, repository_id, path,
        language, file_class, provenance_method, extractor, metadata_json,
        valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev-001', 'repository', 'repo::my-project', 'my-project', 'repo-1', null,
      null, null, 'indexer::init', 'viewer-indexer',
      JSON.stringify({ repoRoot: '/home/user/projects/my-project', workspace: 'auto', backend: 'treesitter' }),
      'rev-001', null, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    );
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.absolutePathsDetected).toBe(true);
    const suggestion = report.suggestions.find(s => s.issue === 'absolute_paths_detected');
    expect(suggestion).toBeDefined();
    expect(suggestion!.severity).toBe('warning');
    expect(suggestion!.command).toContain('viewer index');
    expect(suggestion!.command).toContain('--full');
  });

  it('does not flag when metadata uses repoName (post-G34 format)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-no-abs-paths-'));
    const dbPath = join(tmpDir, 'model.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        display_name TEXT,
        repository_id TEXT NOT NULL,
        path TEXT,
        language TEXT,
        file_class TEXT,
        provenance_method TEXT NOT NULL,
        extractor TEXT NOT NULL,
        metadata_json TEXT,
        valid_from_revision TEXT NOT NULL,
        valid_to_revision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO nodes (id, kind, stable_key, display_name, repository_id, path,
        language, file_class, provenance_method, extractor, metadata_json,
        valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev-001', 'repository', 'repo::my-project', 'my-project', 'repo-1', null,
      null, null, 'indexer::init', 'viewer-indexer',
      JSON.stringify({ repoName: 'my-project', workspace: 'auto', backend: 'treesitter' }),
      'rev-001', null, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    );
    db.close();

    const report = await buildDoctorReport({ dataDir: tmpDir, repoRoot: tmpDir });

    expect(report.absolutePathsDetected).toBeUndefined();
    const suggestion = report.suggestions.find(s => s.issue === 'absolute_paths_detected');
    expect(suggestion).toBeUndefined();
  });

  it('does not flag when no model exists', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-no-model-'));
    const report = await buildDoctorReport({ dataDir: tmpDir });

    expect(report.absolutePathsDetected).toBeUndefined();
  });
});
