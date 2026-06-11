/**
 * On-demand claim generation.
 *
 * Generates claims that are not eagerly produced during indexing but
 * are created on demand when specific queries need them.
 */

import { randomUUID } from 'node:crypto';
import type {
  OnDemandReadHandle,
  OnDemandWriteTxn,
  OnDemandQuery,
  OnDemandClaimsResult,
} from './types.js';

/**
 * Claim types that are NOT eagerly generated during indexing.
 * These are produced on-demand when a query requests them.
 */
export const NON_EAGER_CLAIM_TYPES: readonly string[] = [
  'blast-radius-impact',
  'trace-flow-segment',
  'on-demand-subsystem-hypothesis',
] as const;

/**
 * Generates on-demand claims for the specified nodes and revision.
 * These claims are created lazily, not during indexing.
 */
export function generateOnDemandClaims(
  handle: OnDemandReadHandle,
  query: OnDemandQuery,
): OnDemandClaimsResult {
  const claims: OnDemandClaimsResult['claims'] = [];

  const allowedTypes = query.claimTypes ?? [...NON_EAGER_CLAIM_TYPES];

  for (const nodeId of query.nodeIds) {
    const node = handle.getNode(nodeId);
    if (!node) continue;

    for (const claimType of allowedTypes) {
      if (!NON_EAGER_CLAIM_TYPES.includes(claimType)) continue;

      const existingClaim = handle.getClaim?.(
        `claim-${claimType}-${nodeId}`,
      );
      if (existingClaim) continue;

      claims.push({
        id: `claim-${claimType}-${nodeId}-${query.revision}`,
        claimType,
        statement: `On-demand ${claimType} for ${(node['displayName'] as string) ?? nodeId}`,
        status: 'hypothesis',
        confidence: 'low',
        freshness: 'fresh',
        evidence: [],
        verificationRecipes: [],
      });
    }
  }

  return {
    claims,
    generated: claims.length,
  };
}

/**
 * Persists on-demand claims into the model via a write transaction.
 */
export function persistOnDemandClaims(
  result: OnDemandClaimsResult,
  txn: OnDemandWriteTxn,
): void {
  const now = new Date().toISOString();

  for (const claim of result.claims) {
    txn.versionClaim({
      id: claim.id,
      claimType: claim.claimType,
      statement: claim.statement,
      status: claim.status,
      repositoryId: '',
      scopeJson: '{}',
      confidenceBand: claim.confidence,
      freshnessBand: claim.freshness,
      supportingEvidenceIdsJson: JSON.stringify(
        claim.evidence.map((e) => e.evidenceId),
      ),
      contradictingEvidenceIdsJson: null,
      verificationRecipesJson: JSON.stringify(claim.verificationRecipes),
      derivationMethod: 'on-demand',
      generationId: `gen-ondemand-${randomUUID()}`,
      surfaced: 0,
      validFromRevision: 'latest',
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}
