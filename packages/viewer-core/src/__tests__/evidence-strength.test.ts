/**
 * Tests for viewer-core evidence-strength ranking helpers.
 *
 */
import { describe, it, expect } from 'vitest';
import { evidenceStrengthRank, strongestBaseBand } from '../scoring.js';
import type { EvidenceRef } from '../types.js';

function mkEvidence(kind: string, id?: string): EvidenceRef {
  return { evidenceId: id ?? `ev-${kind}`, kind };
}

describe('evidenceStrengthRank', () => {
  it('ranks human_annotation highest (8)', () => {
    expect(evidenceStrengthRank('human_annotation')).toBe(8);
  });

  it('ranks test_result at 7', () => {
    expect(evidenceStrengthRank('test_result')).toBe(7);
  });

  it('ranks symbol_index_hit at 6', () => {
    expect(evidenceStrengthRank('symbol_index_hit')).toBe(6);
  });

  it('ranks static_analysis_result at 5', () => {
    expect(evidenceStrengthRank('static_analysis_result')).toBe(5);
  });

  it('ranks tree_sitter_query at 4', () => {
    expect(evidenceStrengthRank('tree_sitter_query')).toBe(4);
  });

  it('ranks grep_hit at 3', () => {
    expect(evidenceStrengthRank('grep_hit')).toBe(3);
  });

  it('ranks source_span at 3', () => {
    expect(evidenceStrengthRank('source_span')).toBe(3);
  });

  it('ranks git_commit at 2', () => {
    expect(evidenceStrengthRank('git_commit')).toBe(2);
  });

  it('ranks embedding_similarity at 1', () => {
    expect(evidenceStrengthRank('embedding_similarity')).toBe(1);
  });

  it('ranks llm_derivation at 0 (lowest)', () => {
    expect(evidenceStrengthRank('llm_derivation')).toBe(0);
  });

  it('ranks unknown kinds at 0', () => {
    expect(evidenceStrengthRank('some_unknown_kind')).toBe(0);
  });

  it('follows strict ordering: human > test > symbol_index > static > tree-sitter > grep > git > semantic > LLM', () => {
    const ordered = [
      'human_annotation',   // 8
      'test_result',        // 7
      'symbol_index_hit',   // 6
      'static_analysis_result', // 5
      'tree_sitter_query',  // 4
      'grep_hit',           // 3
      'git_commit',         // 2
      'embedding_similarity', // 1
      'llm_derivation',     // 0
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(
        evidenceStrengthRank(ordered[i]!),
        `${ordered[i]} should rank higher than ${ordered[i + 1]}`,
      ).toBeGreaterThan(evidenceStrengthRank(ordered[i + 1]!));
    }
  });
});

describe('strongestBaseBand', () => {
  it('returns "none" for empty evidence array', () => {
    expect(strongestBaseBand([])).toBe('none');
  });

  it('returns "high" for evidence with rank >= 6', () => {
    expect(strongestBaseBand([mkEvidence('human_annotation')])).toBe('high');
    expect(strongestBaseBand([mkEvidence('test_result')])).toBe('high');
    expect(strongestBaseBand([mkEvidence('symbol_index_hit')])).toBe('high');
  });

  it('returns "medium" for evidence with rank >= 4 and < 6', () => {
    expect(strongestBaseBand([mkEvidence('static_analysis_result')])).toBe('medium');
    expect(strongestBaseBand([mkEvidence('tree_sitter_query')])).toBe('medium');
  });

  it('returns "low" for evidence with rank < 4', () => {
    expect(strongestBaseBand([mkEvidence('grep_hit')])).toBe('low');
    expect(strongestBaseBand([mkEvidence('git_commit')])).toBe('low');
    expect(strongestBaseBand([mkEvidence('llm_derivation')])).toBe('low');
  });

  it('returns the band of the strongest evidence in a mixed set', () => {
    const mixed = [
      mkEvidence('llm_derivation'),   // rank 0 -> low
      mkEvidence('grep_hit'),          // rank 3 -> low
      mkEvidence('test_result'),       // rank 7 -> high
    ];
    expect(strongestBaseBand(mixed)).toBe('high');
  });
});
