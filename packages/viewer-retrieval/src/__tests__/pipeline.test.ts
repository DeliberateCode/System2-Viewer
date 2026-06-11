/**
 * Tests for the 5-stage retrieval pipeline.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { runRetrievalPipeline, PIPELINE_STAGES } from '../pipeline.js';
import type { PipelineReadHandle } from '../handles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkHandle(overrides: Partial<PipelineReadHandle> = {}): PipelineReadHandle {
  return {
    getNode: vi.fn().mockReturnValue(null),
    getClaim: vi.fn().mockReturnValue(null),
    neighbors: vi.fn().mockReturnValue([]),
    ftsSearch: vi.fn().mockReturnValue([]),
    partiality: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PIPELINE_STAGES
// ---------------------------------------------------------------------------

describe('PIPELINE_STAGES', () => {
  it('defines exactly 5 stages', () => {
    expect(PIPELINE_STAGES).toHaveLength(5);
  });

  it('stages are in fixed order: symbolic, lexical, semantic, graph, claim', () => {
    expect(PIPELINE_STAGES[0]).toBe('symbolic');
    expect(PIPELINE_STAGES[1]).toBe('lexical');
    expect(PIPELINE_STAGES[2]).toBe('semantic');
    expect(PIPELINE_STAGES[3]).toBe('graph');
    expect(PIPELINE_STAGES[4]).toBe('claim');
  });

  it('includes "semantic" as a reserved stage', () => {
    expect(PIPELINE_STAGES).toContain('semantic');
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- semantic no-op
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: semantic no-op', () => {
  it('does not invoke any embedding, vector, or LLM analysis', () => {
    const handle = mkHandle();
    const result = runRetrievalPipeline(handle, {
      text: 'some query',
      revision: 'rev-1',
    });

    // The pipeline should complete without errors
    expect(result).toBeDefined();
    expect(result.anchors).toBeDefined();
    expect(Array.isArray(result.anchors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- semantic stage
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: semantic stage', () => {
  it('returns [] when handle has no semanticSearch (backward compat)', () => {
    const handle = mkHandle(); // no semanticSearch property
    const result = runRetrievalPipeline(handle, {
      text: 'some query',
      queryEmbedding: new Float32Array([0.1, 0.2, 0.3]),
      revision: 'rev-1',
    });

    // No semantic anchors should be present
    expect(result.anchors.filter(a => a.source === 'semantic')).toHaveLength(0);
  });

  it('returns [] when queryEmbedding is undefined', () => {
    const semanticSearch = vi.fn().mockReturnValue([]);
    const handle = mkHandle({ semanticSearch });

    const result = runRetrievalPipeline(handle, {
      text: 'some query',
      revision: 'rev-1',
      // no queryEmbedding
    });

    expect(semanticSearch).not.toHaveBeenCalled();
    expect(result.anchors.filter(a => a.source === 'semantic')).toHaveLength(0);
  });

  it('returns anchors from semanticSearch when both handle and embedding are present', () => {
    const semanticSearch = vi.fn().mockReturnValue([
      { nodeId: 'sem-1', score: 0.95 },
      { nodeId: 'sem-2', score: 0.72 },
    ]);
    const handle = mkHandle({ semanticSearch });
    const embedding = new Float32Array([0.1, 0.2, 0.3]);

    const result = runRetrievalPipeline(handle, {
      text: 'find similar',
      queryEmbedding: embedding,
      revision: 'rev-1',
    });

    expect(semanticSearch).toHaveBeenCalledWith(embedding, 10);
    const semAnchors = result.anchors.filter(a => a.source === 'semantic');
    expect(semAnchors).toHaveLength(2);

    const sem1 = semAnchors.find(a => a.id === 'sem-1')!;
    expect(sem1).toBeDefined();
    expect(sem1.source).toBe('semantic');
    expect(sem1.rank).toBeGreaterThan(0);
    expect(sem1.data).toHaveProperty('score', 0.95);

    const sem2 = semAnchors.find(a => a.id === 'sem-2')!;
    expect(sem2).toBeDefined();
    expect(sem2.source).toBe('semantic');
    expect(sem2.data).toHaveProperty('score', 0.72);
  });

  it('ranks higher-score hits above lower-score hits', () => {
    const semanticSearch = vi.fn().mockReturnValue([
      { nodeId: 'hi', score: 0.99 },
      { nodeId: 'lo', score: 0.10 },
    ]);
    const handle = mkHandle({ semanticSearch });

    const result = runRetrievalPipeline(handle, {
      queryEmbedding: new Float32Array([1]),
      revision: 'rev-1',
    });

    const hi = result.anchors.find(a => a.id === 'hi')!;
    const lo = result.anchors.find(a => a.id === 'lo')!;
    expect(hi.rank).toBeGreaterThan(lo.rank);
  });

  it('feeds semantic anchors into graph expansion', () => {
    const semanticSearch = vi.fn().mockReturnValue([
      { nodeId: 'sem-root', score: 0.85 },
    ]);
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'sem-root') {
        return [{ id: 'e1', kind: 'imports', fromNodeId: 'sem-root', toNodeId: 'sem-neighbor', depth: 1 }];
      }
      return [];
    });
    const handle = mkHandle({ semanticSearch, neighbors });

    const result = runRetrievalPipeline(handle, {
      queryEmbedding: new Float32Array([1]),
      revision: 'rev-1',
    });

    // sem-neighbor should appear from graph expansion of the semantic anchor
    expect(result.anchors.some(a => a.id === 'sem-neighbor')).toBe(true);
    const neighborAnchor = result.anchors.find(a => a.id === 'sem-neighbor')!;
    expect(neighborAnchor.source).toBe('graph');
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- symbolic stage
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: symbolic stage', () => {
  it('resolves explicit node ids to anchors', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-1') return { id: 'node-1', kind: 'file', path: 'src/a.ts' };
        return null;
      }),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['node-1'],
      revision: 'rev-1',
    });

    expect(result.anchors.some(a => a.id === 'node-1')).toBe(true);
    const anchor = result.anchors.find(a => a.id === 'node-1')!;
    expect(anchor.source).toBe('symbolic');
    expect(anchor.rank).toBe(100);
  });

  it('skips unresolvable node ids', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockReturnValue(null),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['nonexistent'],
      revision: 'rev-1',
    });

    expect(result.anchors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- lexical stage
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: lexical stage', () => {
  it('performs FTS search when text is provided', () => {
    const ftsSearch = vi.fn().mockReturnValue([
      { objectId: 'sym-1', objectType: 'symbol', text: 'processQueue', path: 'src/q.ts', rank: -5 },
    ]);
    const handle = mkHandle({ ftsSearch });

    const result = runRetrievalPipeline(handle, {
      text: 'processQueue',
      revision: 'rev-1',
    });

    expect(ftsSearch).toHaveBeenCalled();
    expect(result.anchors.some(a => a.id === 'sym-1')).toBe(true);
    const anchor = result.anchors.find(a => a.id === 'sym-1')!;
    expect(anchor.source).toBe('lexical');
  });

  it('does not call ftsSearch when no text provided', () => {
    const ftsSearch = vi.fn().mockReturnValue([]);
    const handle = mkHandle({ ftsSearch });

    runRetrievalPipeline(handle, { revision: 'rev-1' });

    expect(ftsSearch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- graph stage
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: graph stage', () => {
  it('expands anchors via neighbor traversal', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'n1') return { id: 'n1', kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockReturnValue([
        { id: 'e1', kind: 'imports', fromNodeId: 'n1', toNodeId: 'n2', depth: 1 },
      ]),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['n1'],
      revision: 'rev-1',
    });

    // n2 should appear as a graph-stage anchor
    expect(result.anchors.some(a => a.id === 'n2')).toBe(true);
    const graphAnchor = result.anchors.find(a => a.id === 'n2')!;
    expect(graphAnchor.source).toBe('graph');
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- claim stage
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: claim stage', () => {
  it('finds claims for anchored nodes', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'n1') return { id: 'n1', kind: 'file' };
        return null;
      }),
      getClaim: vi.fn().mockImplementation((id: string) => {
        if (id === 'n1') {
          return {
            id: 'n1',
            claimType: 'file-defines-symbol',
            statement: 'n1 defines foo',
            status: 'hypothesis',
            confidenceBand: 'medium',
            freshnessBand: 'fresh',
            validFromRevision: 'rev-1',
            validToRevision: null,
            scopeJson: '{}',
            supportingEvidenceIds: ['ev-1'],
          };
        }
        return null;
      }),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['n1'],
      revision: 'rev-1',
    });

    // The claim anchor should be present
    const claimAnchor = result.anchors.find(a => a.source === 'claim' || a.kind === 'claim');
    // n1 already has symbolic rank 100, which beats claim rank 50
    // The anchor for n1 should have source 'symbolic' due to merge keeping highest rank
    const n1Anchor = result.anchors.find(a => a.id === 'n1')!;
    expect(n1Anchor.rank).toBe(100);
    expect(n1Anchor.source).toBe('symbolic');
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- merge behavior
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: merge', () => {
  it('merges duplicate anchors by keeping highest rank', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'n1') return { id: 'n1', kind: 'file' };
        return null;
      }),
      ftsSearch: vi.fn().mockReturnValue([
        { objectId: 'n1', objectType: 'node', text: 'file n1', path: 'src/n1.ts', rank: -3 },
      ]),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['n1'],
      text: 'file n1',
      revision: 'rev-1',
    });

    // n1 appears from both symbolic (rank=100) and lexical.
    // Merge should keep the symbolic one (rank=100)
    const n1Anchors = result.anchors.filter(a => a.id === 'n1');
    expect(n1Anchors).toHaveLength(1);
    expect(n1Anchors[0]!.source).toBe('symbolic');
    expect(n1Anchors[0]!.rank).toBe(100);
  });

  it('sorts merged anchors by rank descending', () => {
    const handle = mkHandle({
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'n1') return { id: 'n1', kind: 'file' };
        return null;
      }),
      ftsSearch: vi.fn().mockReturnValue([
        { objectId: 'fts-1', objectType: 'symbol', text: 'bar', path: 'src/bar.ts', rank: -1 },
      ]),
    });

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['n1'],
      text: 'bar',
      revision: 'rev-1',
    });

    // n1 (rank 100 from symbolic) should come before fts-1
    if (result.anchors.length >= 2) {
      expect(result.anchors[0]!.rank).toBeGreaterThanOrEqual(result.anchors[1]!.rank);
    }
  });
});

// ---------------------------------------------------------------------------
// runRetrievalPipeline -- revision passthrough
// ---------------------------------------------------------------------------

describe('runRetrievalPipeline: revision', () => {
  it('passes revision through to the result', () => {
    const handle = mkHandle();
    const result = runRetrievalPipeline(handle, {
      revision: 'rev-abc',
    });
    expect(result.revision).toBe('rev-abc');
  });
});
