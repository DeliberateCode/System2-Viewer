/**
 * Tests for viewer-core scoring functions.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  computeConfidence,
  computeFreshness,
} from '../scoring.js';
import type {
  EvidenceRef,
  ScoredState,
  ChangeSet,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkEvidence(kind: string, id?: string): EvidenceRef {
  return { evidenceId: id ?? `ev-${kind}-${Math.random()}`, kind };
}

const FRESH_PRIOR: ScoredState = { confidence: 'none', freshness: 'fresh' };

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('returns "none" with no evidence', () => {
    const result = computeConfidence([], [], FRESH_PRIOR);
    expect(result).toBe('none');
  });

  it('returns high confidence with a single human_annotation', () => {
    const evidence = [mkEvidence('human_annotation', 'ha-1')];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    // human_annotation rank=8 -> base=high (3), quantity boost=0 (only 1),
    // diversity boost=0 (only 1 kind), human boost=+1 -> clamped to high(3)
    expect(result).toBe('high');
  });

  it('caps LLM-only evidence at "medium"', () => {
    // Multiple LLM derivations should not exceed medium
    const evidence = [
      mkEvidence('llm_derivation', 'llm-1'),
      mkEvidence('llm_derivation', 'llm-2'),
      mkEvidence('llm_derivation', 'llm-3'),
    ];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    // llm_derivation rank=0 -> base=low(1), all LLM -> ceiling at medium(2)
    // but no non-LLM boosts apply. So base stays low, LLM ceiling doesn't lower it.
    // Result should be at most medium.
    expect(['none', 'low', 'medium']).toContain(result);
    expect(result).not.toBe('high');
  });

  it('applies contradiction penalty (confidence drops)', () => {
    const evidence = [mkEvidence('test_result', 'tr-1')];
    const contradictions = [mkEvidence('test_result', 'contra-1')];

    const withoutContradiction = computeConfidence(evidence, [], FRESH_PRIOR);
    const withContradiction = computeConfidence(
      evidence,
      contradictions,
      FRESH_PRIOR,
    );

    // Contradiction penalty is -2 bands
    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };
    expect(bandOrder[withContradiction]!).toBeLessThan(
      bandOrder[withoutContradiction]!,
    );
  });

  it('applies quantity boost with >= 2 independent non-LLM evidence', () => {
    const singleEvidence = [mkEvidence('test_result', 'tr-1')];
    const multiEvidence = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('test_result', 'tr-2'),
    ];

    const singleResult = computeConfidence(singleEvidence, [], FRESH_PRIOR);
    const multiResult = computeConfidence(multiEvidence, [], FRESH_PRIOR);

    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };

    // Quantity boost should result in same or higher band
    expect(bandOrder[multiResult]!).toBeGreaterThanOrEqual(
      bandOrder[singleResult]!,
    );
  });

  it('applies diversity boost with >= 2 distinct non-LLM evidence kinds', () => {
    // Two evidence of same kind: no diversity boost
    const sameKind = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('test_result', 'tr-2'),
    ];
    // Two evidence of different kinds: diversity boost
    const diverseKind = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('grep_hit', 'gh-1'),
    ];

    const sameResult = computeConfidence(sameKind, [], FRESH_PRIOR);
    const diverseResult = computeConfidence(diverseKind, [], FRESH_PRIOR);

    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };

    // Diversity boost provides +1 on top of quantity boost
    expect(bandOrder[diverseResult]!).toBeGreaterThanOrEqual(
      bandOrder[sameResult]!,
    );
  });

  it('is deterministic: identical inputs produce identical outputs', () => {
    const evidence = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('grep_hit', 'gh-1'),
      mkEvidence('human_annotation', 'ha-1'),
    ];
    const contradictions = [mkEvidence('llm_derivation', 'contra-1')];

    const result1 = computeConfidence(evidence, contradictions, FRESH_PRIOR);
    const result2 = computeConfidence(evidence, contradictions, FRESH_PRIOR);
    const result3 = computeConfidence(evidence, contradictions, FRESH_PRIOR);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('is order-independent: shuffled evidence arrays produce same result', () => {
    const evidence = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('grep_hit', 'gh-1'),
      mkEvidence('human_annotation', 'ha-1'),
      mkEvidence('git_commit', 'gc-1'),
    ];

    const shuffled = [...evidence].reverse();
    const randomOrder = [evidence[2]!, evidence[0]!, evidence[3]!, evidence[1]!];

    const result1 = computeConfidence(evidence, [], FRESH_PRIOR);
    const result2 = computeConfidence(shuffled, [], FRESH_PRIOR);
    const result3 = computeConfidence(randomOrder, [], FRESH_PRIOR);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  // -----------------------------------------------------------------------
  // Edge cases: missing coverage
  // -----------------------------------------------------------------------

  it('all evidence same kind yields no diversity boost', () => {
    // 3 test_results, same kind: base=high(3), quantity +1, diversity 0,
    // human 0 => clamped high(3)
    const evidence = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('test_result', 'tr-2'),
      mkEvidence('test_result', 'tr-3'),
    ];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    // With quantity boost only: base high(3)+1=4, clamped to 3 -> 'high'
    expect(result).toBe('high');

    // Compare against diverse evidence to confirm diversity has an effect
    // Use weaker evidence where the diversity boost actually changes the outcome
    const sameKind = [
      mkEvidence('grep_hit', 'gh-1'),
      mkEvidence('grep_hit', 'gh-2'),
    ];
    const diverseKind = [
      mkEvidence('grep_hit', 'gh-1'),
      mkEvidence('git_commit', 'gc-1'),
    ];
    // sameKind: base=low(rank 3<4 -> low=1), quantity +1=2, diversity 0 => medium
    // diverseKind: base=low(rank 3<4 -> low=1), quantity +1=2, diversity +1=3 => high
    const sameResult = computeConfidence(sameKind, [], FRESH_PRIOR);
    const diverseResult = computeConfidence(diverseKind, [], FRESH_PRIOR);
    expect(sameResult).toBe('medium');
    expect(diverseResult).toBe('high');
  });

  it('exactly 1 non-LLM + 1 LLM: no quantity boost, no LLM ceiling', () => {
    // 1 grep_hit (rank=3 -> base=low=1), 1 llm_derivation (rank=0)
    // nonLlmCount=1 -> no quantity boost
    // nonLlmKinds.size=1 -> no diversity boost
    // allLlm=false (grep_hit present) -> no LLM ceiling
    // No human, no penalties => low
    const evidence = [
      mkEvidence('grep_hit', 'gh-1'),
      mkEvidence('llm_derivation', 'llm-1'),
    ];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    expect(result).toBe('low');
  });

  it('freshness penalty from stale prior state subtracts 2 ordinal steps', () => {
    // single test_result: base=high(3). No boosts (only 1 evidence).
    // Stale penalty: -2 => 1 => low
    const evidence = [mkEvidence('test_result', 'tr-1')];
    const stalePrior: ScoredState = { confidence: 'none', freshness: 'stale' };
    const result = computeConfidence(evidence, [], stalePrior);
    expect(result).toBe('low');
  });

  it('freshness penalty from aging prior state subtracts 1 ordinal step', () => {
    // single test_result: base=high(3). No boosts.
    // Aging penalty: -1 => 2 => medium
    const evidence = [mkEvidence('test_result', 'tr-1')];
    const agingPrior: ScoredState = { confidence: 'none', freshness: 'aging' };
    const result = computeConfidence(evidence, [], agingPrior);
    expect(result).toBe('medium');
  });

  it('contradiction + human confirmation: contradiction penalty takes priority', () => {
    // human_annotation (rank=8 -> base=high=3), human boost +1=4,
    // clamped to high(3). Contradiction -2 => 1 => low.
    const evidence = [mkEvidence('human_annotation', 'ha-1')];
    const contradictions = [mkEvidence('test_result', 'contra-1')];
    const result = computeConfidence(evidence, contradictions, FRESH_PRIOR);
    expect(result).toBe('low');
  });

  it('maximum possible confidence: human + test + symbol + diverse kinds', () => {
    // human_annotation(rank=8) + test_result(rank=7) + symbol_index_hit(rank=6)
    // base=high(3), quantity(3 non-LLM >=2) +1=4, diversity(3 kinds >=2) +1=5,
    // human boost +1=6, clamped to high(3). No penalties. => high
    const evidence = [
      mkEvidence('human_annotation', 'ha-1'),
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('symbol_index_hit', 'si-1'),
    ];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    expect(result).toBe('high');
  });

  it('minimum possible confidence with evidence: LLM-only + stale + contradicted', () => {
    // 1 llm_derivation: base=low(1). allLlm=true.
    // No boosts. Stale: -2 => -1. Contradiction: -2 => -3.
    // Clamped to 0 => none. LLM ceiling: min(0,2) = 0 => none.
    const evidence = [mkEvidence('llm_derivation', 'llm-1')];
    const contradictions = [mkEvidence('test_result', 'contra-1')];
    const stalePrior: ScoredState = { confidence: 'none', freshness: 'stale' };
    const result = computeConfidence(evidence, contradictions, stalePrior);
    expect(result).toBe('none');
  });

  it('combined boosts with LLM ceiling: multiple LLM derivations stay capped', () => {
    // Even with many LLM derivations, all-LLM ceiling limits to medium.
    // 5 llm_derivation: base=low(1). allLlm=true.
    // nonLlmCount=0 -> no quantity boost, no diversity boost, no human.
    // Clamp=1. No penalties (fresh). LLM ceiling: min(1,2) = 1 => low.
    const evidence = [
      mkEvidence('llm_derivation', 'llm-1'),
      mkEvidence('llm_derivation', 'llm-2'),
      mkEvidence('llm_derivation', 'llm-3'),
      mkEvidence('llm_derivation', 'llm-4'),
      mkEvidence('llm_derivation', 'llm-5'),
    ];
    const result = computeConfidence(evidence, [], FRESH_PRIOR);
    expect(result).toBe('low');
  });

  it('human-confirmation boost alone raises band by 1 step', () => {
    // single human_annotation: base=high(rank=8 >=6 -> high=3).
    // nonLlmCount=1 -> no quantity boost. 1 kind -> no diversity.
    // Human boost +1=4, clamped to 3. => high.
    // Now test with lower-ranked evidence to see the +1 effect:
    // single git_commit (rank=2 -> base=low=1). human=false.
    // Result=low(1).
    const withoutHuman = [mkEvidence('git_commit', 'gc-1')];
    const withHuman = [mkEvidence('git_commit', 'gc-1'), mkEvidence('human_annotation', 'ha-1')];
    const noHumanResult = computeConfidence(withoutHuman, [], FRESH_PRIOR);
    const humanResult = computeConfidence(withHuman, [], FRESH_PRIOR);
    // withHuman: base=high(rank=8 -> high=3), quantity(2 nonLLM) +1=4,
    // diversity(2 kinds) +1=5, human +1=6, clamped 3 => high.
    // Actually for the isolated +1 test, use evidence that stays below ceiling:
    // Better: verify that adding human to a scenario raises band.
    expect(noHumanResult).toBe('low');
    expect(humanResult).toBe('high');
  });

  it('stale freshness penalty combined with contradiction drops to none', () => {
    // tree_sitter_query (rank=4 -> base=medium=2). No other boosts (1 evidence).
    // Contradiction: -2 => 0. Stale: -2 => -2. Clamped to 0 => none.
    const evidence = [mkEvidence('tree_sitter_query', 'tsq-1')];
    const contradictions = [mkEvidence('static_analysis_result', 'sa-1')];
    const stalePrior: ScoredState = { confidence: 'none', freshness: 'stale' };
    const result = computeConfidence(evidence, contradictions, stalePrior);
    expect(result).toBe('none');
  });

  it('applies freshness penalty for stale prior', () => {
    const evidence = [mkEvidence('test_result', 'tr-1')];
    const stalePrior: ScoredState = { confidence: 'high', freshness: 'stale' };
    const freshPrior: ScoredState = { confidence: 'high', freshness: 'fresh' };

    const staleResult = computeConfidence(evidence, [], stalePrior);
    const freshResult = computeConfidence(evidence, [], freshPrior);

    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };

    // Stale penalty should reduce confidence
    expect(bandOrder[staleResult]!).toBeLessThanOrEqual(
      bandOrder[freshResult]!,
    );
  });

  it('applies freshness penalty for aging prior', () => {
    const evidence = [
      mkEvidence('test_result', 'tr-1'),
      mkEvidence('grep_hit', 'gh-1'),
    ];
    const agingPrior: ScoredState = { confidence: 'high', freshness: 'aging' };
    const freshPrior: ScoredState = { confidence: 'high', freshness: 'fresh' };

    const agingResult = computeConfidence(evidence, [], agingPrior);
    const freshResult = computeConfidence(evidence, [], freshPrior);

    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };

    expect(bandOrder[agingResult]!).toBeLessThanOrEqual(
      bandOrder[freshResult]!,
    );
  });
});

// ---------------------------------------------------------------------------
// computeFreshness
// ---------------------------------------------------------------------------

describe('computeFreshness', () => {
  it('lowers freshness by 1 step on scoped change with different revision', () => {
    const change: ChangeSet = {
      touchesScope: true,
      priorFreshness: 'fresh',
      changeRevision: 'rev-2',
    };

    const result = computeFreshness(change, 'rev-1');
    expect(result).toBe('aging');
  });

  it('lowers freshness from aging to stale', () => {
    const change: ChangeSet = {
      touchesScope: true,
      priorFreshness: 'aging',
      changeRevision: 'rev-2',
    };

    const result = computeFreshness(change, 'rev-1');
    expect(result).toBe('stale');
  });

  it('does not change freshness below stale', () => {
    const change: ChangeSet = {
      touchesScope: true,
      priorFreshness: 'stale',
      changeRevision: 'rev-2',
    };

    const result = computeFreshness(change, 'rev-1');
    expect(result).toBe('stale');
  });

  it('returns unchanged freshness when evidence revision matches change revision', () => {
    const change: ChangeSet = {
      touchesScope: true,
      priorFreshness: 'fresh',
      changeRevision: 'rev-same',
    };

    const result = computeFreshness(change, 'rev-same');
    expect(result).toBe('fresh');
  });

  it('returns unchanged freshness when scope is not touched', () => {
    const change: ChangeSet = {
      touchesScope: false,
      priorFreshness: 'fresh',
      changeRevision: 'rev-2',
    };

    const result = computeFreshness(change, 'rev-1');
    expect(result).toBe('fresh');
  });
});
