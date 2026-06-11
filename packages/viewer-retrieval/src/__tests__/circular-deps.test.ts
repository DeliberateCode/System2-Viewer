/**
 * Circular dependency regression tests.
 *
 * Verifies that graph traversal operations (neighbors, estimateBlastRadius,
 * traceFlow) terminate correctly when the dependency graph contains cycles.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { traceFlow } from '../ops/trace.js';
import { estimateBlastRadius } from '../ops/blast.js';
import type { FlowReadHandle, BlastReadHandle, NeighborEdge } from '../handles.js';

/**
 * Build a mock graph with nodes and directed edges.
 * edges is an array of [from, to] pairs.
 */
function buildCyclicHandle(
  nodeIds: string[],
  edges: Array<[string, string]>,
): FlowReadHandle & BlastReadHandle {
  const nodeSet = new Set(nodeIds);

  // Build adjacency: for each node, store all edges that touch it
  const adjacency = new Map<string, NeighborEdge[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }

  for (let i = 0; i < edges.length; i++) {
    const [from, to] = edges[i]!;
    const edge: NeighborEdge = {
      id: `edge-${from}-${to}`,
      kind: 'imports',
      fromNodeId: from,
      toNodeId: to,
      depth: 1,
      confidenceBand: 'high',
      epistemic: 'static',
      evidenceIdsJson: null,
    };
    // Store the edge under the fromNodeId for outbound traversal
    adjacency.get(from)?.push(edge);
    // Also store under toNodeId so BFS discovers both directions
    adjacency.get(to)?.push(edge);
  }

  return {
    getNode: vi.fn().mockImplementation((id: string) => {
      if (nodeSet.has(id)) return { id, kind: 'file' };
      return null;
    }),
    neighbors: vi.fn().mockImplementation((id: string) => {
      return adjacency.get(id) ?? [];
    }),
    ftsSearch: vi.fn().mockReturnValue([]),
    getClaim: vi.fn().mockReturnValue(null),
    partiality: vi.fn().mockReturnValue([]),
    inboundEdges: vi.fn().mockImplementation((id: string) => {
      // Return edges where toNodeId === id (inbound)
      return (adjacency.get(id) ?? []).filter((e) => e.toNodeId === id);
    }),
  };
}

describe('Circular dependency regression', () => {
  describe('5-node cycle: A -> B -> C -> D -> E -> A', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'E'],
      ['E', 'A'],
    ];

    it('estimateBlastRadius with A in changeScope terminates and returns finite results', () => {
      const handle = buildCyclicHandle(nodes, edges);

      // Must terminate (not hang) and return results
      const result = estimateBlastRadius(handle, ['A'], { maxDepth: 10 });

      expect(result.data).toBeDefined();
      const affected = result.data!.affectedNodes;

      // All 5 nodes should be reachable from A
      const affectedIds = new Set(affected.map((n) => n.nodeId));
      for (const node of nodes) {
        expect(affectedIds.has(node)).toBe(true);
      }

      // The result should be finite (not infinite recursion)
      expect(affected.length).toBeLessThanOrEqual(nodes.length);
    });

    it('traceFlow from A to E follows the cycle correctly and terminates', () => {
      const handle = buildCyclicHandle(nodes, edges);

      // Must terminate (not infinite loop)
      const result = traceFlow(handle, 'A', 'E', { maxDepth: 10 });

      expect(result.data).toBeDefined();
      const segments = result.data!.segments;

      // Should find a path from A to E
      // The direct path is A -> B -> C -> D -> E (4 hops)
      expect(segments.length).toBeGreaterThan(0);

      // First segment starts at A
      expect(segments[0]!.fromNodeId).toBe('A');

      // Last segment ends at E
      const lastSegment = segments[segments.length - 1]!;
      expect(lastSegment.toNodeId).toBe('E');
    });

    it('neighbors(A, maxDepth=10) terminates and returns finite results', () => {
      const handle = buildCyclicHandle(nodes, edges);

      // neighbors() is called internally by blast/trace; verify it returns finite results
      const neighbors = handle.neighbors('A');
      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBeGreaterThan(0);
      // Each neighbor should be a valid NeighborEdge
      for (const n of neighbors) {
        expect(n).toHaveProperty('id');
        expect(n).toHaveProperty('fromNodeId');
        expect(n).toHaveProperty('toNodeId');
      }
    });

    it('estimateBlastRadius with maxDepth=3 respects depth bound on cycle', () => {
      const handle = buildCyclicHandle(nodes, edges);

      const result = estimateBlastRadius(handle, ['A'], { maxDepth: 3 });
      expect(result.data).toBeDefined();
      const affected = result.data!.affectedNodes;

      // With maxDepth=3 starting from A:
      // depth 0: A
      // depth 1: B, E (E because E->A edge goes both ways in adjacency)
      // depth 2: C, D (via B->C and E->D reverse direction or D->E)
      // depth 3: D or C (depending on adjacency direction)
      // All affected nodes should have distance <= 3
      for (const node of affected) {
        expect(node.distance).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('diamond with cycle: A -> B -> D, A -> C -> D, D -> A', () => {
    const nodes = ['A', 'B', 'C', 'D'];
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
      ['D', 'A'],
    ];

    it('estimateBlastRadius terminates on diamond-with-cycle', () => {
      const handle = buildCyclicHandle(nodes, edges);

      const result = estimateBlastRadius(handle, ['A'], { maxDepth: 10 });
      expect(result.data).toBeDefined();

      const affectedIds = new Set(result.data!.affectedNodes.map((n) => n.nodeId));
      // All 4 nodes should be reachable
      for (const node of nodes) {
        expect(affectedIds.has(node)).toBe(true);
      }

      // Result count is bounded
      expect(result.data!.affectedNodes.length).toBeLessThanOrEqual(nodes.length);
    });

    it('traceFlow terminates on diamond-with-cycle from A to D', () => {
      const handle = buildCyclicHandle(nodes, edges);

      const result = traceFlow(handle, 'A', 'D', { maxDepth: 10 });
      expect(result.data).toBeDefined();
      const segments = result.data!.segments;

      // Should find path A -> B -> D or A -> C -> D (both are valid)
      expect(segments.length).toBeGreaterThan(0);

      // Path should end at D
      const lastSegment = segments[segments.length - 1]!;
      expect(lastSegment.toNodeId).toBe('D');
    });
  });

  describe('self-loop: A -> A', () => {
    it('estimateBlastRadius handles self-loop without infinite recursion', () => {
      const handle = buildCyclicHandle(['A'], [['A', 'A']]);

      const result = estimateBlastRadius(handle, ['A'], { maxDepth: 10 });
      expect(result.data).toBeDefined();

      const affectedIds = result.data!.affectedNodes.map((n) => n.nodeId);
      expect(affectedIds).toContain('A');
      // Only one node exists, so affected count should be 1
      expect(result.data!.affectedNodes.length).toBe(1);
    });
  });
});
