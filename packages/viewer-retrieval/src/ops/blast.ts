/**
 * estimateBlastRadius operation.
 *
 * RECALL-PRIORITIZED: every reachable node through any dependency edge is INCLUDED.
 * Uncertain edges (inferred/low-band) recorded in riskyEdges,
 * affected nodes flagged viaUncertainEdge.
 */

import type { BlastReadHandle, NeighborEdge } from '../handles.js';
import type {
  ResultEnvelope,
  BlastRadiusReport,
  EvidenceRef,
  UncertaintyItem,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';

const DEFAULT_BLAST_DEPTH = 5;

export function estimateBlastRadius(
  handle: BlastReadHandle,
  changeScope: string[],
  opts?: { revision?: string; maxDepth?: number },
): ResultEnvelope<BlastRadiusReport> {
  const revision = opts?.revision ?? 'latest';
  const maxDepth = opts?.maxDepth ?? DEFAULT_BLAST_DEPTH;

  const affectedNodes: BlastRadiusReport['affectedNodes'] = [];
  const riskyEdges: BlastRadiusReport['riskyEdges'] = [];
  const evidence: EvidenceRef[] = [];
  const uncertainties: UncertaintyItem[] = [];

  // Track visited nodes and whether they were reached via uncertain edge
  const visited = new Map<string, { distance: number; viaUncertainEdge: boolean }>();
  const riskyEdgeIds = new Set<string>();

  // Seed with change scope nodes at distance 0
  const queue: Array<{ nodeId: string; distance: number; viaUncertain: boolean }> = [];

  for (const scopeId of changeScope) {
    const node = handle.getNode(scopeId);
    if (!node) {
      uncertainties.push({
        id: `uncertainty:missing-scope:${scopeId}`,
        kind: 'low-confidence',
        severity: 'medium',
        description: `Scope node "${scopeId}" not found in model`,
        relatedClaimIds: [],
        relatedNodeIds: [scopeId],
        recommendedAction: 'Verify the node ID or re-index',
      });
      continue;
    }
    visited.set(scopeId, { distance: 0, viaUncertainEdge: false });
    queue.push({ nodeId: scopeId, distance: 0, viaUncertain: false });
  }

  // BFS: RECALL-PRIORITIZED -- never drop a potentially-affected node
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    if (current.distance >= maxDepth) continue;

    const neighbors = handle.neighbors(current.nodeId, undefined, 1);

    for (const edge of neighbors) {
      const targetId = edge.toNodeId === current.nodeId
        ? edge.fromNodeId
        : edge.toNodeId;

      // Determine if this edge is uncertain
      const confidence = edge.confidenceBand ?? 'medium';
      const epistemic = edge.epistemic ?? 'inferred';
      const isUncertain = confidence === 'low' || confidence === 'none' || epistemic === 'inferred';

      const viaUncertain = current.viaUncertain || isUncertain;

      // Record risky edges
      if (isUncertain && !riskyEdgeIds.has(edge.id)) {
        riskyEdgeIds.add(edge.id);
        riskyEdges.push({
          edgeId: edge.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          confidence,
          epistemic,
        });
      }

      const existing = visited.get(targetId);
      if (existing) {
        // Already visited: update if this path is shorter or newly uncertain
        if (current.distance + 1 < existing.distance) {
          visited.set(targetId, {
            distance: current.distance + 1,
            viaUncertainEdge: viaUncertain,
          });
        } else if (viaUncertain && !existing.viaUncertainEdge) {
          visited.set(targetId, {
            distance: existing.distance,
            viaUncertainEdge: true,
          });
        }
        continue;
      }

      visited.set(targetId, {
        distance: current.distance + 1,
        viaUncertainEdge: viaUncertain,
      });

      queue.push({
        nodeId: targetId,
        distance: current.distance + 1,
        viaUncertain,
      });
    }
  }

  // Build affected nodes list (exclude seed nodes at distance 0)
  for (const [nodeId, info] of visited) {
    affectedNodes.push({
      nodeId,
      distance: info.distance,
      viaUncertainEdge: info.viaUncertainEdge,
    });
  }

  // Sort by distance ascending, then by node id for deterministic output
  affectedNodes.sort((a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId));

  if (riskyEdges.length > 0) {
    uncertainties.push({
      id: 'uncertainty:risky-edges',
      kind: 'weak-edges',
      severity: 'medium',
      description: `${riskyEdges.length} uncertain edge(s) in blast radius -- affected nodes may not actually be impacted`,
      relatedClaimIds: [],
      relatedNodeIds: riskyEdges.map((e) => e.toNodeId),
      recommendedAction: 'Verify uncertain edges before treating affected nodes as definite',
    });
  }

  const data: BlastRadiusReport = { affectedNodes, riskyEdges };

  // Count affected nodes beyond seed nodes (distance > 0)
  const nonSeedAffected = affectedNodes.filter((n) => n.distance > 0);

  // Build dynamic suggestions based on result
  const suggestions: Array<{ op: string; args: Record<string, unknown>; reason: string }> = [];

  if (nonSeedAffected.length === 0) {
    suggestions.push({
      op: 'viewer.resolveReference',
      args: { input: changeScope[0] ?? '' },
      reason: 'No affected nodes found; verify the change scope resolves correctly',
    });
  } else if (nonSeedAffected.length > 20) {
    suggestions.push({
      op: 'viewer.traceFlow',
      args: { start: changeScope[0] ?? '', targetOrIntent: 'downstream' },
      reason: `${nonSeedAffected.length} affected nodes found; trace specific flow paths for targeted analysis`,
    });
  } else {
    suggestions.push(
      {
        op: 'viewer.listUncertainties',
        args: {},
        reason: 'Review uncertainties that may affect blast radius accuracy',
      },
      {
        op: 'viewer.traceFlow',
        args: { start: changeScope[0] ?? '', targetOrIntent: 'downstream' },
        reason: 'Trace specific flow paths from the change scope',
      },
    );
  }

  const envelope = buildEnvelope<BlastRadiusReport>({
    op: 'estimateBlastRadius',
    args: { changeScope, revision, maxDepth },
    data,
    evidence,
    uncertainties,
    modelRevision: revision,
    suggestedNextCalls: suggestions,
  });

  assertStructured<BlastRadiusReport>(envelope);
  return envelope;
}
