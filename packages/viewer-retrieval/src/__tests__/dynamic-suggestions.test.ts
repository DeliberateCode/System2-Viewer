/**
 * Tests for dynamic suggestedNextCalls in retrieval operations.
 *
 * Verifies that suggestions change based on query result data
 * rather than remaining static across all invocations.
 */
import { describe, it, expect, vi } from 'vitest';
import { traceFlow } from '../ops/trace.js';
import { estimateBlastRadius } from '../ops/blast.js';
import { getRepositoryOverview } from '../ops/overview.js';
import { listUncertainties } from '../ops/uncertainties.js';
import { findEntrypoints } from '../ops/entrypoints.js';
import type {
  FlowReadHandle,
  BlastReadHandle,
  ReadView,
  ListUncertaintiesReadHandle,
  EntrypointReadHandle,
  NeighborEdge,
  ClaimReadRow,
} from '../handles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkEdge(overrides: Partial<NeighborEdge> = {}): NeighborEdge {
  return {
    id: 'edge-1',
    kind: 'imports',
    fromNodeId: 'node-a',
    toNodeId: 'node-b',
    depth: 1,
    confidenceBand: 'high',
    epistemic: 'static',
    evidenceIdsJson: null,
    ...overrides,
  };
}

function mkClaim(overrides: Partial<ClaimReadRow> = {}): ClaimReadRow {
  return {
    id: 'claim-1',
    claimType: 'dependency',
    statement: 'A depends on B',
    status: 'active',
    confidenceBand: 'low',
    freshnessBand: 'fresh',
    validFromRevision: 'rev-1',
    validToRevision: null,
    scopeJson: '{}',
    supportingEvidenceIds: [],
    ...overrides,
  };
}

function suggestedOps(envelope: { suggestedNextCalls: Array<{ op: string }> }): string[] {
  return envelope.suggestedNextCalls.map((c) => c.op);
}

// ---------------------------------------------------------------------------
// traceFlow: dynamic suggestions
// ---------------------------------------------------------------------------

describe('traceFlow: dynamic suggestions', () => {
  it('suggests findEntrypoints and estimateBlastRadius when no path found', () => {
    const handle: FlowReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return { id: 'node-a', kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-z');
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.findEntrypoints');
    expect(ops).toContain('viewer.estimateBlastRadius');
    expect(ops).not.toContain('viewer.explainSubsystem');
  });

  it('suggests re-running with higher depth when truncated at maxDepth', () => {
    // Build a chain: a -> b -> c, with maxDepth=1 so the BFS truncates
    // before reaching the target 'node-c'
    const handle: FlowReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return { id: 'node-a', kind: 'file' };
        if (id === 'node-b') return { id: 'node-b', kind: 'file' };
        if (id === 'node-c') return { id: 'node-c', kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') {
          return [mkEdge({ fromNodeId: 'node-a', toNodeId: 'node-b' })];
        }
        if (id === 'node-b') {
          return [mkEdge({ id: 'edge-2', fromNodeId: 'node-b', toNodeId: 'node-c' })];
        }
        return [];
      }),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-c', { maxDepth: 1 });
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.traceFlow');
    // The re-run suggestion should have doubled maxDepth
    const rerunSuggestion = result.suggestedNextCalls.find(
      (c) => c.op === 'viewer.traceFlow',
    );
    expect(rerunSuggestion).toBeDefined();
    expect(rerunSuggestion!.args['maxDepth']).toBe(2);
    expect(rerunSuggestion!.reason).toContain('truncated');
  });

  it('suggests estimateBlastRadius and explainSubsystem when path is found', () => {
    const handle: FlowReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return { id: 'node-a', kind: 'file' };
        if (id === 'node-b') return { id: 'node-b', kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') {
          return [mkEdge({ fromNodeId: 'node-a', toNodeId: 'node-b' })];
        }
        return [];
      }),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = traceFlow(handle, 'node-a', 'node-b');
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.estimateBlastRadius');
    expect(ops).toContain('viewer.explainSubsystem');
    expect(ops).not.toContain('viewer.findEntrypoints');
    expect(ops).not.toContain('viewer.traceFlow');
  });
});

// ---------------------------------------------------------------------------
// estimateBlastRadius: dynamic suggestions
// ---------------------------------------------------------------------------

describe('estimateBlastRadius: dynamic suggestions', () => {
  it('suggests resolveReference when no affected nodes beyond seeds', () => {
    const handle: BlastReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return { id: 'node-a', kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = estimateBlastRadius(handle, ['node-a']);
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.resolveReference');
    expect(ops).not.toContain('viewer.listUncertainties');
  });

  it('suggests traceFlow when many affected nodes (>20)', () => {
    // Build a fan-out: node-a connects to 25 downstream nodes
    const downstreamNodes: NeighborEdge[] = [];
    for (let i = 0; i < 25; i++) {
      downstreamNodes.push(
        mkEdge({
          id: `edge-${i}`,
          fromNodeId: 'node-a',
          toNodeId: `node-${i}`,
          confidenceBand: 'high',
          epistemic: 'static',
        }),
      );
    }

    const handle: BlastReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id.startsWith('node-')) return { id, kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return downstreamNodes;
        return [];
      }),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = estimateBlastRadius(handle, ['node-a']);
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.traceFlow');
    // Should NOT have the default listUncertainties
    expect(ops).not.toContain('viewer.listUncertainties');

    const traceSuggestion = result.suggestedNextCalls.find(
      (c) => c.op === 'viewer.traceFlow',
    );
    expect(traceSuggestion!.reason).toContain('affected nodes');
  });

  it('suggests listUncertainties and traceFlow for moderate affected nodes', () => {
    // Build a fan-out: node-a connects to 5 downstream nodes (moderate)
    const downstreamNodes: NeighborEdge[] = [];
    for (let i = 0; i < 5; i++) {
      downstreamNodes.push(
        mkEdge({
          id: `edge-${i}`,
          fromNodeId: 'node-a',
          toNodeId: `node-${i}`,
          confidenceBand: 'high',
          epistemic: 'static',
        }),
      );
    }

    const handle: BlastReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id.startsWith('node-')) return { id, kind: 'file' };
        return null;
      }),
      neighbors: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-a') return downstreamNodes;
        return [];
      }),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = estimateBlastRadius(handle, ['node-a']);
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.listUncertainties');
    expect(ops).toContain('viewer.traceFlow');
    expect(ops).not.toContain('viewer.resolveReference');
  });
});

