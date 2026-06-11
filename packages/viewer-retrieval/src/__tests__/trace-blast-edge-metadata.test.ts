/**
 * Tests for trace and blast operations reading edge metadata from NeighborEdge.
 *
 * Verifies Finding 1 fix: edge confidence, epistemic, and evidence are read
 * directly from the NeighborEdge object returned by neighbors(), not from
 * getNode(edge.id) which would always return null for edge IDs.
 */
import { describe, it, expect, vi } from 'vitest';
import { traceFlow } from '../ops/trace.js';
import { estimateBlastRadius } from '../ops/blast.js';
import type { FlowReadHandle, BlastReadHandle, NeighborEdge } from '../handles.js';

function mkEdge(overrides: Partial<NeighborEdge> = {}): NeighborEdge {
  return {
    id: 'edge-1',
    kind: 'imports',
    fromNodeId: 'node-a',
    toNodeId: 'node-b',
    depth: 1,
    confidenceBand: 'high',
    epistemic: 'static',
    evidenceIdsJson: JSON.stringify(['evd-1', 'evd-2']),
    ...overrides,
  };
}

describe('traceFlow: edge metadata from NeighborEdge', () => {
  it('reads confidence and epistemic from NeighborEdge, not getNode', () => {
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') {
        return [mkEdge({ confidenceBand: 'high', epistemic: 'static' })];
      }
      return [];
    });
    // getNode returns null for edge IDs (simulating the bug scenario)
    const getNode = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') return { id: 'node-a', kind: 'file' };
      if (id === 'node-b') return { id: 'node-b', kind: 'file' };
      return null; // edge IDs return null
    });

    const handle: FlowReadHandle = {
      getNode,
      neighbors,
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-b');
    const segments = result.data!.segments;

    expect(segments).toHaveLength(1);
    expect(segments[0].confidence).toBe('high');
    expect(segments[0].epistemic).toBe('static');
    // getNode should NOT have been called with edge ID
    expect(getNode).not.toHaveBeenCalledWith('edge-1');
  });

  it('extracts evidence IDs from NeighborEdge.evidenceIdsJson', () => {
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') {
        return [mkEdge({ evidenceIdsJson: JSON.stringify(['evd-x', 'evd-y']) })];
      }
      return [];
    });
    const getNode = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') return { id: 'node-a', kind: 'file' };
      if (id === 'node-b') return { id: 'node-b', kind: 'file' };
      return null;
    });

    const handle: FlowReadHandle = {
      getNode,
      neighbors,
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-b');
    const segments = result.data!.segments;

    expect(segments[0].evidence).toHaveLength(2);
    expect(segments[0].evidence[0].evidenceId).toBe('evd-x');
    expect(segments[0].evidence[1].evidenceId).toBe('evd-y');
  });

  it('defaults to medium/inferred when NeighborEdge fields are null', () => {
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') {
        return [mkEdge({ confidenceBand: null, epistemic: null, evidenceIdsJson: null })];
      }
      return [];
    });
    const getNode = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') return { id: 'node-a', kind: 'file' };
      if (id === 'node-b') return { id: 'node-b', kind: 'file' };
      return null;
    });

    const handle: FlowReadHandle = {
      getNode,
      neighbors,
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-b');
    const segments = result.data!.segments;

    expect(segments[0].confidence).toBe('medium');
    expect(segments[0].epistemic).toBe('inferred');
    expect(segments[0].evidence).toHaveLength(0);
  });
});

describe('estimateBlastRadius: edge metadata from NeighborEdge', () => {
  it('reads confidence and epistemic from NeighborEdge for risky edge detection', () => {
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') {
        return [mkEdge({
          id: 'edge-risky',
          confidenceBand: 'low',
          epistemic: 'inferred',
          fromNodeId: 'node-a',
          toNodeId: 'node-b',
        })];
      }
      return [];
    });
    const getNode = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') return { id: 'node-a', kind: 'file' };
      if (id === 'node-b') return { id: 'node-b', kind: 'file' };
      return null; // edge IDs return null
    });

    const handle: BlastReadHandle = {
      getNode,
      neighbors,
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = estimateBlastRadius(handle, ['node-a']);
    const report = result.data!;

    // Edge should be marked as risky with correct metadata
    expect(report.riskyEdges).toHaveLength(1);
    expect(report.riskyEdges[0].confidence).toBe('low');
    expect(report.riskyEdges[0].epistemic).toBe('inferred');

    // getNode should NOT have been called with edge ID
    expect(getNode).not.toHaveBeenCalledWith('edge-risky');
  });

  it('does not mark high-confidence static edges as risky', () => {
    const neighbors = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') {
        return [mkEdge({
          id: 'edge-solid',
          confidenceBand: 'high',
          epistemic: 'static',
          fromNodeId: 'node-a',
          toNodeId: 'node-b',
        })];
      }
      return [];
    });
    const getNode = vi.fn().mockImplementation((id: string) => {
      if (id === 'node-a') return { id: 'node-a', kind: 'file' };
      if (id === 'node-b') return { id: 'node-b', kind: 'file' };
      return null;
    });

    const handle: BlastReadHandle = {
      getNode,
      neighbors,
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = estimateBlastRadius(handle, ['node-a']);
    const report = result.data!;

    expect(report.riskyEdges).toHaveLength(0);
    expect(report.affectedNodes.find(n => n.nodeId === 'node-b')?.viaUncertainEdge).toBe(false);
  });
});
