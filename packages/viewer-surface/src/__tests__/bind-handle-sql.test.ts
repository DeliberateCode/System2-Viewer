/**
 * Tests for bind-handle SQL join coverage.
 *
 *
 * These are integration tests that create a real SQLite database with
 * populated data and exercise the SQL widenings in bindHandle:
 *   enumerateContainedNodes, allEdges, inboundEdges,
 *   allClaimIds, getClaimRecord, embeddingCoverage.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ModelStore } from '@system2-viewer/viewer-store';
import { bindHandle } from '../bind-handle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REV = 'rev::test-001';
const REPO = 'repo::test';
const NOW = '2026-06-07T00:00:00.000Z';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bind-handle-sql-test-'));
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
 * Creates a ModelStore, seeds it with a hierarchy and edges, then returns
 * a UnionHandle bound through bindHandle with a read-only DB connection.
 */
function createSeededStore(dataDir: string) {
  const store = ModelStore.open(dataDir);
  const txn = store.beginSnapshot(REV);

  // Insert revision
  txn.insertRevision({
    id: REV,
    repositoryId: REPO,
    kind: 'working_tree',
    parentId: null,
    committedAt: null,
    indexedAt: NOW,
    historyBounded: 0,
  });

  // Multi-level hierarchy: repo -> dir -> file1, file2
  const nodes = [
    { id: 'n-repo', kind: 'repository', stableKey: 'repo', displayName: 'test-repo' },
    { id: 'n-dir', kind: 'directory', stableKey: 'dir/src', displayName: 'src' },
    { id: 'n-file1', kind: 'file', stableKey: 'file/src/a.ts', displayName: 'a.ts' },
    { id: 'n-file2', kind: 'file', stableKey: 'file/src/b.ts', displayName: 'b.ts' },
    { id: 'n-sym1', kind: 'symbol', stableKey: 'sym/FooClass', displayName: 'FooClass' },
    { id: 'n-sym2', kind: 'symbol', stableKey: 'sym/BarFunc', displayName: 'BarFunc' },
  ];

  for (const n of nodes) {
    txn.upsertNode({
      id: n.id,
      kind: n.kind,
      stableKey: n.stableKey,
      displayName: n.displayName,
      repositoryId: REPO,
      path: null,
      language: 'typescript',
      fileClass: null,
      provenanceMethod: 'indexer',
      extractor: 'test',
      metadataJson: null,
      validFromRevision: REV,
      validToRevision: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  // Hierarchy edges: repo->dir (contains), dir->file1 (contains), dir->file2 (contains)
  const edges = [
    { id: 'e-contains-1', kind: 'contains', from: 'n-repo', to: 'n-dir' },
    { id: 'e-contains-2', kind: 'contains', from: 'n-dir', to: 'n-file1' },
    { id: 'e-contains-3', kind: 'contains', from: 'n-dir', to: 'n-file2' },
    // Non-containment edges
    { id: 'e-imports-1', kind: 'imports', from: 'n-file1', to: 'n-file2' },
    { id: 'e-defines-1', kind: 'defines', from: 'n-file1', to: 'n-sym1' },
    { id: 'e-defines-2', kind: 'defines', from: 'n-file2', to: 'n-sym2' },
    { id: 'e-refs-1', kind: 'references', from: 'n-file2', to: 'n-sym1' },
    { id: 'e-changed-1', kind: 'changed_with', from: 'n-file1', to: 'n-file2' },
  ];

  for (const e of edges) {
    txn.upsertEdge({
      id: e.id,
      kind: e.kind,
      epistemic: 'static',
      fromNodeId: e.from,
      toNodeId: e.to,
      repositoryId: REPO,
      confidenceBand: 'high',
      provenanceMethod: 'indexer',
      extractor: 'test',
      evidenceIdsJson: '[]',
      metadataJson: null,
      validFromRevision: REV,
      validToRevision: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  // Claims: some surfaced, some not
  const claims = [
    {
      id: 'claim-surfaced-1',
      claimType: 'subsystem',
      statement: 'Subsystem A exists',
      status: 'hypothesis' as const,
      surfaced: 1,
      confidenceBand: 'medium' as const,
    },
    {
      id: 'claim-surfaced-2',
      claimType: 'entrypoint',
      statement: 'File A is an entrypoint',
      status: 'confirmed' as const,
      surfaced: 1,
      confidenceBand: 'high' as const,
    },
    {
      id: 'claim-unsurfaced-1',
      claimType: 'subsystem',
      statement: 'Subsystem B might exist',
      status: 'hypothesis' as const,
      surfaced: 0,
      confidenceBand: 'low' as const,
    },
  ];

  for (const c of claims) {
    txn.versionClaim({
      id: c.id,
      claimType: c.claimType,
      statement: c.statement,
      status: c.status,
      repositoryId: REPO,
      scopeJson: '{}',
      confidenceBand: c.confidenceBand,
      freshnessBand: 'fresh',
      supportingEvidenceIdsJson: '["ev-1"]',
      contradictingEvidenceIdsJson: null,
      verificationRecipesJson: '[]',
      derivationMethod: 'indexer',
      generationId: 'gen-1',
      surfaced: c.surfaced,
      validFromRevision: REV,
      validToRevision: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  txn.commit();

  // Open a readonly DB connection for bindHandle
  const readonlyDb = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
  const readHandle = store.read(REV);

  return { store, readonlyDb, readHandle };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bindHandle SQL joins', () => {
  it('enumerateContainedNodes with multi-level hierarchy (repo -> dir -> file)', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const contained = handle.enumerateContainedNodes!('n-repo');

      // repo -> dir -> file1, file2
      // The recursive CTE should return dir + file1 + file2
      expect(contained.length).toBe(3);
      const ids = contained.map(n => n['id'] as string).sort();
      expect(ids).toEqual(['n-dir', 'n-file1', 'n-file2']);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('enumerateContainedNodes for leaf node returns empty array', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const contained = handle.enumerateContainedNodes!('n-file1');
      expect(contained).toEqual([]);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('allEdges with mixed edge kinds returns all edges', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const allEdges = handle.allEdges!();

      // We inserted 8 edges total
      expect(allEdges.length).toBe(8);

      const kinds = new Set(allEdges.map(e => e.kind));
      expect(kinds).toContain('contains');
      expect(kinds).toContain('imports');
      expect(kinds).toContain('defines');
      expect(kinds).toContain('references');
      expect(kinds).toContain('changed_with');
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('allEdges filtered by kind returns only edges of that kind', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);

      const containsEdges = handle.allEdges!('contains');
      expect(containsEdges.length).toBe(3);
      for (const e of containsEdges) {
        expect(e.kind).toBe('contains');
      }

      const importsEdges = handle.allEdges!('imports');
      expect(importsEdges.length).toBe(1);
      expect(importsEdges[0]!.fromNodeId).toBe('n-file1');
      expect(importsEdges[0]!.toNodeId).toBe('n-file2');
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('inboundEdges correctly finds edges pointing TO a node', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);

      // n-sym1 is the target of: e-defines-1 (file1->sym1) and e-refs-1 (file2->sym1)
      const inbound = handle.inboundEdges!('n-sym1');
      expect(inbound.length).toBe(2);
      const fromIds = inbound.map(e => e.fromNodeId).sort();
      expect(fromIds).toEqual(['n-file1', 'n-file2']);

      // Filter by kind
      const definesOnly = handle.inboundEdges!('n-sym1', 'defines');
      expect(definesOnly.length).toBe(1);
      expect(definesOnly[0]!.fromNodeId).toBe('n-file1');

      const refsOnly = handle.inboundEdges!('n-sym1', 'references');
      expect(refsOnly.length).toBe(1);
      expect(refsOnly[0]!.fromNodeId).toBe('n-file2');
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('inboundEdges for node with no inbound edges returns empty array', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);

      // n-repo has no inbound edges (it is only a source in contains edges)
      const inbound = handle.inboundEdges!('n-repo');
      expect(inbound).toEqual([]);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('allClaimIds returns both surfaced and unsurfaced claims', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const ids = handle.allClaimIds!();

      // We inserted 3 claims (2 surfaced, 1 unsurfaced)
      expect(ids.length).toBe(3);
      expect(ids).toContain('claim-surfaced-1');
      expect(ids).toContain('claim-surfaced-2');
      expect(ids).toContain('claim-unsurfaced-1');

      // Verify ordering (ORDER BY id)
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('getClaimRecord returns full claim fields', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const claim = handle.getClaimRecord!('claim-surfaced-2');

      expect(claim).not.toBeNull();
      expect(claim!.id).toBe('claim-surfaced-2');
      expect(claim!.claimType).toBe('entrypoint');
      expect(claim!.statement).toBe('File A is an entrypoint');
      expect(claim!.status).toBe('confirmed');
      expect(claim!.confidenceBand).toBe('high');
      expect(claim!.freshnessBand).toBe('fresh');
      expect(claim!.validFromRevision).toBe(REV);
      expect(claim!.validToRevision).toBeNull();
      expect(claim!.repositoryId).toBe(REPO);
      expect(claim!.supportingEvidenceIds).toEqual(['ev-1']);
      expect(claim!.surfaced).toBe(1);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('getClaimRecord returns null for non-existent claim', () => {
    const dataDir = makeTempDir();
    const { store, readonlyDb, readHandle } = createSeededStore(dataDir);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const claim = handle.getClaimRecord!('claim-does-not-exist');
      expect(claim).toBeNull();
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });

  it('embeddingCoverage with mix of embedded and non-embedded nodes', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    const txn = store.beginSnapshot(REV);

    txn.insertRevision({
      id: REV,
      repositoryId: REPO,
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: NOW,
      historyBounded: 0,
    });

    // Insert 3 file nodes and 2 symbol nodes (5 total eligible)
    const nodeIds = ['n-f1', 'n-f2', 'n-f3', 'n-s1', 'n-s2'];
    const nodeKinds = ['file', 'file', 'file', 'symbol', 'symbol'];
    for (let i = 0; i < nodeIds.length; i++) {
      txn.upsertNode({
        id: nodeIds[i]!,
        kind: nodeKinds[i]!,
        stableKey: `key-${nodeIds[i]}`,
        displayName: nodeIds[i]!,
        repositoryId: REPO,
        path: null,
        language: 'typescript',
        fileClass: null,
        provenanceMethod: 'indexer',
        extractor: 'test',
        metadataJson: null,
        validFromRevision: REV,
        validToRevision: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    // Embed only 2 of 5 nodes
    const dim = 3;
    for (const nodeId of ['n-f1', 'n-s1']) {
      const vec = new Float32Array([0.1, 0.2, 0.3]);
      txn.upsertEmbedding({
        nodeId,
        modelName: 'test-model',
        dimension: dim,
        vector: Buffer.from(vec.buffer),
        createdAt: NOW,
      });
    }

    txn.commit();

    const readonlyDb = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
    const readHandle = store.read(REV);

    try {
      const handle = bindHandle(readHandle, readonlyDb, REV);
      const coverage = handle.embeddingCoverage!();

      // embeddingCoverage delegates to readHandle which counts file+symbol nodes
      expect(coverage.totalNodes).toBe(5);
      expect(coverage.embeddedNodes).toBe(2);
    } finally {
      readHandle.close();
      readonlyDb.close();
      store.close();
    }
  });
});
