/**
 * listClaims operation.
 *
 * Surfaced claims by default (surfaced=1), filter by type/status.
 * includeLowValue option returns full pre-policy set.
 */

import type { ListClaimsReadHandle, ClaimReadRow } from '../handles.js';
import type {
  ResultEnvelope,
  ClaimSummary,
  EvidenceRef,
  UncertaintyItem,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';

export function listClaims(
  handle: ListClaimsReadHandle,
  opts?: {
    claimType?: string;
    status?: string;
    includeLowValue?: boolean;
    publicApiOnly?: boolean;
  },
): ResultEnvelope<ClaimSummary[]> {
  const revision = 'latest';
  const claims: ClaimSummary[] = [];
  const evidence: EvidenceRef[] = [];
  const uncertainties: UncertaintyItem[] = [];

  // Gather claim records via widened accessor or fallback
  let allClaims: ClaimReadRow[] = [];

  if (handle.allClaimIds && handle.getClaimRecord) {
    const ids = handle.allClaimIds();
    for (const id of ids) {
      const claim = handle.getClaimRecord(id);
      if (claim) allClaims.push(claim);
    }
  } else {
    // Fallback: use pipeline to discover claims by ID patterns
    // This is a degraded path when widened accessors aren't bound
    const pipelineResult = handle.ftsSearch('"claim"');
    for (const hit of pipelineResult) {
      if (hit.objectType === 'claim') {
        const claim = handle.getClaim(hit.objectId);
        if (claim) allClaims.push(claim);
      }
    }
  }

  // Filter claims
  for (const claim of allClaims) {
    // Default: only surfaced claims (validToRevision is null = current)
    if (claim.validToRevision !== null) continue;

    // Type filter
    if (opts?.claimType && claim.claimType !== opts.claimType) continue;

    // Status filter
    if (opts?.status && claim.status !== opts.status) continue;

    // Surfacing gate: unless includeLowValue, skip low-confidence/unsurfaced
    if (!opts?.includeLowValue) {
      const isSurfaced = claim.confidenceBand !== 'none' && claim.confidenceBand !== 'low';
      if (!isSurfaced) continue;
    }

    // Public API filter
    if (opts?.publicApiOnly) {
      try {
        const scope = JSON.parse(claim.scopeJson) as Record<string, unknown>;
        if (!scope['exported']) continue;
      } catch {
        continue;
      }
    }

    claims.push({
      id: claim.id,
      claimType: claim.claimType,
      statement: claim.statement,
      status: claim.status,
      confidence: claim.confidenceBand,
      freshness: claim.freshnessBand,
    });
  }

  // Sort by confidence descending, then by id for determinism
  const confidenceOrder: Record<string, number> = {
    high: 3,
    medium: 2,
    low: 1,
    none: 0,
  };
  claims.sort((a, b) => {
    const aConf = confidenceOrder[a.confidence] ?? 0;
    const bConf = confidenceOrder[b.confidence] ?? 0;
    if (aConf !== bConf) return bConf - aConf;
    return a.id.localeCompare(b.id);
  });

  const data = claims;

  const envelope = buildEnvelope<ClaimSummary[]>({
    op: 'listClaims',
    args: {
      claimType: opts?.claimType,
      status: opts?.status,
      includeLowValue: opts?.includeLowValue,
      publicApiOnly: opts?.publicApiOnly,
    },
    data,
    evidence,
    uncertainties,
    modelRevision: revision,
    suggestedNextCalls: claims.length > 0
      ? [
          {
            op: 'viewer.listUncertainties',
            args: {},
            reason: 'Review claims below the surfacing threshold',
          },
          {
            op: 'viewer.verifyClaim',
            args: { claimId: claims[0].id },
            reason: 'Verify the top-confidence claim',
          },
        ]
      : [
          {
            op: 'viewer.getRepositoryOverview',
            args: {},
            reason: 'No claims found; check the repository overview',
          },
        ],
  });

  assertStructured<ClaimSummary[]>(envelope);
  return envelope;
}
