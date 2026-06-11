/**
 * explainSubsystem operation.
 *
 * Returns owned files, dependency shape, tests, purpose hypotheses,
 * related claims and contradictions.
 */

import type { SubsystemReadHandle } from '../handles.js';
import type {
  ResultEnvelope,
  SubsystemExplanation,
  EvidenceRef,
  UncertaintyItem,
  ClaimSummaryRef,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';

export function explainSubsystem(
  handle: SubsystemReadHandle,
  subsystemId: string,
  opts?: { revision?: string },
): ResultEnvelope<SubsystemExplanation> {
  const revision = opts?.revision ?? 'latest';

  const subsystemNode = handle.getNode(subsystemId);
  if (!subsystemNode) {
    const empty: SubsystemExplanation = {
      subsystemId,
      ownedFiles: [],
      dependencies: { inbound: [], outbound: [] },
      tests: [],
      purposeHypotheses: [],
      relatedClaims: [],
      contradictions: [],
    };

    const envelope = buildEnvelope<SubsystemExplanation>({
      op: 'explainSubsystem',
      args: { subsystemId, revision },
      data: empty,
      modelRevision: revision,
      uncertainties: [{
        id: `uncertainty:missing-subsystem:${subsystemId}`,
        kind: 'low-confidence',
        severity: 'high',
        description: `Subsystem "${subsystemId}" not found in model`,
        relatedClaimIds: [],
        relatedNodeIds: [subsystemId],
        recommendedAction: 'Verify the subsystem ID or re-index',
      }],
      suggestedNextCalls: [
        { op: 'viewer.getRepositoryOverview', args: {}, reason: 'List available subsystems' },
      ],
    });
    assertStructured<SubsystemExplanation>(envelope);
    return envelope;
  }

  // Get owned files via containment
  const ownedFiles: string[] = [];
  const tests: string[] = [];
  const inbound: string[] = [];
  const outbound: string[] = [];
  const evidence: EvidenceRef[] = [];

  let containedNodes: Array<Record<string, unknown>> = [];
  if (handle.enumerateContainedNodes) {
    containedNodes = handle.enumerateContainedNodes(subsystemId);
  } else {
    const neighbors = handle.neighbors(subsystemId, 'owns', 3);
    for (const edge of neighbors) {
      const targetId = edge.toNodeId === subsystemId ? edge.fromNodeId : edge.toNodeId;
      const node = handle.getNode(targetId);
      if (node) containedNodes.push(node);
    }
  }

  for (const node of containedNodes) {
    const kind = node['kind'] as string | undefined;
    const path = (node['path'] as string) ?? (node['id'] as string) ?? '';
    const fileClass = node['file_class'] as string | undefined;

    if (kind === 'file') {
      ownedFiles.push(path);
      if (fileClass === 'test') {
        tests.push(path);
      }
    }
  }

  // Get dependency edges
  const outboundEdges = handle.neighbors(subsystemId, 'imports', 2);
  for (const edge of outboundEdges) {
    const targetId = edge.toNodeId === subsystemId ? edge.fromNodeId : edge.toNodeId;
    if (targetId !== subsystemId) {
      outbound.push(targetId);
    }
  }

  const dependsEdges = handle.neighbors(subsystemId, 'depends_on', 2);
  for (const edge of dependsEdges) {
    const targetId = edge.toNodeId === subsystemId ? edge.fromNodeId : edge.toNodeId;
    if (edge.toNodeId === subsystemId) {
      inbound.push(targetId);
    } else {
      outbound.push(targetId);
    }
  }

  // Gather related claims
  const relatedClaims: ClaimSummaryRef[] = [];
  const contradictions: ClaimSummaryRef[] = [];
  const purposeHypotheses: string[] = [];

  // Check claims related to this subsystem
  const claimCheck = handle.getClaim(subsystemId);
  if (claimCheck) {
    const ref: ClaimSummaryRef = {
      claimId: claimCheck.id,
      claimType: claimCheck.claimType,
      statement: claimCheck.statement,
    };
    if (claimCheck.status === 'contradicted') {
      contradictions.push(ref);
    } else {
      relatedClaims.push(ref);
    }
    if (claimCheck.claimType.includes('hypothesis') || claimCheck.status === 'hypothesis') {
      purposeHypotheses.push(claimCheck.statement);
    }
  }

  // If no purpose hypotheses found, note it structurally
  if (purposeHypotheses.length === 0) {
    purposeHypotheses.push('No purpose hypothesis available (structurally inferred subsystem)');
  }

  const data: SubsystemExplanation = {
    subsystemId,
    ownedFiles: ownedFiles.sort(),
    dependencies: {
      inbound: [...new Set(inbound)].sort(),
      outbound: [...new Set(outbound)].sort(),
    },
    tests: tests.sort(),
    purposeHypotheses,
    relatedClaims,
    contradictions,
  };

  const envelope = buildEnvelope<SubsystemExplanation>({
    op: 'explainSubsystem',
    args: { subsystemId, revision },
    data,
    evidence,
    modelRevision: revision,
    suggestedNextCalls: [
      {
        op: 'viewer.estimateBlastRadius',
        args: { changeScope: ownedFiles.slice(0, 5) },
        reason: 'Estimate blast radius for files in this subsystem',
      },
      {
        op: 'viewer.listClaims',
        args: { claimType: 'subsystem' },
        reason: 'List all subsystem-related claims',
      },
    ],
  });

  assertStructured<SubsystemExplanation>(envelope);
  return envelope;
}
