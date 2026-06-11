import type {
  ConfidenceBand,
  FreshnessBand,
  EvidenceRef,
  EvidenceKind,
  ScoredState,
  ChangeSet,
} from './types.js';

const BANDS: readonly ConfidenceBand[] = ['none', 'low', 'medium', 'high'];
const FRESHNESS: readonly FreshnessBand[] = ['stale', 'aging', 'fresh'];

const BAND_ORDER: Record<ConfidenceBand, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const FRESHNESS_ORDER: Record<FreshnessBand, number> = {
  stale: 0,
  aging: 1,
  fresh: 2,
};

const EVIDENCE_RANK: Record<string, number> = {
  human_annotation: 8,
  test_result: 7,
  runtime_trace: 7,
  symbol_index_hit: 6,
  static_analysis_result: 5,
  tree_sitter_query: 4,
  grep_hit: 3,
  source_span: 3,
  git_commit: 2,
  embedding_similarity: 1,
  llm_derivation: 0,
};

function clampFreshness(index: number): FreshnessBand {
  const clamped = Math.max(0, Math.min(index, FRESHNESS.length - 1));
  return FRESHNESS[clamped]!;
}

function isNonLlm(kind: EvidenceKind): boolean {
  return kind !== 'llm_derivation';
}

/**
 * Returns the evidence-strength rank for a given evidence kind.
 * Unknown kinds receive rank 0.
 */
export function evidenceStrengthRank(kind: EvidenceKind): number {
  return EVIDENCE_RANK[kind] ?? 0;
}

/**
 * Returns the base confidence band from the strongest evidence kind in the set.
 * Rank >= 6 -> high, >= 4 -> medium, >= 2 -> low, else low.
 */
export function strongestBaseBand(evidence: EvidenceRef[]): ConfidenceBand {
  if (evidence.length === 0) return 'none';
  let maxRank = 0;
  for (const e of evidence) {
    const r = evidenceStrengthRank(e.kind);
    if (r > maxRank) maxRank = r;
  }
  if (maxRank >= 6) return 'high';
  if (maxRank >= 4) return 'medium';
  return 'low';
}

/**
 * Computes the confidence band from evidence, contradictions, and prior state.
 *
 * Pure, deterministic, order-independent, clock-free, random-free.
 */
export function computeConfidence(
  evidence: EvidenceRef[],
  contradictions: EvidenceRef[],
  priorState: ScoredState,
): ConfidenceBand {
  // 1. No supporting evidence -> none
  if (evidence.length === 0) return 'none';

  // 2. Base band from strongest evidence kind
  let bandIndex = BAND_ORDER[strongestBaseBand(evidence)];

  // Sort evidence for order-independence (by kind then id)
  const sorted = [...evidence].sort((a, b) => {
    const kc = a.kind.localeCompare(b.kind);
    if (kc !== 0) return kc;
    return a.evidenceId.localeCompare(b.evidenceId);
  });

  // Count non-LLM evidence and distinct non-LLM kinds
  let nonLlmCount = 0;
  const nonLlmKinds = new Set<string>();
  let hasHumanAnnotation = false;
  let allLlm = true;

  for (const e of sorted) {
    if (isNonLlm(e.kind)) {
      nonLlmCount++;
      nonLlmKinds.add(e.kind);
      allLlm = false;
    }
    if (e.kind === 'human_annotation') {
      hasHumanAnnotation = true;
    }
  }

  // 3. Quantity boost: >= 2 independent non-LLM evidence -> +1
  if (nonLlmCount >= 2) bandIndex++;

  // 4. Diversity boost: >= 2 distinct non-LLM kinds -> +1
  if (nonLlmKinds.size >= 2) bandIndex++;

  // 5. Human-confirmation boost: any human_annotation -> +1
  if (hasHumanAnnotation) bandIndex++;

  // 6. Clamp to max before penalties
  bandIndex = Math.min(bandIndex, BANDS.length - 1);

  // 7. Contradiction penalty: any contradictions -> -2
  if (contradictions.length > 0) bandIndex -= 2;

  // 8. Freshness penalty: stale -> -2, aging -> -1
  if (priorState.freshness === 'stale') bandIndex -= 2;
  else if (priorState.freshness === 'aging') bandIndex -= 1;

  // 9. Clamp to valid range
  bandIndex = Math.max(0, Math.min(bandIndex, BANDS.length - 1));

  // 10. LLM-only ceiling: if ALL supporting evidence is llm_derivation, clamp to medium
  if (allLlm) {
    const mediumIndex = BAND_ORDER['medium'];
    bandIndex = Math.min(bandIndex, mediumIndex);
  }

  // 11. Return final band
  return BANDS[bandIndex]!;
}

/**
 * Computes the freshness band from a scoped change and last evidence revision.
 *
 * Pure, deterministic.
 */
export function computeFreshness(
  scopedChange: ChangeSet,
  lastEvidenceRevision: string,
): FreshnessBand {
  // No scope touch or same revision evidence -> unchanged
  if (
    !scopedChange.touchesScope ||
    lastEvidenceRevision === scopedChange.changeRevision
  ) {
    return scopedChange.priorFreshness;
  }

  // Lower by one ordinal step, floored at stale
  const currentIndex = FRESHNESS_ORDER[scopedChange.priorFreshness];
  return clampFreshness(currentIndex - 1);
}
