import type {
  Claim,
  ClaimCategory,
  ClaimStatus,
  ConfidenceBand,
  EvidenceRef,
  Importance,
} from './types.js';

const BAND_ORDER: Record<ConfidenceBand, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const IMPORTANCE_ORDER: Record<Importance, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * TH-07 surfacing cutoff: tunable thresholds for claim surfacing.
 * Hard invariant (non-tunable) is checked separately in isSurfaceable.
 */
export const TH_07_SURFACING_CUTOFF: {
  minConfidenceBand: ConfidenceBand;
  requiresNonLlmEvidence: boolean;
} = {
  minConfidenceBand: 'medium',
  requiresNonLlmEvidence: true,
};

function hasNonLlmEvidence(evidence: EvidenceRef[]): boolean {
  return evidence.some((e) => e.kind !== 'llm_derivation');
}

/**
 * Derives the next claim status from current state, evidence, and contradictions.
 *
 * 1. Any contradicting evidence -> 'contradicted'
 * 2. If current status is 'rejected', stay 'rejected'
 * 3. If any human_annotation OR any independent non-LLM evidence -> 'confirmed'
 * 4. Otherwise -> 'hypothesis'
 */
export function nextClaimStatus(
  claim: Claim,
  evidence: EvidenceRef[],
  contradictions: EvidenceRef[],
): ClaimStatus {
  // 1. Any contradicting evidence -> contradicted
  if (contradictions.length > 0) return 'contradicted';

  // 2. Rejected stays rejected
  if (claim.status === 'rejected') return 'rejected';

  // 3. Human annotation or independent non-LLM evidence -> confirmed
  const hasHuman = evidence.some((e) => e.kind === 'human_annotation');
  const hasNonLlm = hasNonLlmEvidence(evidence);

  if (hasHuman || hasNonLlm) return 'confirmed';

  // 4. Otherwise hypothesis
  return 'hypothesis';
}

/**
 * Determines whether a claim passes the surfacing gate.
 *
 * Hard invariant (non-tunable):
 *   - >= 1 supporting evidence
 *   - >= 1 MVP verification recipe
 *
 * TH-07 cutoff (tunable):
 *   - >= 1 non-LLM supporting evidence
 *   - confidence >= cutoff band
 */
export function isSurfaceable(claim: Claim): boolean {
  // Hard invariant: must have at least 1 supporting evidence
  if (claim.supportingEvidence.length === 0) return false;

  // Hard invariant: must have at least 1 verification recipe
  if (claim.verificationRecipeCount < 1) return false;

  // TH-07: requires non-LLM evidence
  if (
    TH_07_SURFACING_CUTOFF.requiresNonLlmEvidence &&
    !hasNonLlmEvidence(claim.supportingEvidence)
  ) {
    return false;
  }

  // TH-07: confidence must be at or above the cutoff
  const minBand = BAND_ORDER[TH_07_SURFACING_CUTOFF.minConfidenceBand];
  const claimBand = BAND_ORDER[claim.confidence];
  if (claimBand < minBand) return false;

  return true;
}

/**
 * Classifies a claim into a surfacing category and importance level.
 */
export function claimSurfacingClass(
  claim: Claim,
): { category: ClaimCategory; importance: Importance } {
  const ct = claim.claimType ?? '';
  const exported = claim.scope?.['exported'] === true;

  if (ct === 'file-defines-symbol' || ct === 'file-defines-symbols') {
    if (exported) {
      return { category: 'exported-symbol', importance: 'high' };
    }
    return { category: 'local-symbol', importance: 'low' };
  }

  if (ct === 'likely-entrypoint') {
    return { category: 'entrypoint', importance: 'high' };
  }

  if (ct === 'package-imports-package') {
    return { category: 'import', importance: 'medium' };
  }

  if (
    ct === 'directory-derived-subsystem-hypothesis' ||
    ct === 'subsystem-owns-file'
  ) {
    return { category: 'subsystem', importance: 'medium' };
  }

  if (ct === 'forbidden-import-violation') {
    return { category: 'invariant', importance: 'high' };
  }

  return { category: 'other', importance: 'low' };
}

/**
 * Returns true if importance level `a` is at least as high as `min`.
 */
export function importanceAtLeast(a: Importance, min: Importance): boolean {
  return IMPORTANCE_ORDER[a] >= IMPORTANCE_ORDER[min];
}
