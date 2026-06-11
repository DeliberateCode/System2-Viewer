/**
 * Regression test: CTE cycle safety in ReadHandle.neighbors().
 *
 * Creates a cyclic graph (A -> B -> C -> A) and asserts the recursive CTE
 * terminates with a finite, bounded result set -- no infinite loop.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '../store.js';
import type { NodeRow, EdgeRow } from '../types.js';

const NOW = new Date().toISOString();

function makeNode(id: string): NodeRow {
  return {
    id,
    kind: 'file',
    stableKey: `repo1:file:${id}`,
    displayName: id,
    repositoryId: 'repo1',
    path: `src/${id}.ts`,
    language: 'typescript',
    fileClass: 'source',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeEdge(id: string, from: string, to: string, kind = 'imports'): EdgeRow {
  return {
    id,
    kind,
    epistemic: 'static',
    fromNodeId: from,
    toNodeId: to,
    repositoryId: 'repo1',
    confidenceBand: 'high',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    evidenceIdsJson: null,
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('regression: CTE cycle safety', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-cycle-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('neighbors() terminates on cyclic graph A -> B -> C -> A with kind filter', () => {
    openStore();
    const txn = store.beginSnapshot('rev1');
    txn.upsertNode(makeNode('A'));
    txn.upsertNode(makeNode('B'));
    txn.upsertNode(makeNode('C'));
    txn.upsertEdge(makeEdge('e-ab', 'A', 'B', 'imports'));
    txn.upsertEdge(makeEdge('e-bc', 'B', 'C', 'imports'));
    txn.upsertEdge(makeEdge('e-ca', 'C', 'A', 'imports'));
    txn.commit();

    const rh = store.read();
    try {
      // Query with maxDepth=5 -- well beyond the cycle length of 3
      const result = rh.neighbors('A', 'imports', 5);

      // (a) Query terminates (reaching this line proves it)
      expect(result).toBeDefined();

      // (b) Result set is finite
      expect(Array.isArray(result)).toBe(true);

      // (c) Result set is bounded: with 3 edges in a cycle, we should
      //     get at most 3 distinct edge IDs regardless of depth.
      const edgeIds = result.map(e => e.id);
      const uniqueEdgeIds = new Set(edgeIds);
      expect(uniqueEdgeIds.size).toBeLessThanOrEqual(3);

      // All three cycle edges should be found
      expect(uniqueEdgeIds).toContain('e-ab');
      expect(uniqueEdgeIds).toContain('e-bc');
      expect(uniqueEdgeIds).toContain('e-ca');
    } finally {
      rh.close();
    }
  });

  it('neighbors() terminates on cyclic graph A -> B -> C -> A without kind filter', () => {
    openStore();
    const txn = store.beginSnapshot('rev1');
    txn.upsertNode(makeNode('A'));
    txn.upsertNode(makeNode('B'));
    txn.upsertNode(makeNode('C'));
    txn.upsertEdge(makeEdge('e-ab', 'A', 'B', 'imports'));
    txn.upsertEdge(makeEdge('e-bc', 'B', 'C', 'imports'));
    txn.upsertEdge(makeEdge('e-ca', 'C', 'A', 'imports'));
    txn.commit();

    const rh = store.read();
    try {
      // No kind filter, maxDepth=5
      const result = rh.neighbors('A', undefined, 5);

      // Query terminates
      expect(result).toBeDefined();

      // Bounded: at most 3 unique edge IDs
      const uniqueEdgeIds = new Set(result.map(e => e.id));
      expect(uniqueEdgeIds.size).toBeLessThanOrEqual(3);
      expect(uniqueEdgeIds.size).toBeGreaterThanOrEqual(1);
    } finally {
      rh.close();
    }
  });

  it('no edge ID appears more than once per depth level', () => {
    openStore();
    const txn = store.beginSnapshot('rev1');
    txn.upsertNode(makeNode('A'));
    txn.upsertNode(makeNode('B'));
    txn.upsertNode(makeNode('C'));
    txn.upsertEdge(makeEdge('e-ab', 'A', 'B', 'imports'));
    txn.upsertEdge(makeEdge('e-bc', 'B', 'C', 'imports'));
    txn.upsertEdge(makeEdge('e-ca', 'C', 'A', 'imports'));
    txn.commit();

    const rh = store.read();
    try {
      const result = rh.neighbors('A', 'imports', 5);

      // Group by depth and verify no duplicate edge IDs within a depth level
      const byDepth = new Map<number, string[]>();
      for (const edge of result) {
        const existing = byDepth.get(edge.depth) ?? [];
        existing.push(edge.id);
        byDepth.set(edge.depth, existing);
      }

      for (const [depth, ids] of byDepth) {
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(
          ids.length,
          // Template for failure message
        );
      }
    } finally {
      rh.close();
    }
  });

  it('handles larger cycle with depth limit', () => {
    openStore();
    // 5-node cycle: A -> B -> C -> D -> E -> A
    const txn = store.beginSnapshot('rev1');
    for (const n of ['A', 'B', 'C', 'D', 'E']) {
      txn.upsertNode(makeNode(n));
    }
    txn.upsertEdge(makeEdge('e1', 'A', 'B', 'imports'));
    txn.upsertEdge(makeEdge('e2', 'B', 'C', 'imports'));
    txn.upsertEdge(makeEdge('e3', 'C', 'D', 'imports'));
    txn.upsertEdge(makeEdge('e4', 'D', 'E', 'imports'));
    txn.upsertEdge(makeEdge('e5', 'E', 'A', 'imports'));
    txn.commit();

    const rh = store.read();
    try {
      const result = rh.neighbors('A', 'imports', 10);

      // Terminates
      expect(result).toBeDefined();

      // At most 5 unique edges in a 5-node cycle
      const uniqueEdgeIds = new Set(result.map(e => e.id));
      expect(uniqueEdgeIds.size).toBeLessThanOrEqual(5);
    } finally {
      rh.close();
    }
  });
});
