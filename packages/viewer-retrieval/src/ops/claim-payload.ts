/**
 * buildClaimPayload utility.
 *
 * Builds a full ClaimPayload for a single claim by its ID.
 * Returns null if the claim is not found.
 */

import type { ClaimPayloadReadHandle } from '../handles.js';
import type { ClaimPayload, EvidenceRef } from '../types.js';

export function buildClaimPayload(
  handle: ClaimPayloadReadHandle,
  claimId: string,
): ClaimPayload | null {
  // Try widened accessor first, fall back to getClaim
  const claim = handle.getClaimRecord
    ? handle.getClaimRecord(claimId)
    : handle.getClaim(claimId);

  if (!claim) return null;

  // Build supporting evidence refs
  const supportingEvidence: EvidenceRef[] = [];
  for (const evidenceId of claim.supportingEvidenceIds) {
    supportingEvidence.push({
      evidenceId,
      kind: 'source_span',
      path: null,
      revision: claim.validFromRevision,
      extractor: 'claim-payload',
    });
  }

  // Build contradicting evidence refs (stored in the claim's scope or separate field)
  const contradictingEvidence: EvidenceRef[] = [];

  // Parse verification recipes from claim scope
  let verificationRecipes: Array<{ recipeType: string; description: string }> = [];
  try {
    const scope = JSON.parse(claim.scopeJson) as Record<string, unknown>;
    const recipes = scope['verificationRecipes'];
    if (Array.isArray(recipes)) {
      verificationRecipes = recipes.map((r: unknown) => {
        const recipe = r as Record<string, unknown>;
        return {
          recipeType: (recipe['recipeType'] as string) ?? 'unknown',
          description: (recipe['description'] as string) ?? '',
        };
      });
    }
  } catch {
    // no recipes available
  }

  return {
    id: claim.id,
    claimType: claim.claimType,
    statement: claim.statement,
    status: claim.status,
    confidence: claim.confidenceBand,
    freshness: claim.freshnessBand,
    supportingEvidence,
    contradictingEvidence,
    verificationRecipes,
  };
}
