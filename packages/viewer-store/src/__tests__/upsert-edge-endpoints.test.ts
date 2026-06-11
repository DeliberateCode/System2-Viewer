/**
 * Tests that upsertEdge updates from_node_id and to_node_id on conflict.
 *
 * This is a regression test for: re-indexing unchanged repo breaks overview
 * because contains edges kept stale fromNodeId pointing to the old
 * (now-closed) repository node.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ModelStore } from '../store.js';
import type { NodeRow, EdgeRow } from '../types.js';

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
    id: 'edge-contains-1',
    kind: 'contains',
    epistemic: 'static',
    fromNodeId: 'repo-rev1',
    toNodeId: 'file-node-1',
    repositoryId: 'repo1',
    confidenceBand: 'high',
    provenanceMethod: 'indexer::walk',
    extractor: 'viewer-indexer',
    evidenceIdsJson: null,
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('upsertEdge updates from_node_id and to_node_id on conflict', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-edge-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('updates from_node_id when edge is upserted with new source', () => {
    openStore();

    // First insert: edge points from repo-rev1 to file-node-1
    const txn1 = store.beginSnapshot('rev1');
    txn1.upsertNode(makeNodeRow({ id: 'repo-rev1', kind: 'repository', stableKey: 'repo1' }));
    txn1.upsertNode(makeNodeRow({ id: 'file-node-1', stableKey: 'repo1:file:a.ts' }));
    txn1.upsertEdge(makeEdgeRow({
      id: 'edge-contains-1',
      fromNodeId: 'repo-rev1',
      toNodeId: 'file-node-1',
    }));
    txn1.commit();

    // Verify initial state
    const rh1 = store.read();
    try {
      const neighbors = rh1.neighbors('repo-rev1', 'contains', 1);
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].fromNodeId).toBe('repo-rev1');
    } finally {
      rh1.close();
    }

    // Second insert (simulates re-index): same edge id, new fromNodeId
    const txn2 = store.beginSnapshot('rev2');
    txn2.upsertNode(makeNodeRow({ id: 'repo-rev2', kind: 'repository', stableKey: 'repo1' }));
    txn2.upsertEdge(makeEdgeRow({
      id: 'edge-contains-1',
      fromNodeId: 'repo-rev2',
      toNodeId: 'file-node-1',
    }));
    txn2.commit();

    // Verify: the edge now points FROM repo-rev2
    const rh2 = store.read();
    try {
      const neighbors = rh2.neighbors('repo-rev2', 'contains', 1);
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].fromNodeId).toBe('repo-rev2');
      expect(neighbors[0].toNodeId).toBe('file-node-1');
    } finally {
      rh2.close();
    }

    // Also verify: the old repo node no longer has the edge pointing from it
    const rh3 = store.read();
    try {
      const oldNeighbors = rh3.neighbors('repo-rev1', 'contains', 1);
      expect(oldNeighbors).toHaveLength(0);
    } finally {
      rh3.close();
    }
  });

  it('updates to_node_id when edge is upserted with new target', () => {
    openStore();

    // First insert
    const txn1 = store.beginSnapshot('rev1');
    txn1.upsertNode(makeNodeRow({ id: 'from-1', stableKey: 'from1' }));
    txn1.upsertNode(makeNodeRow({ id: 'to-1', stableKey: 'to1' }));
    txn1.upsertNode(makeNodeRow({ id: 'to-2', stableKey: 'to2' }));
    txn1.upsertEdge(makeEdgeRow({
      id: 'edge-test',
      fromNodeId: 'from-1',
      toNodeId: 'to-1',
    }));
    txn1.commit();

    // Second insert: same edge id, new toNodeId
    const txn2 = store.beginSnapshot('rev2');
    txn2.upsertEdge(makeEdgeRow({
      id: 'edge-test',
      fromNodeId: 'from-1',
      toNodeId: 'to-2',
    }));
    txn2.commit();

    // Verify: edge points to to-2 now
    const rh = store.read();
    try {
      const neighbors = rh.neighbors('from-1', undefined, 1);
      const edge = neighbors.find(e => e.id === 'edge-test');
      expect(edge).toBeDefined();
      expect(edge!.toNodeId).toBe('to-2');
    } finally {
      rh.close();
    }
  });
});
