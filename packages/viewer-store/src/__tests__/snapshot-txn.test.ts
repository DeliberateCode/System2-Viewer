/**
 * SnapshotTxn CRUD tests for viewer-store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ModelStore } from '../store.js';
import type { NodeRow, EdgeRow, EvidenceRow, ClaimRow, EmbeddingRow } from '../types.js';

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

function makeEdgeRow(overrides: Partial<EdgeRow> = {}): EdgeRow {
  const now = new Date().toISOString();
  return {
    id: 'edge-1',
    kind: 'imports',
    epistemic: 'static',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    repositoryId: 'repo1',
    confidenceBand: 'high',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    evidenceIdsJson: null,
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEvidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  const now = new Date().toISOString();
  return {
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
    createdAt: now,
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

describe('SnapshotTxn', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-txn-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('upsertNode', () => {
    it('should persist a node row that is readable after commit', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.upsertNode(makeNodeRow());
      txn.commit();

      const rh = store.read();
      try {
        const node = rh.getNode('node-1');
        expect(node).not.toBeNull();
        expect(node!.id).toBe('node-1');
        expect(node!.kind).toBe('file');
        expect(node!.stable_key).toBe('repo1:file:src/index.ts');
        expect(node!.path).toBe('src/index.ts');
      } finally {
        rh.close();
      }
    });
  });

  describe('upsertEdge', () => {
    it('should persist an edge row that is readable via neighbors after commit', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      // Need two nodes for FK/referencing, and the edge
      txn.upsertNode(makeNodeRow({ id: 'node-1' }));
      txn.upsertNode(makeNodeRow({ id: 'node-2', stableKey: 'repo1:file:src/other.ts', path: 'src/other.ts' }));
      txn.upsertEdge(makeEdgeRow());
      txn.commit();

      const rh = store.read();
      try {
        const neighbors = rh.neighbors('node-1', 'imports', 1);
        expect(neighbors).toHaveLength(1);
        expect(neighbors[0].id).toBe('edge-1');
        expect(neighbors[0].fromNodeId).toBe('node-1');
        expect(neighbors[0].toNodeId).toBe('node-2');
        expect(neighbors[0].depth).toBe(1);
      } finally {
        rh.close();
      }
    });
  });

  describe('appendEvidence', () => {
    it('should persist evidence that is readable via getEvidence after commit', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.appendEvidence(makeEvidenceRow());
      txn.commit();

      const rh = store.read();
      try {
        const evd = rh.getEvidence('evd-1');
        expect(evd).not.toBeNull();
        expect(evd!.id).toBe('evd-1');
        expect(evd!.kind).toBe('source_span');
        expect(evd!.contentHash).toBe('abc123');
        expect(evd!.revision).toBe('rev1');
        expect(evd!.path).toBe('src/index.ts');
      } finally {
        rh.close();
      }
    });
  });

  describe('versionClaim', () => {
    it('should persist a claim that is readable via getClaim after commit', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.appendEvidence(makeEvidenceRow());
      txn.versionClaim(makeClaimRow());
      txn.commit();

      const rh = store.read();
      try {
        const claim = rh.getClaim('claim-1');
        expect(claim).not.toBeNull();
        expect(claim!.id).toBe('claim-1');
        expect(claim!.claimType).toBe('file-defines-symbol');
        expect(claim!.status).toBe('hypothesis');
        expect(claim!.confidenceBand).toBe('medium');
        expect(claim!.freshnessBand).toBe('fresh');
        expect(claim!.supportingEvidenceIds).toEqual(['evd-1']);
      } finally {
        rh.close();
      }
    });

    it('should appear in listOpenClaims when valid_to_revision is null', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.appendEvidence(makeEvidenceRow());
      txn.versionClaim(makeClaimRow());
      txn.commit();

      const rh = store.read();
      try {
        const claims = rh.listOpenClaims();
        expect(claims).toHaveLength(1);
        expect(claims[0].id).toBe('claim-1');
      } finally {
        rh.close();
      }
    });

    it('should filter listOpenClaims by generationId', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.appendEvidence(makeEvidenceRow());
      txn.versionClaim(makeClaimRow({ id: 'claim-gen1', generationId: 'gen-A' }));
      txn.versionClaim(makeClaimRow({ id: 'claim-gen2', generationId: 'gen-B' }));
      txn.commit();

      const rh = store.read();
      try {
        const genA = rh.listOpenClaims('gen-A');
        expect(genA).toHaveLength(1);
        expect(genA[0].id).toBe('claim-gen1');

        const genB = rh.listOpenClaims('gen-B');
        expect(genB).toHaveLength(1);
        expect(genB[0].id).toBe('claim-gen2');

        const all = rh.listOpenClaims();
        expect(all).toHaveLength(2);
      } finally {
        rh.close();
      }
    });
  });

  describe('abort', () => {
    it('should discard all writes when transaction is aborted', () => {
      openStore();

      // Write some data and abort
      const txn = store.beginSnapshot('rev1');
      txn.upsertNode(makeNodeRow({ id: 'aborted-node' }));
      txn.appendEvidence(makeEvidenceRow({ id: 'aborted-evd' }));
      txn.versionClaim(makeClaimRow({ id: 'aborted-claim' }));
      txn.abort();

      // Verify nothing was persisted
      const rh = store.read();
      try {
        expect(rh.getNode('aborted-node')).toBeNull();
        expect(rh.getEvidence('aborted-evd')).toBeNull();
        expect(rh.getClaim('aborted-claim')).toBeNull();
        expect(rh.listOpenClaims()).toHaveLength(0);
      } finally {
        rh.close();
      }
    });

    it('should release writer lease after abort', () => {
      openStore();
      const txn1 = store.beginSnapshot('rev1');
      txn1.abort();

      // Should not throw -- lease is released
      const txn2 = store.beginSnapshot('rev2');
      txn2.abort();
    });
  });

  describe('closeInterval', () => {
    it('should set valid_to_revision on a claim', () => {
      openStore();

      // Insert a claim
      const txn1 = store.beginSnapshot('rev1');
      txn1.appendEvidence(makeEvidenceRow());
      txn1.versionClaim(makeClaimRow({ id: 'claim-interval', validFromRevision: 'rev1' }));
      txn1.commit();

      // Close its interval
      const txn2 = store.beginSnapshot('rev2');
      txn2.closeInterval('claim-interval', 'rev2');
      txn2.commit();

      // The claim should no longer be returned by getClaim (which filters valid_to IS NULL)
      const rh = store.read();
      try {
        const claim = rh.getClaim('claim-interval');
        expect(claim).toBeNull();

        // But listing all (not filtered by open) -- we can verify via raw DB
        const allClaims = rh.listOpenClaims();
        expect(allClaims).toHaveLength(0);
      } finally {
        rh.close();
      }
    });

    it('should set valid_to_revision on a node', () => {
      openStore();
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-close' }));
      txn1.commit();

      const txn2 = store.beginSnapshot('rev2');
      txn2.closeInterval('node-close', 'rev2');
      txn2.commit();

      const rh = store.read();
      try {
        const node = rh.getNode('node-close');
        expect(node).toBeNull(); // getNode filters valid_to_revision IS NULL
      } finally {
        rh.close();
      }
    });

    it('should set valid_to_revision on an edge', () => {
      openStore();
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'n1' }));
      txn1.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2' }));
      txn1.upsertEdge(makeEdgeRow({ id: 'edge-close', fromNodeId: 'n1', toNodeId: 'n2' }));
      txn1.commit();

      const txn2 = store.beginSnapshot('rev2');
      txn2.closeInterval('edge-close', 'rev2');
      txn2.commit();

      const rh = store.read();
      try {
        const neighbors = rh.neighbors('n1', 'imports', 1);
        expect(neighbors).toHaveLength(0); // edges with valid_to set are filtered out
      } finally {
        rh.close();
      }
    });
  });

  describe('appendVerificationHistory', () => {
    it('should persist verification history readable via readHandle', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.appendVerificationHistory({
        id: 'vh-1',
        claimId: 'claim-1',
        recipesJson: JSON.stringify([{ type: 'source_span_check' }]),
        priorConfidence: 'medium',
        newConfidence: 'high',
        priorFreshness: 'fresh',
        newFreshness: 'fresh',
        priorStatus: 'hypothesis',
        newStatus: 'confirmed',
        unresolvedReason: null,
        ranAt: new Date().toISOString(),
      });
      txn.commit();

      const rh = store.read();
      try {
        const history = rh.verificationHistory('claim-1');
        expect(history).toHaveLength(1);
        expect(history[0].id).toBe('vh-1');
        expect(history[0].claimId).toBe('claim-1');
        expect(history[0].priorConfidence).toBe('medium');
        expect(history[0].newConfidence).toBe('high');
      } finally {
        rh.close();
      }
    });
  });

  describe('promoteRule', () => {
    it('should persist a rule row', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      const now = new Date().toISOString();
      txn.promoteRule({
        id: 'rule-1',
        name: 'no-circular-imports',
        ruleType: 'forbidden_import',
        status: 'human_confirmed_explicit',
        source: 'explicit',
        repositoryId: 'repo1',
        definitionJson: JSON.stringify({ from: '**', to: 'internal/**' }),
        validFromRevision: 'rev1',
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });
      txn.commit();

      // Verify via raw DB since ReadHandle doesn't expose rules directly
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const row = db.prepare('SELECT * FROM rules WHERE id = ?').get('rule-1') as Record<string, unknown>;
        expect(row).toBeTruthy();
        expect(row.name).toBe('no-circular-imports');
        expect(row.status).toBe('human_confirmed_explicit');
        expect(row.source).toBe('explicit');
      } finally {
        db.close();
      }
    });
  });

  describe('upsertEmbedding', () => {
    it('should round-trip an embedding row through insert and raw query', () => {
      openStore();
      const vector = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
      const now = new Date().toISOString();
      const row: EmbeddingRow = {
        nodeId: 'node-emb-1',
        modelName: 'text-embedding-3-small',
        dimension: 3,
        vector,
        createdAt: now,
      };

      const txn = store.beginSnapshot('rev1');
      txn.upsertEmbedding(row);
      txn.commit();

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const result = db.prepare(
          'SELECT node_id, model_name, dimension, vector, created_at FROM embeddings WHERE node_id = ? AND model_name = ?',
        ).get('node-emb-1', 'text-embedding-3-small') as Record<string, unknown>;
        expect(result).toBeTruthy();
        expect(result.node_id).toBe('node-emb-1');
        expect(result.model_name).toBe('text-embedding-3-small');
        expect(result.dimension).toBe(3);
        expect(Buffer.isBuffer(result.vector)).toBe(true);
        const floats = new Float32Array((result.vector as Buffer).buffer, (result.vector as Buffer).byteOffset, 3);
        expect(floats[0]).toBeCloseTo(0.1);
        expect(floats[1]).toBeCloseTo(0.2);
        expect(floats[2]).toBeCloseTo(0.3);
        expect(result.created_at).toBe(now);
      } finally {
        db.close();
      }
    });

    it('should replace an existing embedding on conflict (same node_id + model_name)', () => {
      openStore();
      const now = new Date().toISOString();

      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertEmbedding({
        nodeId: 'node-emb-2',
        modelName: 'model-a',
        dimension: 2,
        vector: Buffer.from(new Float32Array([1.0, 2.0]).buffer),
        createdAt: now,
      });
      txn1.commit();

      const later = new Date().toISOString();
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertEmbedding({
        nodeId: 'node-emb-2',
        modelName: 'model-a',
        dimension: 2,
        vector: Buffer.from(new Float32Array([9.0, 8.0]).buffer),
        createdAt: later,
      });
      txn2.commit();

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rows = db.prepare(
          'SELECT * FROM embeddings WHERE node_id = ? AND model_name = ?',
        ).all('node-emb-2', 'model-a');
        expect(rows).toHaveLength(1);
        const row = rows[0] as Record<string, unknown>;
        const floats = new Float32Array((row.vector as Buffer).buffer, (row.vector as Buffer).byteOffset, 2);
        expect(floats[0]).toBeCloseTo(9.0);
        expect(floats[1]).toBeCloseTo(8.0);
        expect(row.created_at).toBe(later);
      } finally {
        db.close();
      }
    });
  });

  describe('error handling', () => {
    it('should throw when operating on a finished transaction', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.commit();

      expect(() => txn.upsertNode(makeNodeRow())).toThrow('already finished');
    });

    it('should throw when operating on an aborted transaction', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.abort();

      expect(() => txn.upsertNode(makeNodeRow())).toThrow('already finished');
    });

    it('should be idempotent for commit calls', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.upsertNode(makeNodeRow());
      txn.commit();
      // Second commit should not throw
      expect(() => txn.commit()).not.toThrow();
    });

    it('should be idempotent for abort calls', () => {
      openStore();
      const txn = store.beginSnapshot('rev1');
      txn.upsertNode(makeNodeRow());
      txn.abort();
      // Second abort should not throw
      expect(() => txn.abort()).not.toThrow();
    });
  });

  describe('clearFtsForRepository', () => {
    it('should remove all FTS rows for a repository before repopulating', () => {
      openStore();

      // Rev1: insert nodes and FTS rows
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-fts1', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev1' }));
      txn1.insertFtsText({ objectId: 'node-fts1', objectType: 'file', text: 'a.ts a.ts', path: 'a.ts' });
      txn1.commit();

      // Rev2: clear FTS and repopulate (simulating reindex)
      const txn2 = store.beginSnapshot('rev2');
      txn2.clearFtsForRepository('repo1');
      txn2.upsertNode(makeNodeRow({ id: 'node-fts1', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev2' }));
      txn2.insertFtsText({ objectId: 'node-fts1', objectType: 'file', text: 'a.ts a.ts', path: 'a.ts' });
      txn2.commit();

      // FTS should have exactly 1 row, not 2
      const rh = store.read();
      try {
        const hits = rh.ftsSearch('a.ts');
        expect(hits).toHaveLength(1);
      } finally {
        rh.close();
      }
    });

    it('should remove FTS rows for deleted files during reindex', () => {
      openStore();

      // Rev1: two files with FTS rows
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-keep', stableKey: 'repo1:file:keep.ts', path: 'keep.ts', validFromRevision: 'rev1' }));
      txn1.upsertNode(makeNodeRow({ id: 'node-del', stableKey: 'repo1:file:del.ts', path: 'del.ts', validFromRevision: 'rev1' }));
      txn1.insertFtsText({ objectId: 'node-keep', objectType: 'file', text: 'keep.ts keep.ts', path: 'keep.ts' });
      txn1.insertFtsText({ objectId: 'node-del', objectType: 'file', text: 'del.ts del.ts', path: 'del.ts' });
      txn1.commit();

      // Rev2: only keep.ts survives; clear FTS, repopulate, close stale
      const batchTs = '2099-01-01T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.clearFtsForRepository('repo1');
      txn2.upsertNode(makeNodeRow({ id: 'node-keep', stableKey: 'repo1:file:keep.ts', path: 'keep.ts', validFromRevision: 'rev2', updatedAt: batchTs }));
      txn2.insertFtsText({ objectId: 'node-keep', objectType: 'file', text: 'keep.ts keep.ts', path: 'keep.ts' });
      txn2.closeStaleIntervals('rev2', 'repo1', batchTs);
      txn2.commit();

      const rh = store.read();
      try {
        // Deleted file should not appear in FTS
        const delHits = rh.ftsSearch('del.ts');
        expect(delHits).toHaveLength(0);

        // Kept file should appear exactly once
        const keepHits = rh.ftsSearch('keep.ts');
        expect(keepHits).toHaveLength(1);
      } finally {
        rh.close();
      }
    });

    it('should not remove FTS rows for other repositories', () => {
      openStore();

      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-r1', repositoryId: 'repo1', stableKey: 'repo1:file:r1', validFromRevision: 'rev1' }));
      txn1.upsertNode(makeNodeRow({ id: 'node-r2', repositoryId: 'repo2', stableKey: 'repo2:file:r2', validFromRevision: 'rev1' }));
      txn1.insertFtsText({ objectId: 'node-r1', objectType: 'file', text: 'repo1file', path: 'r1.ts' });
      txn1.insertFtsText({ objectId: 'node-r2', objectType: 'file', text: 'repo2file', path: 'r2.ts' });
      txn1.commit();

      // Rev2: clear FTS only for repo1
      const txn2 = store.beginSnapshot('rev2');
      txn2.clearFtsForRepository('repo1');
      txn2.commit();

      const rh = store.read();
      try {
        const r1Hits = rh.ftsSearch('repo1file');
        expect(r1Hits).toHaveLength(0);
        const r2Hits = rh.ftsSearch('repo2file');
        expect(r2Hits).toHaveLength(1);
      } finally {
        rh.close();
      }
    });
  });

  describe('content refresh on re-upsert', () => {
    it('should create history row and advance valid_from when node content changes', () => {
      openStore();

      // Rev1: insert node with specific content
      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({
        id: 'node-content',
        stableKey: 'repo1:file:original.ts',
        displayName: 'original.ts',
        path: 'src/original.ts',
        language: 'typescript',
        metadataJson: JSON.stringify({ version: 1 }),
        validFromRevision: 'rev1',
        createdAt: ts1,
        updatedAt: ts1,
      }));
      txn1.commit();

      // Rev2: re-upsert with DIFFERENT content (simulating re-index with metadata change)
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({
        id: 'node-content',
        stableKey: 'repo1:file:original.ts',
        displayName: 'changed.ts',
        path: 'src/changed.ts',
        language: 'javascript',
        metadataJson: JSON.stringify({ version: 2 }),
        validFromRevision: 'rev2',
        createdAt: ts2,
        updatedAt: ts2,
      }));
      txn2.commit();

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        // Original row has new content and advanced valid_from_revision
        const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get('node-content') as Record<string, unknown>;
        expect(row.display_name).toBe('changed.ts');
        expect(row.path).toBe('src/changed.ts');
        expect(row.language).toBe('javascript');
        expect(JSON.parse(row.metadata_json as string)).toEqual({ version: 2 });
        expect(row.updated_at).toBe(ts2);
        expect(row.valid_from_revision).toBe('rev2');

        // History row preserves old content with closed interval
        const historyRow = db.prepare('SELECT * FROM nodes WHERE id = ?').get('node-content::vrev1') as Record<string, unknown>;
        expect(historyRow).toBeTruthy();
        expect(historyRow.display_name).toBe('original.ts');
        expect(historyRow.path).toBe('src/original.ts');
        expect(historyRow.language).toBe('typescript');
        expect(JSON.parse(historyRow.metadata_json as string)).toEqual({ version: 1 });
        expect(historyRow.valid_from_revision).toBe('rev1');
        expect(historyRow.valid_to_revision).toBe('rev2');
        expect(historyRow.created_at).toBe(ts1);
      } finally {
        db.close();
      }
    });

    it('should create history row and advance valid_from when edge content changes', () => {
      openStore();

      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'n1', stableKey: 'repo1:file:n1', updatedAt: ts1 }));
      txn1.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2', updatedAt: ts1 }));
      txn1.upsertEdge(makeEdgeRow({
        id: 'edge-content',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        kind: 'imports',
        confidenceBand: 'high',
        evidenceIdsJson: JSON.stringify(['evd-1']),
        metadataJson: JSON.stringify({ specifier: './n2' }),
        validFromRevision: 'rev1',
        createdAt: ts1,
        updatedAt: ts1,
      }));
      txn1.commit();

      // Rev2: re-upsert edge with different content
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertEdge(makeEdgeRow({
        id: 'edge-content',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        kind: 'changed_with',
        confidenceBand: 'low',
        evidenceIdsJson: JSON.stringify(['evd-2']),
        metadataJson: JSON.stringify({ specifier: './changed' }),
        validFromRevision: 'rev2',
        updatedAt: ts2,
      }));
      txn2.commit();

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        // Original row has new content and advanced valid_from_revision
        const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge-content') as Record<string, unknown>;
        expect(row.confidence_band).toBe('low');
        expect(JSON.parse(row.evidence_ids_json as string)).toEqual(['evd-2']);
        expect(JSON.parse(row.metadata_json as string)).toEqual({ specifier: './changed' });
        expect(row.updated_at).toBe(ts2);
        expect(row.valid_from_revision).toBe('rev2');

        // History row preserves old content with closed interval
        const historyRow = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge-content::vrev1') as Record<string, unknown>;
        expect(historyRow).toBeTruthy();
        expect(historyRow.confidence_band).toBe('high');
        expect(JSON.parse(historyRow.evidence_ids_json as string)).toEqual(['evd-1']);
        expect(JSON.parse(historyRow.metadata_json as string)).toEqual({ specifier: './n2' });
        expect(historyRow.valid_from_revision).toBe('rev1');
        expect(historyRow.valid_to_revision).toBe('rev2');
        expect(historyRow.created_at).toBe(ts1);
      } finally {
        db.close();
      }
    });
  });

  describe('interval preservation on reindex', () => {
    it('should preserve valid_from_revision when unchanged entities are upserted', () => {
      openStore();

      // Rev1: insert two nodes
      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-a', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev1', createdAt: ts1, updatedAt: ts1 }));
      txn1.upsertNode(makeNodeRow({ id: 'node-b', stableKey: 'repo1:file:b.ts', path: 'b.ts', validFromRevision: 'rev1', createdAt: ts1, updatedAt: ts1 }));
      txn1.commit();

      // Rev2: reindex the SAME files (upsert same nodes with new revision/timestamp)
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({ id: 'node-a', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.upsertNode(makeNodeRow({ id: 'node-b', stableKey: 'repo1:file:b.ts', path: 'b.ts', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.closeStaleIntervals('rev2', 'repo1', ts2);
      txn2.commit();

      // Both nodes should still be visible
      const rh = store.read();
      try {
        expect(rh.getNode('node-a')).not.toBeNull();
        expect(rh.getNode('node-b')).not.toBeNull();
      } finally {
        rh.close();
      }

      // Verify valid_from_revision is preserved (still 'rev1', not bumped to 'rev2')
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rowA = db.prepare('SELECT valid_from_revision, created_at FROM nodes WHERE id = ?').get('node-a') as Record<string, unknown>;
        const rowB = db.prepare('SELECT valid_from_revision, created_at FROM nodes WHERE id = ?').get('node-b') as Record<string, unknown>;
        expect(rowA.valid_from_revision).toBe('rev1');
        expect(rowB.valid_from_revision).toBe('rev1');
        // created_at should also be preserved
        expect(rowA.created_at).toBe(ts1);
        expect(rowB.created_at).toBe(ts1);
      } finally {
        db.close();
      }
    });

    it('should preserve valid_from_revision for edges on reindex', () => {
      openStore();

      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'n1', stableKey: 'repo1:file:n1', updatedAt: ts1 }));
      txn1.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2', updatedAt: ts1 }));
      txn1.upsertEdge(makeEdgeRow({ id: 'edge-1', fromNodeId: 'n1', toNodeId: 'n2', validFromRevision: 'rev1', createdAt: ts1, updatedAt: ts1 }));
      txn1.commit();

      // Rev2: reindex same edge
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({ id: 'n1', stableKey: 'repo1:file:n1', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.upsertEdge(makeEdgeRow({ id: 'edge-1', fromNodeId: 'n1', toNodeId: 'n2', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.closeStaleIntervals('rev2', 'repo1', ts2);
      txn2.commit();

      // Edge should survive
      const rh = store.read();
      try {
        const neighbors = rh.neighbors('n1', 'imports', 1);
        expect(neighbors).toHaveLength(1);
      } finally {
        rh.close();
      }

      // valid_from_revision preserved
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const row = db.prepare('SELECT valid_from_revision, created_at FROM edges WHERE id = ?').get('edge-1') as Record<string, unknown>;
        expect(row.valid_from_revision).toBe('rev1');
        expect(row.created_at).toBe(ts1);
      } finally {
        db.close();
      }
    });

    it('should preserve valid_from_revision for claims on reindex', () => {
      openStore();

      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.appendEvidence(makeEvidenceRow());
      txn1.versionClaim(makeClaimRow({ id: 'claim-stable', validFromRevision: 'rev1', createdAt: ts1, updatedAt: ts1 }));
      txn1.commit();

      // Rev2: reindex same claim
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.versionClaim(makeClaimRow({ id: 'claim-stable', validFromRevision: 'rev2', updatedAt: ts2 }));
      txn2.closeStaleIntervals('rev2', 'repo1', ts2);
      txn2.commit();

      // Claim should survive
      const rh = store.read();
      try {
        expect(rh.getClaim('claim-stable')).not.toBeNull();
      } finally {
        rh.close();
      }

      // valid_from_revision preserved
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const row = db.prepare('SELECT valid_from_revision, created_at FROM claims WHERE id = ?').get('claim-stable') as Record<string, unknown>;
        expect(row.valid_from_revision).toBe('rev1');
        expect(row.created_at).toBe(ts1);
      } finally {
        db.close();
      }
    });
  });

  describe('historical revision reads', () => {
    it('should return old node metadata when reading at old revision after content change', () => {
      openStore();

      // Rev1: insert node
      const ts1 = '2024-01-01T00:00:00.000Z';
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({
        id: 'node-hist',
        stableKey: 'repo1:file:hist.ts',
        displayName: 'original.ts',
        path: 'src/original.ts',
        language: 'typescript',
        metadataJson: JSON.stringify({ version: 1 }),
        validFromRevision: 'rev1',
        createdAt: ts1,
        updatedAt: ts1,
      }));
      txn1.commit();

      // Rev2: re-upsert with different content
      const ts2 = '2024-01-02T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({
        id: 'node-hist',
        stableKey: 'repo1:file:hist.ts',
        displayName: 'updated.ts',
        path: 'src/updated.ts',
        language: 'javascript',
        metadataJson: JSON.stringify({ version: 2 }),
        validFromRevision: 'rev2',
        createdAt: ts2,
        updatedAt: ts2,
      }));
      txn2.commit();

      // Read at rev1: should see OLD content via history row
      const rhOld = store.read('rev1');
      try {
        const nodeAtRev1 = rhOld.getNode('node-hist');
        expect(nodeAtRev1).not.toBeNull();
        expect(nodeAtRev1!.display_name).toBe('original.ts');
        expect(nodeAtRev1!.path).toBe('src/original.ts');
        expect(nodeAtRev1!.language).toBe('typescript');
      } finally {
        rhOld.close();
      }

      // Read at rev2 (or current): should see NEW content
      const rhNew = store.read('rev2');
      try {
        const nodeAtRev2 = rhNew.getNode('node-hist');
        expect(nodeAtRev2).not.toBeNull();
        expect(nodeAtRev2!.display_name).toBe('updated.ts');
        expect(nodeAtRev2!.path).toBe('src/updated.ts');
        expect(nodeAtRev2!.language).toBe('javascript');
      } finally {
        rhNew.close();
      }

      // Read without revision (current): should see NEW content
      const rhCurrent = store.read();
      try {
        const nodeNow = rhCurrent.getNode('node-hist');
        expect(nodeNow).not.toBeNull();
        expect(nodeNow!.display_name).toBe('updated.ts');
      } finally {
        rhCurrent.close();
      }
    });
  });

  describe('closeStaleIntervals', () => {
    it('should close intervals on nodes from prior revisions not rewritten in current', () => {
      openStore();

      // Rev1: insert two file nodes
      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-a', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev1' }));
      txn1.upsertNode(makeNodeRow({ id: 'node-b', stableKey: 'repo1:file:b.ts', path: 'b.ts', validFromRevision: 'rev1' }));
      txn1.commit();

      // Rev2: rewrite only node-a (simulates file b.ts was deleted).
      // Use a fixed batchTimestamp so closeStaleIntervals can distinguish
      // rewritten entities (updated_at = batchTs) from stale ones.
      const batchTs = '2099-01-01T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({ id: 'node-a', stableKey: 'repo1:file:a.ts', path: 'a.ts', validFromRevision: 'rev2', updatedAt: batchTs }));
      txn2.closeStaleIntervals('rev2', 'repo1', batchTs);
      txn2.commit();

      const rh = store.read();
      try {
        // node-a should still be visible (was rewritten)
        expect(rh.getNode('node-a')).not.toBeNull();
        // node-b should be closed (stale)
        expect(rh.getNode('node-b')).toBeNull();
      } finally {
        rh.close();
      }
    });

    it('should close stale edges from prior revisions', () => {
      openStore();

      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'n1', stableKey: 'repo1:file:n1' }));
      txn1.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2' }));
      txn1.upsertEdge(makeEdgeRow({ id: 'edge-stale', fromNodeId: 'n1', toNodeId: 'n2', validFromRevision: 'rev1' }));
      txn1.commit();

      // Rev2: rewrite nodes but not the edge
      const batchTs = '2099-01-01T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.upsertNode(makeNodeRow({ id: 'n1', stableKey: 'repo1:file:n1', validFromRevision: 'rev2', updatedAt: batchTs }));
      txn2.upsertNode(makeNodeRow({ id: 'n2', stableKey: 'repo1:file:n2', validFromRevision: 'rev2', updatedAt: batchTs }));
      txn2.closeStaleIntervals('rev2', 'repo1', batchTs);
      txn2.commit();

      const rh = store.read();
      try {
        const neighbors = rh.neighbors('n1', 'imports', 1);
        expect(neighbors).toHaveLength(0);
      } finally {
        rh.close();
      }
    });

    it('should close stale claims from prior revisions', () => {
      openStore();

      const txn1 = store.beginSnapshot('rev1');
      txn1.appendEvidence(makeEvidenceRow());
      txn1.versionClaim(makeClaimRow({ id: 'claim-stale', validFromRevision: 'rev1' }));
      txn1.commit();

      // Rev2: no claims rewritten -- use batchTimestamp that no existing claim has
      const batchTs = '2099-01-01T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.closeStaleIntervals('rev2', 'repo1', batchTs);
      txn2.commit();

      const rh = store.read();
      try {
        expect(rh.getClaim('claim-stale')).toBeNull();
      } finally {
        rh.close();
      }
    });

    it('should not close entities from other repositories', () => {
      openStore();

      const txn1 = store.beginSnapshot('rev1');
      txn1.upsertNode(makeNodeRow({ id: 'node-repo1', repositoryId: 'repo1', stableKey: 'repo1:file:a', validFromRevision: 'rev1' }));
      txn1.upsertNode(makeNodeRow({ id: 'node-repo2', repositoryId: 'repo2', stableKey: 'repo2:file:a', validFromRevision: 'rev1' }));
      txn1.commit();

      // Rev2: only close stale for repo1
      const batchTs = '2099-01-01T00:00:00.000Z';
      const txn2 = store.beginSnapshot('rev2');
      txn2.closeStaleIntervals('rev2', 'repo1', batchTs);
      txn2.commit();

      const rh = store.read();
      try {
        expect(rh.getNode('node-repo1')).toBeNull();
        expect(rh.getNode('node-repo2')).not.toBeNull();
      } finally {
        rh.close();
      }
    });
  });
});
