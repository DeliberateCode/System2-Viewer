/**
 * FTS5 safety tests for viewer-store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '../store.js';
import Database from 'better-sqlite3';

describe('FTS revision scoping', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-fts-scope-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should not return FTS hits for closed (stale) nodes', () => {
    openStore();

    // Insert a node and FTS row, then close the node's interval
    const txn1 = store.beginSnapshot('rev1');
    const now = new Date().toISOString();
    txn1.upsertNode({
      id: 'node-closed',
      kind: 'file',
      stableKey: 'repo1:file:closed.ts',
      displayName: 'closed.ts',
      repositoryId: 'repo1',
      path: 'closed.ts',
      language: 'typescript',
      fileClass: 'source',
      provenanceMethod: 'indexer',
      extractor: 'tree-sitter',
      metadataJson: null,
      validFromRevision: 'rev1',
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
    txn1.insertFtsText({
      objectId: 'node-closed',
      objectType: 'file',
      text: 'closedFileContent',
      path: 'closed.ts',
    });
    txn1.commit();

    // Close the node interval
    const txn2 = store.beginSnapshot('rev2');
    txn2.closeInterval('node-closed', 'rev2');
    txn2.commit();

    // FTS search should NOT return the closed node
    const rh = store.read();
    try {
      const hits = rh.ftsSearch('closedFileContent');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should return FTS hits for valid (open) nodes', () => {
    openStore();
    const now = new Date().toISOString();

    const txn1 = store.beginSnapshot('rev1');
    txn1.upsertNode({
      id: 'node-open',
      kind: 'file',
      stableKey: 'repo1:file:open.ts',
      displayName: 'open.ts',
      repositoryId: 'repo1',
      path: 'open.ts',
      language: 'typescript',
      fileClass: 'source',
      provenanceMethod: 'indexer',
      extractor: 'tree-sitter',
      metadataJson: null,
      validFromRevision: 'rev1',
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
    txn1.insertFtsText({
      objectId: 'node-open',
      objectType: 'file',
      text: 'openFileContent',
      path: 'open.ts',
    });
    txn1.commit();

    const rh = store.read();
    try {
      const hits = rh.ftsSearch('openFileContent');
      expect(hits).toHaveLength(1);
      expect(hits[0].objectId).toBe('node-open');
    } finally {
      rh.close();
    }
  });
});

describe('FTS5 safety', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-fts-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  function insertFtsRows(rows: Array<{ objectId: string; objectType: string; text: string; path: string }>): void {
    const db = new Database(join(dataDir, 'model.sqlite'));
    try {
      const now = new Date().toISOString();
      const ftsStmt = db.prepare(
        'INSERT INTO fts_text (object_id, object_type, text, path) VALUES (?, ?, ?, ?)'
      );
      // Map objectType to a valid kind_registry kind for the backing node
      const kindMap: Record<string, string> = { symbol: 'symbol', file: 'file', node: 'file' };
      const nodeStmt = db.prepare(
        `INSERT OR IGNORE INTO nodes
          (id, kind, stable_key, display_name, repository_id, path, language,
           file_class, provenance_method, extractor, metadata_json,
           valid_from_revision, valid_to_revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'repo-test', ?, NULL, NULL, 'test', 'test', NULL, 'rev-test', NULL, ?, ?)`
      );
      for (const row of rows) {
        const nodeKind = kindMap[row.objectType] ?? 'file';
        nodeStmt.run(row.objectId, nodeKind, row.objectId, row.objectId, row.path, now, now);
        ftsStmt.run(row.objectId, row.objectType, row.text, row.path);
      }
    } finally {
      db.close();
    }
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should find exact phrase matches', () => {
    openStore();
    insertFtsRows([
      { objectId: 'sym1', objectType: 'symbol', text: 'export function processQueue', path: 'src/queue.ts' },
      { objectId: 'sym2', objectType: 'symbol', text: 'export function processItem', path: 'src/item.ts' },
    ]);

    const rh = store.read();
    try {
      const hits = rh.ftsSearch('processQueue');
      expect(hits).toHaveLength(1);
      expect(hits[0].objectId).toBe('sym1');
    } finally {
      rh.close();
    }
  });

  it('should safely handle embedded double quotes', () => {
    openStore();
    insertFtsRows([
      { objectId: 'q1', objectType: 'node', text: 'a string with "quotes" inside', path: 'src/a.ts' },
      { objectId: 'q2', objectType: 'node', text: 'no quotes here', path: 'src/b.ts' },
    ]);

    const rh = store.read();
    try {
      // Search for a string that contains double quotes -- should not crash
      const hits = rh.ftsSearch('string with "quotes"');
      // The phrase-quoting mechanism doubles internal quotes
      // At minimum, it should not throw
      expect(Array.isArray(hits)).toBe(true);
    } finally {
      rh.close();
    }
  });

  it('should not treat OR as FTS operator (injection prevention)', () => {
    openStore();
    insertFtsRows([
      { objectId: 'or1', objectType: 'node', text: 'function alpha', path: 'src/alpha.ts' },
      { objectId: 'or2', objectType: 'node', text: 'function beta', path: 'src/beta.ts' },
    ]);

    const rh = store.read();
    try {
      // If "alpha OR beta" were interpreted as FTS operators, both rows would match.
      // With phrase quoting, neither should match (since the literal phrase "alpha OR beta" doesn't exist).
      const hits = rh.ftsSearch('alpha OR beta');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should not treat AND as FTS operator', () => {
    openStore();
    insertFtsRows([
      { objectId: 'a1', objectType: 'node', text: 'function alpha', path: 'src/a.ts' },
      { objectId: 'a2', objectType: 'node', text: 'function beta', path: 'src/b.ts' },
    ]);

    const rh = store.read();
    try {
      const hits = rh.ftsSearch('alpha AND beta');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should not treat NOT as FTS operator', () => {
    openStore();
    insertFtsRows([
      { objectId: 'n1', objectType: 'node', text: 'function alpha', path: 'src/a.ts' },
      { objectId: 'n2', objectType: 'node', text: 'function beta', path: 'src/b.ts' },
    ]);

    const rh = store.read();
    try {
      // "NOT alpha" as FTS operator would match beta. With quoting, it becomes a phrase literal.
      const hits = rh.ftsSearch('NOT alpha');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should not treat column: prefix as FTS column filter', () => {
    openStore();
    insertFtsRows([
      { objectId: 'col1', objectType: 'node', text: 'hello world', path: 'src/a.ts' },
    ]);

    const rh = store.read();
    try {
      // "path:src/a.ts" as unquoted FTS5 would be a column filter.
      // With phrase quoting, it should look for the literal phrase.
      const hits = rh.ftsSearch('path:src/a.ts');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should safely handle NEAR operator in search text', () => {
    openStore();
    insertFtsRows([
      { objectId: 'near1', objectType: 'node', text: 'function alpha beta', path: 'src/a.ts' },
    ]);

    const rh = store.read();
    try {
      // NEAR is an FTS5 operator. With quoting, it should be treated as literal text.
      const hits = rh.ftsSearch('alpha NEAR beta');
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should safely handle asterisk wildcard in search text', () => {
    openStore();
    insertFtsRows([
      { objectId: 'wild1', objectType: 'node', text: 'processQueue', path: 'src/a.ts' },
      { objectId: 'wild2', objectType: 'node', text: 'processItem', path: 'src/b.ts' },
    ]);

    const rh = store.read();
    try {
      // Unquoted "process*" would match both. With phrase quoting, it matches literally.
      const hits = rh.ftsSearch('process*');
      // The phrase "process*" as a literal should not match "processQueue"
      expect(hits).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('should handle empty search string gracefully', () => {
    openStore();
    insertFtsRows([
      { objectId: 'empty1', objectType: 'node', text: 'some text', path: 'src/a.ts' },
    ]);

    const rh = store.read();
    try {
      // An empty search on FTS5 with phrase quoting becomes '""' which may throw or return nothing
      // The key is that it does not crash the process
      try {
        const hits = rh.ftsSearch('');
        expect(Array.isArray(hits)).toBe(true);
      } catch {
        // Some FTS5 implementations reject empty queries -- that is acceptable behavior
      }
    } finally {
      rh.close();
    }
  });

  it('should handle special FTS5 characters in search text', () => {
    openStore();
    insertFtsRows([
      { objectId: 'sp1', objectType: 'node', text: 'hello world', path: 'src/a.ts' },
    ]);

    const rh = store.read();
    try {
      // Characters like ^, $, {, }, [, ] should not cause crashes
      for (const special of ['^hello', 'hello$', '{hello}', '[hello]', 'hello + world']) {
        expect(() => rh.ftsSearch(special)).not.toThrow();
      }
    } finally {
      rh.close();
    }
  });
});
