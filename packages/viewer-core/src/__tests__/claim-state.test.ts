/**
 * Tests for viewer-core claim state machine.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  nextClaimStatus,
  isSurfaceable,
  claimSurfacingClass,
  importanceAtLeast,
  TH_07_SURFACING_CUTOFF,
} from '../claim-state.js';
import type { Claim, EvidenceRef } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkEvidence(kind: string, id?: string): EvidenceRef {
  return { evidenceId: id ?? `ev-${kind}`, kind };
}

function mkClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    status: 'hypothesis',
    confidence: 'medium',
    supportingEvidence: [],
    contradictingEvidence: [],
    verificationRecipeCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// nextClaimStatus
// ---------------------------------------------------------------------------

describe('nextClaimStatus', () => {
  it('returns "contradicted" when contradicting evidence exists', () => {
    const claim = mkClaim();
    const evidence = [mkEvidence('test_result')];
    const contradictions = [mkEvidence('test_result', 'contra-1')];

    expect(nextClaimStatus(claim, evidence, contradictions)).toBe(
      'contradicted',
    );
  });

  it('stays "rejected" when current status is rejected', () => {
    const claim = mkClaim({ status: 'rejected' });
    const evidence = [mkEvidence('test_result')];
    const contradictions: EvidenceRef[] = [];

    expect(nextClaimStatus(claim, evidence, contradictions)).toBe('rejected');
  });

  it('returns "confirmed" with human_annotation', () => {
    const claim = mkClaim();
    const evidence = [mkEvidence('human_annotation')];
    const contradictions: EvidenceRef[] = [];

    expect(nextClaimStatus(claim, evidence, contradictions)).toBe('confirmed');
  });

  it('returns "confirmed" with non-LLM evidence (e.g., test_result)', () => {
    const claim = mkClaim();
    const evidence = [mkEvidence('test_result')];
    const contradictions: EvidenceRef[] = [];

    expect(nextClaimStatus(claim, evidence, contradictions)).toBe('confirmed');
  });

  it('never returns "confirmed" with LLM-only evidence', () => {
    const claim = mkClaim();
    const evidence = [
      mkEvidence('llm_derivation', 'llm-1'),
      mkEvidence('llm_derivation', 'llm-2'),
    ];
    const contradictions: EvidenceRef[] = [];

    const result = nextClaimStatus(claim, evidence, contradictions);
    expect(result).not.toBe('confirmed');
    expect(result).toBe('hypothesis');
  });

  it('returns "hypothesis" with no evidence', () => {
    const claim = mkClaim();
    expect(nextClaimStatus(claim, [], [])).toBe('hypothesis');
  });

  it('contradicted takes priority over rejected', () => {
    const claim = mkClaim({ status: 'rejected' });
    const contradictions = [mkEvidence('test_result', 'contra-1')];
    expect(nextClaimStatus(claim, [], contradictions)).toBe('contradicted');
  });
});

// ---------------------------------------------------------------------------
// isSurfaceable
// ---------------------------------------------------------------------------

describe('isSurfaceable', () => {
  it('returns true with sufficient evidence, recipes, and confidence', () => {
    const claim = mkClaim({
      supportingEvidence: [mkEvidence('test_result')],
      verificationRecipeCount: 1,
      confidence: 'high',
    });
    expect(isSurfaceable(claim)).toBe(true);
  });

  it('returns false with no evidence', () => {
    const claim = mkClaim({
      supportingEvidence: [],
      verificationRecipeCount: 1,
      confidence: 'high',
    });
    expect(isSurfaceable(claim)).toBe(false);
  });

  it('returns false with no verification recipes', () => {
    const claim = mkClaim({
      supportingEvidence: [mkEvidence('test_result')],
      verificationRecipeCount: 0,
      confidence: 'high',
    });
    expect(isSurfaceable(claim)).toBe(false);
  });

  it('returns false with confidence below cutoff', () => {
    const claim = mkClaim({
      supportingEvidence: [mkEvidence('test_result')],
      verificationRecipeCount: 1,
      confidence: 'low',
    });
    expect(isSurfaceable(claim)).toBe(false);
  });

  it('returns false with only LLM evidence when non-LLM is required', () => {
    const claim = mkClaim({
      supportingEvidence: [mkEvidence('llm_derivation')],
      verificationRecipeCount: 1,
      confidence: 'high',
    });
    // TH_07 requires non-LLM evidence by default
    expect(TH_07_SURFACING_CUTOFF.requiresNonLlmEvidence).toBe(true);
    expect(isSurfaceable(claim)).toBe(false);
  });

  it('returns true at the exact confidence cutoff boundary', () => {
    const claim = mkClaim({
      supportingEvidence: [mkEvidence('test_result')],
      verificationRecipeCount: 1,
      confidence: TH_07_SURFACING_CUTOFF.minConfidenceBand,
    });
    expect(isSurfaceable(claim)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// claimSurfacingClass
// ---------------------------------------------------------------------------

describe('claimSurfacingClass', () => {
  it('classifies exported file-defines-symbol as exported-symbol/high', () => {
    const claim = mkClaim({
      claimType: 'file-defines-symbol',
      scope: { exported: true },
    });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('exported-symbol');
    expect(importance).toBe('high');
  });

  it('classifies non-exported file-defines-symbol as local-symbol/low', () => {
    const claim = mkClaim({
      claimType: 'file-defines-symbol',
      scope: { exported: false },
    });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('local-symbol');
    expect(importance).toBe('low');
  });

  it('classifies likely-entrypoint as entrypoint/high', () => {
    const claim = mkClaim({ claimType: 'likely-entrypoint' });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('entrypoint');
    expect(importance).toBe('high');
  });

  it('classifies package-imports-package as import/medium', () => {
    const claim = mkClaim({ claimType: 'package-imports-package' });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('import');
    expect(importance).toBe('medium');
  });

  it('classifies forbidden-import-violation as invariant/high', () => {
    const claim = mkClaim({ claimType: 'forbidden-import-violation' });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('invariant');
    expect(importance).toBe('high');
  });

  it('classifies unknown claim type as other/low', () => {
    const claim = mkClaim({ claimType: 'something-unknown' });
    const { category, importance } = claimSurfacingClass(claim);
    expect(category).toBe('other');
    expect(importance).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// importanceAtLeast
// ---------------------------------------------------------------------------

describe('importanceAtLeast', () => {
  it('returns true when importance matches minimum', () => {
    expect(importanceAtLeast('medium', 'medium')).toBe(true);
  });

  it('returns true when importance exceeds minimum', () => {
    expect(importanceAtLeast('high', 'low')).toBe(true);
  });

  it('returns false when importance is below minimum', () => {
    expect(importanceAtLeast('low', 'high')).toBe(false);
  });
});
