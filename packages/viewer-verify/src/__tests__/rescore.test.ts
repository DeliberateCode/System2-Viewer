/**
 * Tests for viewer-verify rescoreFromEvidence.
 *
 */
import { describe, it, expect } from 'vitest';
import { rescoreFromEvidence } from '../rescore.js';
import type { RescoreInput } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkInput(overrides: Partial<RescoreInput> = {}): RescoreInput {
  return {
    evidence: [],
    contradictions: [],
    priorState: { confidence: 'none', freshness: 'fresh' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rescoreFromEvidence
// ---------------------------------------------------------------------------

describe('rescoreFromEvidence', () => {
  it('returns "none" confidence with no evidence (delegates to computeConfidence)', () => {
    const result = rescoreFromEvidence(mkInput());
    expect(result.confidence).toBe('none');
    expect(result.freshness).toBe('fresh');
  });

  it('returns high confidence for human_annotation evidence', () => {
    const result = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'human_annotation' }],
      }),
    );
    expect(result.confidence).toBe('high');
  });

  it('caps LLM-only evidence at medium (delegates to computeConfidence)', () => {
    const result = rescoreFromEvidence(
      mkInput({
        evidence: [
          { evidenceId: 'ev-1', kind: 'llm_derivation' },
          { evidenceId: 'ev-2', kind: 'llm_derivation' },
        ],
      }),
    );
    expect(result.confidence).not.toBe('high');
  });

  it('applies contradiction penalty (delegates to computeConfidence)', () => {
    const withoutContra = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'test_result' }],
      }),
    );

    const withContra = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'test_result' }],
        contradictions: [{ evidenceId: 'ev-c', kind: 'test_result' }],
      }),
    );

    const bandOrder: Record<string, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
    };
    expect(bandOrder[withContra.confidence]!).toBeLessThan(
      bandOrder[withoutContra.confidence]!,
    );
  });

  it('computes freshness when scopedChange is provided', () => {
    const result = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'test_result' }],
        priorState: { confidence: 'medium', freshness: 'fresh' },
        scopedChange: {
          touchesScope: true,
          priorFreshness: 'fresh',
          changeRevision: 'rev-2',
        },
        lastEvidenceRevision: 'rev-1',
      }),
    );
    // A scoped change at a different revision should lower freshness
    expect(result.freshness).toBe('aging');
  });

  it('preserves freshness when scopedChange is not provided', () => {
    const result = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'test_result' }],
        priorState: { confidence: 'medium', freshness: 'aging' },
      }),
    );
    expect(result.freshness).toBe('aging');
  });

  it('preserves freshness when lastEvidenceRevision matches changeRevision', () => {
    const result = rescoreFromEvidence(
      mkInput({
        evidence: [{ evidenceId: 'ev-1', kind: 'test_result' }],
        priorState: { confidence: 'medium', freshness: 'fresh' },
        scopedChange: {
          touchesScope: true,
          priorFreshness: 'fresh',
          changeRevision: 'rev-same',
        },
        lastEvidenceRevision: 'rev-same',
      }),
    );
    expect(result.freshness).toBe('fresh');
  });
});
