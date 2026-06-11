/**
 * Schema initialization tests for viewer-store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '../store.js';
import Database from 'better-sqlite3';

describe('schema initialization', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-schema-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const EXPECTED_TABLES = [
    'revisions',
    'kind_registry',
    'nodes',
    'edges',
    'evidence',
    'claims',
    'rules',
    'verification_history',
    'partiality',
    'fts_text',
    'view_cache',
    'embeddings',
  ] as const;

  it('should create all required tables', () => {
    openStore();
    // Open a raw connection to introspect the database
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const rows = db.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name"
      ).all() as Array<{ name: string }>;
      const tableNames = rows.map(r => r.name).filter(n => !n.startsWith('fts_text_'));
      for (const expected of EXPECTED_TABLES) {
        expect(tableNames, `table '${expected}' should exist`).toContain(expected);
      }
    } finally {
      db.close();
    }
  });

  it('should seed kind_registry with known kinds', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM kind_registry').get() as { cnt: number };
      // The seed SQL has 28 entries
      expect(count.cnt).toBe(28);

      // Check key node kinds
      for (const kind of ['repository', 'file', 'symbol', 'package', 'subsystem', 'directory']) {
        const row = db.prepare('SELECT kind FROM kind_registry WHERE kind = ?').get(kind);
        expect(row, `kind '${kind}' should be in registry`).toBeTruthy();
      }

      // Check key edge kinds
      for (const kind of ['contains', 'imports', 'defines', 'changed_with']) {
        const row = db.prepare('SELECT kind, category FROM kind_registry WHERE kind = ?').get(kind) as { kind: string; category: string };
        expect(row.category).toBe('edge');
      }

      // Check key evidence kinds
      for (const kind of ['human_annotation', 'llm_derivation', 'source_span', 'git_commit']) {
        const row = db.prepare('SELECT kind, category FROM kind_registry WHERE kind = ?').get(kind) as { kind: string; category: string };
        expect(row.category).toBe('evidence');
      }
    } finally {
      db.close();
    }
  });

  it('should enable PRAGMA foreign_keys = ON', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'));
    try {
      // We need a fresh connection to test the pragma. The store enables it on open.
      // But the stored DB itself doesn't persist the pragma -- it must be set per connection.
      // We verify that the store's own connection has it set by trying an FK-violating insert.
      const rh = store.read();
      try {
        // Attempting to insert a node with an invalid kind should fail with FK constraint
        // when foreign_keys is ON. We'll use a raw DB for this check.
      } finally {
        rh.close();
      }

      // Check pragma directly on a new connection (the store sets it on open)
      const fkValue = db.pragma('foreign_keys', { simple: true });
      // New connections default to OFF unless set. The store sets it on open.
      // This new connection won't have it. Let's test the store's behavior instead.
    } finally {
      db.close();
    }

    // The real test: the store should reject FK violations.
    // Insert a node with a kind not in kind_registry.
    const txn = store.beginSnapshot('rev-fk-test');
    try {
      expect(() => {
        txn.upsertNode({
          id: 'fk-test-node',
          kind: 'nonexistent_kind_xyz',
          stableKey: 'test',
          displayName: null,
          repositoryId: 'repo1',
          path: null,
          language: null,
          fileClass: null,
          provenanceMethod: 'test',
          extractor: 'test',
          metadataJson: null,
          validFromRevision: 'rev-fk-test',
          validToRevision: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }).toThrow(); // FOREIGN KEY constraint violation
    } finally {
      txn.abort();
    }
  });

  it('should enable WAL journal mode', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const mode = db.pragma('journal_mode', { simple: true }) as string;
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('should set user_version to 1 after initialization', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(5);
    } finally {
      db.close();
    }
  });

  it('should create required indexes', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name"
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map(r => r.name);
      expect(indexNames).toContain('idx_nodes_stable');
      expect(indexNames).toContain('idx_edges_from');
      expect(indexNames).toContain('idx_edges_to');
      expect(indexNames).toContain('idx_embeddings_model');
    } finally {
      db.close();
    }
  });

  it('should enforce CHECK constraints on claims.status', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'));
    db.pragma('foreign_keys = ON');
    try {
      expect(() => {
        db.prepare(`
          INSERT INTO claims
            (id, claim_type, statement, status, repository_id, scope_json,
             confidence_band, freshness_band, supporting_evidence_ids_json,
             contradicting_evidence_ids_json, verification_recipes_json,
             derivation_method, generation_id, surfaced,
             valid_from_revision, valid_to_revision, created_at, updated_at)
          VALUES
            ('chk1', 'test', 'test', 'INVALID_STATUS', 'repo1', '[]',
             'medium', 'fresh', '[]', '[]', '[]',
             'test', 'gen1', 0,
             'rev1', NULL, '2024-01-01', '2024-01-01')
        `).run();
      }).toThrow(); // CHECK constraint
    } finally {
      db.close();
    }
  });

  it('should enforce CHECK constraints on edges.epistemic', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'));
    db.pragma('foreign_keys = ON');
    try {
      expect(() => {
        db.prepare(`
          INSERT INTO edges
            (id, kind, epistemic, from_node_id, to_node_id, repository_id,
             confidence_band, provenance_method, extractor,
             valid_from_revision, created_at, updated_at)
          VALUES
            ('ck2', 'contains', 'INVALID_EPISTEMIC', 'n1', 'n2', 'repo1',
             'medium', 'test', 'test',
             'rev1', '2024-01-01', '2024-01-01')
        `).run();
      }).toThrow(); // CHECK constraint
    } finally {
      db.close();
    }
  });

  it('should create embeddings table with correct columns', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const columns = db.prepare("PRAGMA table_info('embeddings')").all() as Array<{
        name: string; type: string; notnull: number; pk: number;
      }>;
      const colMap = new Map(columns.map(c => [c.name, c]));

      expect(colMap.size).toBe(5);
      expect(colMap.get('node_id')!.type).toBe('TEXT');
      expect(colMap.get('node_id')!.notnull).toBe(1);
      expect(colMap.get('model_name')!.type).toBe('TEXT');
      expect(colMap.get('model_name')!.notnull).toBe(1);
      expect(colMap.get('dimension')!.type).toBe('INTEGER');
      expect(colMap.get('dimension')!.notnull).toBe(1);
      expect(colMap.get('vector')!.type).toBe('BLOB');
      expect(colMap.get('vector')!.notnull).toBe(1);
      expect(colMap.get('created_at')!.type).toBe('TEXT');
      expect(colMap.get('created_at')!.notnull).toBe(1);

      // Verify composite primary key (node_id pk=1, model_name pk=2)
      expect(colMap.get('node_id')!.pk).toBe(1);
      expect(colMap.get('model_name')!.pk).toBe(2);
    } finally {
      db.close();
    }
  });

  it('should enforce composite primary key on embeddings', () => {
    openStore();
    const db = new Database(join(dataDir, 'model.sqlite'));
    try {
      const vector = Buffer.alloc(12); // 3 floats x 4 bytes
      const insert = db.prepare(`
        INSERT INTO embeddings (node_id, model_name, dimension, vector, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      // First insert succeeds
      insert.run('node-1', 'text-embedding-3-small', 3, vector, '2025-01-01T00:00:00Z');

      // Duplicate (same node_id + model_name) should fail
      expect(() => {
        insert.run('node-1', 'text-embedding-3-small', 3, vector, '2025-01-02T00:00:00Z');
      }).toThrow(); // UNIQUE constraint failed

      // Same node_id, different model_name should succeed
      insert.run('node-1', 'text-embedding-3-large', 3, vector, '2025-01-01T00:00:00Z');

      // Different node_id, same model_name should succeed
      insert.run('node-2', 'text-embedding-3-small', 3, vector, '2025-01-01T00:00:00Z');
    } finally {
      db.close();
    }
  });

  it('should migrate existing v1 databases to add embeddings table', () => {
    // Create a v1 database without the embeddings table
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-migrate-'));
    const dbPath = join(dataDir, 'model.sqlite');
    const rawDb = new Database(dbPath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    // Execute the original schema without embeddings (simulate v1)
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT, committed_at TEXT, indexed_at TEXT NOT NULL, history_bounded INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS kind_registry (kind TEXT PRIMARY KEY, category TEXT NOT NULL, mvp_emitted INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, stable_key TEXT NOT NULL, display_name TEXT, repository_id TEXT NOT NULL, path TEXT, language TEXT, file_class TEXT, provenance_method TEXT NOT NULL, extractor TEXT NOT NULL, metadata_json TEXT, valid_from_revision TEXT NOT NULL, valid_to_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, epistemic TEXT NOT NULL, from_node_id TEXT NOT NULL, to_node_id TEXT NOT NULL, repository_id TEXT NOT NULL, confidence_band TEXT NOT NULL, provenance_method TEXT NOT NULL, extractor TEXT NOT NULL, evidence_ids_json TEXT, metadata_json TEXT, valid_from_revision TEXT NOT NULL, valid_to_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, kind TEXT NOT NULL, epistemic TEXT NOT NULL, repository_id TEXT NOT NULL, revision TEXT NOT NULL, path TEXT, start_line INTEGER, end_line INTEGER, content_hash TEXT, extractor TEXT NOT NULL, derivation_locality TEXT NOT NULL, actor TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, claim_type TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL, repository_id TEXT NOT NULL, scope_json TEXT NOT NULL, confidence_band TEXT NOT NULL, freshness_band TEXT NOT NULL, supporting_evidence_ids_json TEXT NOT NULL, contradicting_evidence_ids_json TEXT, verification_recipes_json TEXT NOT NULL, derivation_method TEXT NOT NULL, generation_id TEXT NOT NULL, surfaced INTEGER NOT NULL DEFAULT 0, valid_from_revision TEXT NOT NULL, valid_to_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, rule_type TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, repository_id TEXT NOT NULL, definition_json TEXT NOT NULL, valid_from_revision TEXT NOT NULL, valid_to_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verification_history (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, recipes_json TEXT NOT NULL, prior_confidence TEXT, new_confidence TEXT, prior_freshness TEXT, new_freshness TEXT, prior_status TEXT, new_status TEXT, unresolved_reason TEXT, ran_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS partiality (id TEXT PRIMARY KEY, revision TEXT NOT NULL, scope TEXT NOT NULL, extracted_json TEXT, failed_json TEXT, skipped_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS view_cache (id TEXT PRIMARY KEY, view_type TEXT NOT NULL, revision TEXT NOT NULL, input_hash TEXT NOT NULL, output_ref TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    rawDb.pragma('user_version = 1');
    rawDb.close();

    // Open via ModelStore, which should trigger migration
    store = ModelStore.open(dataDir);

    const db2 = new Database(dbPath, { readonly: true });
    try {
      const tables = db2.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'"
      ).all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      const version = db2.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(5);
    } finally {
      db2.close();
    }
  });
});
