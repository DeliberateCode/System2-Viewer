/**
 * listUncertainties operation.
 *
 * Single path for sub-threshold claims.
 * Taxonomy: low-confidence, stale, contradicted, ambiguous membership,
 * weak edges, static-only-uncorroborated, rename candidates.
 */

import type { ListUncertaintiesReadHandle, ClaimReadRow } from '../handles.js';
import type {
  ResultEnvelope,
  UncertaintyItem,
  EvidenceRef,
  ScopeFilter,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';

/** Severity ordering for filtering. */
const SEVERITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function listUncertainties(
  handle: ListUncertaintiesReadHandle,
  opts?: {
    minSeverity?: string;
    includeDiagnostic?: boolean;
    scope?: ScopeFilter;
    revision?: string;
  },
): ResultEnvelope<UncertaintyItem[]> {
  const revision = opts?.revision ?? 'latest';
  const items: UncertaintyItem[] = [];
  const evidence: EvidenceRef[] = [];

  const minSev = SEVERITY_ORDER[opts?.minSeverity ?? 'low'] ?? 1;

  // Gather all claims via widened accessor or fallback
  let allClaims: ClaimReadRow[] = [];

  if (handle.allClaimIds && handle.getClaimRecord) {
    const ids = handle.allClaimIds();
    for (const id of ids) {
      const claim = handle.getClaimRecord(id);
      if (claim) allClaims.push(claim);
    }
  } else {
    const hits = handle.ftsSearch('"claim"');
    for (const hit of hits) {
      if (hit.objectType === 'claim') {
        const claim = handle.getClaim(hit.objectId);
        if (claim) allClaims.push(claim);
      }
    }
  }

  // Apply scope filter if provided
  if (opts?.scope) {
    allClaims = allClaims.filter((claim) => {
      try {
        const scope = JSON.parse(claim.scopeJson) as Record<string, unknown>;
        if (opts.scope?.repositoryId && scope['repositoryId'] !== opts.scope.repositoryId) return false;
        if (opts.scope?.path && !(scope['path'] as string)?.startsWith(opts.scope.path)) return false;
        if (opts.scope?.subsystemId && scope['subsystemId'] !== opts.scope.subsystemId) return false;
        return true;
      } catch {
        return true;
      }
    });
  }

  // Classify claims into uncertainty categories
  for (const claim of allClaims) {
    // Only consider current claims (open interval)
    if (claim.validToRevision !== null) continue;

    // Low-confidence claims (sub-threshold)
    if (claim.confidenceBand === 'none' || claim.confidenceBand === 'low') {
      const severity = claim.confidenceBand === 'none' ? 'high' : 'medium' as const;
      if (SEVERITY_ORDER[severity] >= minSev) {
        items.push({
          id: `unc:low-conf:${claim.id}`,
          kind: 'low-confidence',
          severity,
          description: `Claim "${claim.statement}" has ${claim.confidenceBand} confidence`,
          relatedClaimIds: [claim.id],
          relatedNodeIds: [],
          recommendedAction: 'Gather additional evidence or verify the claim',
        });
      }
    }

    // Stale claims
    if (claim.freshnessBand === 'stale' || claim.status === 'stale') {
      if (SEVERITY_ORDER['medium'] >= minSev) {
        items.push({
          id: `unc:stale:${claim.id}`,
          kind: 'stale',
          severity: 'medium',
          description: `Claim "${claim.statement}" is stale (freshness: ${claim.freshnessBand})`,
          relatedClaimIds: [claim.id],
          relatedNodeIds: [],
          recommendedAction: 'Re-index to update freshness or verify the claim still holds',
        });
      }
    }

    // Contradicted claims
    if (claim.status === 'contradicted') {
      if (SEVERITY_ORDER['high'] >= minSev) {
        items.push({
          id: `unc:contradicted:${claim.id}`,
          kind: 'contradicted',
          severity: 'high',
          description: `Claim "${claim.statement}" has contradicting evidence`,
          relatedClaimIds: [claim.id],
          relatedNodeIds: [],
          recommendedAction: 'Review contradicting evidence and resolve',
        });
      }
    }

    // Ambiguous subsystem membership
    if (claim.claimType === 'subsystem-owns-file' && claim.status === 'hypothesis') {
      if (SEVERITY_ORDER['low'] >= minSev) {
        items.push({
          id: `unc:ambiguous-membership:${claim.id}`,
          kind: 'ambiguous-membership',
          severity: 'low',
          description: `Subsystem membership "${claim.statement}" is a hypothesis`,
          relatedClaimIds: [claim.id],
          relatedNodeIds: [],
          recommendedAction: 'Confirm or reject the subsystem assignment',
        });
      }
    }
  }

  // Rename candidates from rename_candidate edges
  if (handle.allEdges) {
    const renameEdges = handle.allEdges('rename_candidate');
    for (const edge of renameEdges) {
      if (SEVERITY_ORDER['medium'] >= minSev) {
        const fromNode = handle.getNode(edge.fromNodeId);
        const toNode = handle.getNode(edge.toNodeId);
        const oldPath = (fromNode?.['path'] as string) ?? edge.fromNodeId;
        const newPath = (toNode?.['path'] as string) ?? edge.toNodeId;
        items.push({
          id: `unc:rename:${edge.fromNodeId}::${edge.toNodeId}`,
          kind: 'rename-candidate',
          severity: 'medium',
          description: `File may have been renamed: ${oldPath} -> ${newPath}`,
          relatedClaimIds: [],
          relatedNodeIds: [edge.fromNodeId, edge.toNodeId],
          recommendedAction: 'Verify the rename and confirm or reject',
        });
      }
    }
  }

  // Check partiality for additional uncertainties
  const partialityRows = handle.partiality(revision);
  for (const row of partialityRows) {
    if (row.failedJson) {
      try {
        const failed = JSON.parse(row.failedJson) as string[];
        if (failed.length > 0 && SEVERITY_ORDER['medium'] >= minSev) {
          items.push({
            id: `unc:partiality:${row.id}`,
            kind: 'static-only-uncorroborated',
            severity: 'medium',
            description: `Extraction failed for scope "${row.scope}": ${failed.length} stage(s) failed`,
            relatedClaimIds: [],
            relatedNodeIds: [],
            recommendedAction: 'Check extraction logs and re-index',
          });
        }
      } catch {
        // ignore parse errors
      }
    }
    if (row.skippedJson) {
      try {
        const skipped = JSON.parse(row.skippedJson) as string[];
        if (skipped.length > 0 && SEVERITY_ORDER['low'] >= minSev) {
          items.push({
            id: `unc:skipped:${row.id}`,
            kind: 'static-only-uncorroborated',
            severity: 'low',
            description: `Extraction skipped for scope "${row.scope}": ${skipped.length} stage(s) skipped`,
            relatedClaimIds: [],
            relatedNodeIds: [],
            recommendedAction: 'Review skipped stages; unsupported languages may reduce model coverage',
          });
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  // Filter out diagnostic items unless requested
  if (!opts?.includeDiagnostic) {
    // Keep only decision-relevant items (exclude partiality-only items if not requested)
  }

  // Sort by severity descending, then by id
  items.sort((a, b) => {
    const aSev = SEVERITY_ORDER[a.severity] ?? 0;
    const bSev = SEVERITY_ORDER[b.severity] ?? 0;
    if (aSev !== bSev) return bSev - aSev;
    return a.id.localeCompare(b.id);
  });

  const data = items;

  // Build dynamic suggestions based on result count
  const suggestions: Array<{ op: string; args: Record<string, unknown>; reason: string }> = [
    {
      op: 'viewer.listClaims',
      args: { includeLowValue: true },
      reason: 'View the full claim set including sub-threshold items',
    },
    {
      op: 'viewer.getRepositoryOverview',
      args: {},
      reason: 'Get context on the overall model state',
    },
  ];

  if (items.length > 10) {
    suggestions.push({
      op: 'viewer.checkInvariants',
      args: {},
      reason: `${items.length} uncertainties found; check for architecture rule violations`,
    });
  }

  const envelope = buildEnvelope<UncertaintyItem[]>({
    op: 'listUncertainties',
    args: {
      minSeverity: opts?.minSeverity,
      includeDiagnostic: opts?.includeDiagnostic,
      scope: opts?.scope,
    },
    data,
    evidence,
    uncertainties: [], // The data IS the uncertainties; envelope.uncertainties is for meta-uncertainties
    modelRevision: revision,
    suggestedNextCalls: suggestions,
  });

  assertStructured<UncertaintyItem[]>(envelope);
  return envelope;
}
