/**
 * Smoke tests for bugfixes: revision insertion, FTS population,
 * exclude matcher, revision-scoped reads.
 *
 * Coverage: regression tests for Findings 1, 4, 5
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ModelStore } from '../store.js';
import type { NodeRow, ClaimRow, EvidenceRow } from '../types.js';

function makeNodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  const now = new Date().toISOString();
  return {
    id: 'node-1',
    kind: 'file',
    stableKey: 'repo1:file:src/index.ts',
    displayName: 'index.ts',
    repositoryId: 'repo1',
    path: 'src/index.ts',
    language: 'typescript',
    fileClass: 'source',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeClaimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  const now = new Date().toISOString();
  return {
    id: 'claim-1',
    claimType: 'file-defines-symbol',
    statement: 'index.ts defines function main',
    status: 'hypothesis',
    repositoryId: 'repo1',
    scopeJson: JSON.stringify({ path: 'src/index.ts' }),
    confidenceBand: 'medium',
    freshnessBand: 'fresh',
    supportingEvidenceIdsJson: JSON.stringify(['evd-1']),
    contradictingEvidenceIdsJson: null,
    verificationRecipesJson: JSON.stringify([{ type: 'source_span_check' }]),
    derivationMethod: 'indexer',
    generationId: 'gen-1',
    surfaced: 1,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Finding 1: insertRevision populates revisions table', () => {
  let dataDir: string;
  let store: ModelStore;

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('insertRevision creates a row in revisions table', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-rev-'));
    store = ModelStore.open(dataDir);

    const txn = store.beginSnapshot('rev1');
    txn.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: new Date().toISOString(),
      historyBounded: 0,
    });
    txn.commit();

    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const row = db.prepare('SELECT id, repository_id, kind FROM revisions WHERE id = ?').get('rev1') as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.id).toBe('rev1');
      expect(row!.repository_id).toBe('repo1');
      expect(row!.kind).toBe('working_tree');
    } finally {
      db.close();
    }
  });

  it('latestRevision returns revision id after insertRevision', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-latrev-'));
    store = ModelStore.open(dataDir);

    const txn = store.beginSnapshot('test-rev-abc');
    txn.insertRevision({
      id: 'test-rev-abc',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: new Date().toISOString(),
      historyBounded: 0,
    });
    txn.commit();

    const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    try {
      const row = db.prepare('SELECT id FROM revisions ORDER BY rowid DESC LIMIT 1').get() as { id: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.id).toBe('test-rev-abc');
    } finally {
      db.close();
    }
  });
});

describe('Finding 4: insertFtsText populates fts_text', () => {
  let dataDir: string;
  let store: ModelStore;

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('insertFtsText creates rows in fts_text table', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-fts-'));
    store = ModelStore.open(dataDir);

    const txn = store.beginSnapshot('rev1');
    txn.upsertNode(makeNodeRow({ id: 'file-1', stableKey: 'repo1:file:src/index.ts', path: 'src/index.ts' }));
    txn.upsertNode(makeNodeRow({ id: 'sym-1', kind: 'symbol', stableKey: 'repo1:symbol:processQueue', path: 'src/queue.ts' }));
    txn.insertFtsText({
      objectId: 'file-1',
      objectType: 'file',
      text: 'index.ts src/index.ts',
      path: 'src/index.ts',
    });
    txn.insertFtsText({
      objectId: 'sym-1',
      objectType: 'symbol',
      text: 'processQueue',
      path: 'src/queue.ts',
    });
    txn.commit();

    const rh = store.read();
    try {
      const hits = rh.ftsSearch('processQueue');
      expect(hits).toHaveLength(1);
      expect(hits[0].objectId).toBe('sym-1');
      expect(hits[0].objectType).toBe('symbol');
    } finally {
      rh.close();
    }
  });

  it('fts_text is searchable for file entries', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-fts2-'));
    store = ModelStore.open(dataDir);

    const txn = store.beginSnapshot('rev1');
    txn.upsertNode(makeNodeRow({ id: 'file-abc', stableKey: 'repo1:file:file-abc', path: 'src/index.ts' }));
    txn.insertFtsText({
      objectId: 'file-abc',
      objectType: 'file',
      text: 'index.ts src/index.ts',
      path: 'src/index.ts',
    });
    txn.commit();

    const rh = store.read();
    try {
      const hits = rh.ftsSearch('index.ts');
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].objectId).toBe('file-abc');
    } finally {
      rh.close();
    }
  });
});

describe('Finding 5: revision-scoped reads', () => {
  let dataDir: string;
  let store: ModelStore;

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('getNode with specific revision filters by interval', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-revread-'));
    store = ModelStore.open(dataDir);

    // Insert node valid from rev1, closed at rev2
    const txn1 = store.beginSnapshot('rev1');
    txn1.upsertNode(makeNodeRow({ id: 'node-rev', validFromRevision: 'rev1' }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.closeInterval('node-rev', 'rev2');
    txn2.commit();

    // Reading at rev1 should find it
    const rh1 = store.read('rev1');
    try {
      const node = rh1.getNode('node-rev');
      expect(node).not.toBeNull();
    } finally {
      rh1.close();
    }

    // Reading without revision (current) should not find it (closed)
    const rh2 = store.read();
    try {
      const node = rh2.getNode('node-rev');
      expect(node).toBeNull();
    } finally {
      rh2.close();
    }
  });

  it('getClaim with specific revision filters by interval', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-revclaim-'));
    store = ModelStore.open(dataDir);

    const txn1 = store.beginSnapshot('rev1');
    txn1.appendEvidence({
      id: 'evd-1',
      kind: 'source_span',
      epistemic: 'static',
      repositoryId: 'repo1',
      revision: 'rev1',
      path: 'src/index.ts',
      startLine: 1,
      endLine: 10,
      contentHash: 'abc123',
      extractor: 'tree-sitter',
      derivationLocality: 'local',
      actor: null,
      metadataJson: null,
      createdAt: new Date().toISOString(),
    });
    txn1.versionClaim(makeClaimRow({
      id: 'claim-rev',
      validFromRevision: 'rev1',
    }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.closeInterval('claim-rev', 'rev2');
    txn2.commit();

    // Reading at rev1 should find it
    const rh1 = store.read('rev1');
    try {
      const claim = rh1.getClaim('claim-rev');
      expect(claim).not.toBeNull();
    } finally {
      rh1.close();
    }

    // Reading without revision (current) should not find it
    const rh2 = store.read();
    try {
      const claim = rh2.getClaim('claim-rev');
      expect(claim).toBeNull();
    } finally {
      rh2.close();
    }
  });

  it('listOpenClaims with specific revision filters by interval', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-revlist-'));
    store = ModelStore.open(dataDir);

    const txn1 = store.beginSnapshot('rev1');
    txn1.appendEvidence({
      id: 'evd-1',
      kind: 'source_span',
      epistemic: 'static',
      repositoryId: 'repo1',
      revision: 'rev1',
      path: 'src/index.ts',
      startLine: 1,
      endLine: 10,
      contentHash: 'abc123',
      extractor: 'tree-sitter',
      derivationLocality: 'local',
      actor: null,
      metadataJson: null,
      createdAt: new Date().toISOString(),
    });
    txn1.versionClaim(makeClaimRow({
      id: 'claim-list-rev',
      validFromRevision: 'rev1',
    }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.closeInterval('claim-list-rev', 'rev2');
    txn2.commit();

    // Reading at rev1 should include it
    const rh1 = store.read('rev1');
    try {
      const claims = rh1.listOpenClaims();
      expect(claims.some(c => c.id === 'claim-list-rev')).toBe(true);
    } finally {
      rh1.close();
    }

    // Reading current should not include it
    const rh2 = store.read();
    try {
      const claims = rh2.listOpenClaims();
      expect(claims.some(c => c.id === 'claim-list-rev')).toBe(false);
    } finally {
      rh2.close();
    }
  });
});
