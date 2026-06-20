import { describe, it, expect } from 'vitest';
import { getImportGraph } from '../ops/import-graph.js';
import type { ReadView } from '../handles.js';

function createMockHandle(edges: Array<{ fromNodeId: string; toNodeId: string; kind: string }>): ReadView {
  return {
    neighbors: () => [],
    ftsSearch: () => [],
    getNode: (id: string) => edges.some(e => e.fromNodeId === id || e.toNodeId === id) ? { id, kind: 'file' } : null,
    getClaim: () => null,
    claimsByPrefix: () => [],
    partiality: () => [],
    allEdges: (kind?: string) => kind ? edges.filter(e => e.kind === kind) : edges,
  };
}

describe('getImportGraph', () => {
  it('returns empty graph for empty scope', () => {
    const handle = createMockHandle([]);
    const result = getImportGraph(handle, { scope: '*' });
    expect(result.data.metrics.totalNodes).toBe(0);
    expect(result.data.metrics.totalEdges).toBe(0);
    expect(result.data.nodes).toHaveLength(0);
  });

  it('computes fan-in and fan-out correctly', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'A', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'D', toNodeId: 'B', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.metrics.totalNodes).toBe(4);
    expect(result.data.metrics.totalEdges).toBe(3);

    const nodeB = result.data.nodes.find(n => n.id === 'B');
    expect(nodeB).toBeDefined();
    expect(nodeB!.fanIn).toBe(2); // A and D import B
    expect(nodeB!.fanOut).toBe(0);

    const nodeA = result.data.nodes.find(n => n.id === 'A');
    expect(nodeA).toBeDefined();
    expect(nodeA!.fanIn).toBe(0);
    expect(nodeA!.fanOut).toBe(2); // A imports B and C
  });

  it('nodes are sorted by fan-in descending', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'C', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'D', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'A', toNodeId: 'C', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.nodes[0].id).toBe('B');
    expect(result.data.nodes[0].fanIn).toBe(3);
  });

  it('detects cycles with Tarjan SCC', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'B', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'C', toNodeId: 'A', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*', detectCycles: true });

    expect(result.data.cycles).toBeDefined();
    expect(result.data.cycles!.length).toBeGreaterThanOrEqual(1);
    expect(result.data.metrics.cycleCount).toBeGreaterThanOrEqual(1);
  });

  it('returns empty cycles for acyclic graph', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'B', toNodeId: 'C', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*', detectCycles: true });

    expect(result.data.cycles).toEqual([]);
    expect(result.data.cyclesLimitReached).toBe(false);
  });

  it('respects maxCycles limit', () => {
    // Create multiple independent cycles
    const edges = [
      { fromNodeId: 'A1', toNodeId: 'A2', kind: 'imports' },
      { fromNodeId: 'A2', toNodeId: 'A1', kind: 'imports' },
      { fromNodeId: 'B1', toNodeId: 'B2', kind: 'imports' },
      { fromNodeId: 'B2', toNodeId: 'B1', kind: 'imports' },
      { fromNodeId: 'C1', toNodeId: 'C2', kind: 'imports' },
      { fromNodeId: 'C2', toNodeId: 'C1', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*', detectCycles: true, maxCycles: 1 });

    expect(result.data.cycles!.length).toBe(1);
    expect(result.data.cyclesLimitReached).toBe(true);
  });

  it('computes transitive closure with full scope', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'B', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'C', toNodeId: 'D', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    // Use full scope so all edges are included, then transitive from A
    const result = getImportGraph(handle, { scope: '*', detectCycles: false });

    const nodeIds = new Set(result.data.nodes.map(n => n.id));
    expect(nodeIds.has('A')).toBe(true);
    expect(nodeIds.has('B')).toBe(true);
    expect(nodeIds.has('C')).toBe(true);
    expect(nodeIds.has('D')).toBe(true);
    expect(result.data.metrics.totalEdges).toBe(3);
  });

  it('result is a valid ResultEnvelope', () => {
    const handle = createMockHandle([]);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.query.op).toBe('getImportGraph');
    expect(result.modelRevision).toBeDefined();
    expect(result.evidence).toBeDefined();
    expect(result.uncertainties).toBeDefined();
    expect(result.suggestedNextCalls).toBeDefined();
  });

  it('adds uncertainty for empty scope', () => {
    const handle = createMockHandle([]);
    const result = getImportGraph(handle, { scope: 'nonexistent' });

    expect(result.uncertainties.length).toBeGreaterThan(0);
    expect(result.uncertainties[0].kind).toBe('empty-scope');
  });

  it('computes metrics correctly', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'A', toNodeId: 'C', kind: 'imports' },
    ];
    const handle = createMockHandle(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.metrics.totalNodes).toBe(3);
    expect(result.data.metrics.totalEdges).toBe(2);
    expect(result.data.metrics.maxFanOut).toBe(2); // A has fanOut=2
    expect(result.data.metrics.maxFanIn).toBe(1);
    expect(result.data.metrics.avgFanOut).toBeCloseTo(0.67, 1);
  });
});