// ---------------------------------------------------------------------------
// getRepositoryOverview: dynamic suggestions
// ---------------------------------------------------------------------------

describe('getRepositoryOverview: dynamic suggestions', () => {
  function mkOverviewHandle(partialityRows: Array<{ id: string; revision: string; scope: string; extractedJson: string | null; failedJson: string | null; skippedJson: string | null }>): ReadView {
    return {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'repo-1') return { id: 'repo-1', kind: 'repository' };
        return null;
      }),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue(partialityRows),
      enumerateContainedNodes: vi.fn().mockReturnValue([]),
    };
  }

  it('suggests listUncertainties when model has partiality', () => {
    const handle = mkOverviewHandle([
      { id: 'p1', revision: 'latest', scope: 'python', extractedJson: '["ast"]', failedJson: null, skippedJson: '["treesitter"]' },
    ]);

    const result = getRepositoryOverview(handle, 'repo-1');
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.listUncertainties');
    const uncSuggestion = result.suggestedNextCalls.find(
      (c) => c.op === 'viewer.listUncertainties',
    );
    expect(uncSuggestion!.reason).toContain('partial');
  });

  it('does not suggest listUncertainties when no partiality', () => {
    const handle = mkOverviewHandle([]);

    const result = getRepositoryOverview(handle, 'repo-1');
    const ops = suggestedOps(result);

    expect(ops).not.toContain('viewer.listUncertainties');
    expect(ops).toContain('viewer.findEntrypoints');
    expect(ops).toContain('viewer.listClaims');
  });
});

// ---------------------------------------------------------------------------
// listUncertainties: dynamic suggestions
// ---------------------------------------------------------------------------

describe('listUncertainties: dynamic suggestions', () => {
  function mkUncHandle(claimCount: number): ListUncertaintiesReadHandle {
    const claims: ClaimReadRow[] = [];
    for (let i = 0; i < claimCount; i++) {
      claims.push(
        mkClaim({
          id: `claim-${i}`,
          confidenceBand: 'low',
          statement: `Low-confidence claim ${i}`,
        }),
      );
    }
    return {
      getNode: vi.fn().mockReturnValue(null),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
      allClaimIds: vi.fn().mockReturnValue(claims.map((c) => c.id)),
      getClaimRecord: vi.fn().mockImplementation((id: string) =>
        claims.find((c) => c.id === id) ?? null,
      ),
    };
  }

  it('suggests checkInvariants when many uncertainties (>10)', () => {
    const handle = mkUncHandle(15);

    const result = listUncertainties(handle);
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.checkInvariants');
    const invSuggestion = result.suggestedNextCalls.find(
      (c) => c.op === 'viewer.checkInvariants',
    );
    expect(invSuggestion!.reason).toContain('uncertainties');
  });

  it('does not suggest checkInvariants when few uncertainties', () => {
    const handle = mkUncHandle(3);

    const result = listUncertainties(handle);
    const ops = suggestedOps(result);

    expect(ops).not.toContain('viewer.checkInvariants');
    expect(ops).toContain('viewer.listClaims');
    expect(ops).toContain('viewer.getRepositoryOverview');
  });
});

// ---------------------------------------------------------------------------
// findEntrypoints: dynamic suggestions (pre-existing, verify still correct)
// ---------------------------------------------------------------------------

describe('findEntrypoints: dynamic suggestions', () => {
  it('suggests getRepositoryOverview when no candidates found', () => {
    const handle: EntrypointReadHandle = {
      getNode: vi.fn().mockReturnValue(null),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = findEntrypoints(handle, 'nonexistent-query');
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.getRepositoryOverview');
    expect(ops).not.toContain('viewer.traceFlow');
  });

  it('suggests traceFlow and estimateBlastRadius when candidates found', () => {
    const handle: EntrypointReadHandle = {
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'file-main') return { id: 'file-main', kind: 'file', display_name: 'main.ts' };
        return null;
      }),
      neighbors: vi.fn().mockReturnValue([]),
      ftsSearch: vi.fn().mockReturnValue([
        { objectId: 'file-main', objectType: 'node', text: 'main entrypoint', path: 'src/main.ts', rank: 1 },
      ]),
      getClaim: vi.fn().mockReturnValue(null),
      partiality: vi.fn().mockReturnValue([]),
    };

    const result = findEntrypoints(handle, 'main');
    const ops = suggestedOps(result);

    expect(ops).toContain('viewer.traceFlow');
    expect(ops).toContain('viewer.estimateBlastRadius');
    expect(ops).not.toContain('viewer.getRepositoryOverview');
  });
});
