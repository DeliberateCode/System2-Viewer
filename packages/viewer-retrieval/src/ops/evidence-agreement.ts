/**
 * sampleEvidenceAgreement utility.
 *
 * Samples claims and checks whether their supporting evidence
 * still agrees with the claim statement. Returns an audit report
 * with agreement rate and individual samples.
 */

import type { EvidenceAgreementReadHandle } from '../handles.js';
import type {
  EvidenceAgreementAudit,
  EvidenceAgreementSample,
} from '../types.js';

export function sampleEvidenceAgreement(
  handle: EvidenceAgreementReadHandle,
  sampleSize: number,
): EvidenceAgreementAudit {
  const samples: EvidenceAgreementSample[] = [];

  // Gather claim IDs via widened accessor or fallback
  let claimIds: string[] = [];

  if (handle.allClaimIds) {
    claimIds = handle.allClaimIds();
  } else {
    // Fallback: use FTS to discover claim objects
    const hits = handle.ftsSearch('"claim"');
    claimIds = hits
      .filter((h) => h.objectType === 'claim')
      .map((h) => h.objectId);
  }

  // Deterministic sampling: take every N-th claim for reproducibility
  const step = Math.max(1, Math.floor(claimIds.length / sampleSize));
  const sampledIds: string[] = [];
  for (let i = 0; i < claimIds.length && sampledIds.length < sampleSize; i += step) {
    sampledIds.push(claimIds[i]);
  }

  let agreements = 0;

  for (const claimId of sampledIds) {
    const claim = handle.getClaimRecord
      ? handle.getClaimRecord(claimId)
      : handle.getClaim(claimId);

    if (!claim) continue;

    // Check each supporting evidence ID
    for (const evidenceId of claim.supportingEvidenceIds) {
      // Evidence "agrees" if the claim is not contradicted or stale
      const agrees = claim.status !== 'contradicted' && claim.status !== 'stale';
      const reason = agrees
        ? `Claim status is "${claim.status}" with ${claim.confidenceBand} confidence`
        : `Claim status is "${claim.status}" -- evidence may no longer support claim`;

      samples.push({
        claimId,
        evidenceId,
        agrees,
        reason,
      });

      if (agrees) agreements++;

      // Limit samples per claim to avoid skew
      break;
    }

    // If no supporting evidence, still record the claim
    if (claim.supportingEvidenceIds.length === 0) {
      samples.push({
        claimId,
        evidenceId: '',
        agrees: false,
        reason: 'No supporting evidence found for claim',
      });
    }
  }

  const totalSamples = samples.length;
  const agreementRate = totalSamples > 0 ? agreements / totalSamples : 0;

  return {
    sampleSize: totalSamples,
    agreementRate,
    samples,
  };
}
