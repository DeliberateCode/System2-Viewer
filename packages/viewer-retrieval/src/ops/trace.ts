/**
 * traceFlow operation.
 *
 * Pre-resolved start node, traces stored edges toward target.
 * Ordered segments with edge kind, epistemic, evidence, confidence.
 * Undecidable/missing hops are EXPLICIT (unknown:true), never fabricated.
 */

import type { FlowReadHandle, NeighborEdge } from '../handles.js';
import type {
  ResultEnvelope,
  FlowTrace,
  EvidenceRef,
  UncertaintyItem,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';
import { runRetrievalPipeline } from '../pipeline.js';

export function traceFlow(
  handle: FlowReadHandle,
  start: string,
  targetOrIntent: string,
  opts?: { revision?: string; maxDepth?: number; prefer?: 'tests' | 'docs'; edgeKinds?: string[] },
): ResultEnvelope<FlowTrace> {
  const revision = opts?.revision ?? 'latest';
  const maxDepth = opts?.maxDepth ?? 10;

  const segments: FlowTrace['segments'] = [];
  const evidence: EvidenceRef[] = [];
  const uncertainties: UncertaintyItem[] = [];

  // Verify start node exists
  const startNode = handle.getNode(start);
  if (!startNode) {
    uncertainties.push({
      id: `uncertainty:missing-start:${start}`,
      kind: 'low-confidence',
      severity: 'high',
      description: `Start node "${start}" not found in model`,
      relatedClaimIds: [],
      relatedNodeIds: [start],
      recommendedAction: 'Resolve the reference before tracing',
    });

    const envelope = buildEnvelope<FlowTrace>({
      op: 'traceFlow',
      args: { start, targetOrIntent, revision, maxDepth },
      data: { segments: [] },
      evidence,
      uncertainties,
      modelRevision: revision,
      suggestedNextCalls: [
        { op: 'viewer.resolveReference', args: { input: start }, reason: 'Resolve the start reference' },
      ],
    });
    assertStructured<FlowTrace>(envelope);
    return envelope;
  }

  // Try to resolve target as a node id
  const targetNode = handle.getNode(targetOrIntent);
  const targetIsNode = targetNode !== null;

  // Use pipeline to find target if it's an intent string
  let targetNodeIds: string[] = [];
  if (targetIsNode) {
    targetNodeIds = [targetOrIntent];
  } else {
    const pipelineResult = runRetrievalPipeline(handle, {
      text: targetOrIntent,
      revision,
    });
    targetNodeIds = pipelineResult.anchors.slice(0, 5).map((a) => a.id);
  }

  const targetSet = new Set(targetNodeIds);

  // BFS from start toward target, bounded by maxDepth
  const visited = new Set<string>();
  const parentMap = new Map<string, { fromNodeId: string; edge: NeighborEdge }>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: start, depth: 0 }];
  visited.add(start);

  let foundTarget: string | null = null;
  let truncatedAtMaxDepth = false;
  const allowedEdgeKinds = opts?.edgeKinds ? new Set(opts.edgeKinds) : null;

  let head = 0;
  while (head < queue.length && !foundTarget) {
    const current = queue[head++]!;
    if (current.depth >= maxDepth) {
      truncatedAtMaxDepth = true;
      continue;
    }

    const neighbors = handle.neighbors(current.nodeId, undefined, 1);

    // Also check inbound edges if available
    let inboundEdges: NeighborEdge[] = [];
    if (handle.inboundEdges) {
      inboundEdges = handle.inboundEdges(current.nodeId);
    }

    let allEdges = [...neighbors, ...inboundEdges];

    if (allowedEdgeKinds) {
      allEdges = allEdges.filter((e) => allowedEdgeKinds.has(e.kind));
    }

    for (const edge of allEdges) {
      const nextId = edge.toNodeId === current.nodeId ? edge.fromNodeId : edge.toNodeId;

      if (visited.has(nextId)) continue;
      visited.add(nextId);

      parentMap.set(nextId, { fromNodeId: current.nodeId, edge });

      if (targetSet.has(nextId)) {
        foundTarget = nextId;
        break;
      }

      queue.push({ nodeId: nextId, depth: current.depth + 1 });
    }
  }

  // Reconstruct path if target found
  if (foundTarget) {
    const path: Array<{ fromNodeId: string; edge: NeighborEdge }> = [];
    let current = foundTarget;
    while (parentMap.has(current)) {
      const entry = parentMap.get(current)!;
      path.unshift(entry);
      current = entry.fromNodeId;
    }

    for (const step of path) {
      const edgeConfidence = step.edge.confidenceBand ?? 'medium';
      const edgeEpistemic = step.edge.epistemic ?? 'inferred';

      const segmentEvidence: EvidenceRef[] = [];
      // Try to get evidence for this edge
      const evidenceIdsJson = step.edge.evidenceIdsJson;
      if (evidenceIdsJson) {
        try {
          const ids = JSON.parse(evidenceIdsJson) as string[];
          for (const eid of ids) {
            segmentEvidence.push({
              evidenceId: eid,
              kind: 'source_span',
              path: null,
              revision,
              extractor: 'trace',
            });
          }
        } catch {
          // ignore parse errors
        }
      }

      segments.push({
        fromNodeId: step.fromNodeId,
        toNodeId: step.edge.toNodeId === step.fromNodeId
          ? step.edge.fromNodeId
          : step.edge.toNodeId,
        edgeKind: step.edge.kind,
        epistemic: edgeEpistemic,
        confidence: edgeConfidence,
        evidence: segmentEvidence,
        ...(step.edge.kind === 'event-flow' ? { declaredTag: '[declared]' } : {}),
      });

      evidence.push(...segmentEvidence);
    }
  } else {
    // Target not reachable: add explicit unknown hop
    segments.push({
      fromNodeId: start,
      toNodeId: targetOrIntent,
      edgeKind: 'unknown',
      epistemic: 'inferred',
      confidence: 'none',
      evidence: [],
      unknown: true,
      ambiguity: targetNodeIds.length > 1
        ? `Multiple potential targets found (${targetNodeIds.length})`
        : 'No path found to target',
    });

    uncertainties.push({
      id: `uncertainty:no-path:${start}:${targetOrIntent}`,
      kind: 'weak-edges',
      severity: 'medium',
      description: `No stored path from "${start}" to "${targetOrIntent}"`,
      relatedClaimIds: [],
      relatedNodeIds: [start, ...targetNodeIds],
      recommendedAction: 'Check that both endpoints exist and the index includes the connecting edges',
    });
  }

  const data: FlowTrace = { segments };

  // Build dynamic suggestions based on result
  const suggestions: Array<{ op: string; args: Record<string, unknown>; reason: string }> = [];

  if (!foundTarget) {
    suggestions.push(
      {
        op: 'viewer.findEntrypoints',
        args: { query: targetOrIntent },
        reason: 'No path found; search for entrypoints matching the target',
      },
      {
        op: 'viewer.estimateBlastRadius',
        args: { changeScope: [start] },
        reason: 'No path found; estimate blast radius from the start node instead',
      },
    );

    if (truncatedAtMaxDepth) {
      suggestions.push({
        op: 'viewer.traceFlow',
        args: { start, targetOrIntent, maxDepth: maxDepth * 2 },
        reason: `Trace was truncated at maxDepth=${maxDepth}; retry with higher depth`,
      });
    }
  } else {
    suggestions.push(
      {
        op: 'viewer.estimateBlastRadius',
        args: { changeScope: [start] },
        reason: 'Estimate impact of changes at the start node',
      },
      {
        op: 'viewer.explainSubsystem',
        args: { subsystemId: start },
        reason: 'Understand the subsystem containing the start node',
      },
    );
  }

  const envelope = buildEnvelope<FlowTrace>({
    op: 'traceFlow',
    args: { start, targetOrIntent, revision, maxDepth, prefer: opts?.prefer },
    data,
    evidence,
    uncertainties,
    modelRevision: revision,
    suggestedNextCalls: suggestions,
  });

  assertStructured<FlowTrace>(envelope);
  return envelope;
}
