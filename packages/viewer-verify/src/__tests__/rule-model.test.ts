/**
 * Tests for viewer-verify rule model.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  loadExplicitRules,
  makeInferredCandidate,
  matchForbiddenImport,
  neverAutoEnforceGuard,
} from '../rule-model.js';
import { isMvpRecipe } from '../recipes.js';
import type { RuleDefinition, VerificationRecipe } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkRuleDef(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    name: 'test-rule',
    type: 'forbidden_import',
    from: { pathGlob: 'packages/api/**' },
    to: { pathGlob: 'packages/db/**' },
    severity: 'error',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// neverAutoEnforceGuard
// ---------------------------------------------------------------------------

describe('neverAutoEnforceGuard', () => {
  it('throws on non-explicit rule (inferred candidate)', () => {
    const inferred = makeInferredCandidate(
      'repo-1',
      mkRuleDef(),
      ['ev-1'],
      [],
    );
    expect(() => neverAutoEnforceGuard(inferred)).toThrow(
      'non-explicit rule reached enforcement path',
    );
  });

  it('throws on null', () => {
    expect(() => neverAutoEnforceGuard(null)).toThrow('non-object');
  });

  it('throws on undefined', () => {
    expect(() => neverAutoEnforceGuard(undefined)).toThrow('non-object');
  });

  it('throws on plain object without correct status', () => {
    expect(() =>
      neverAutoEnforceGuard({ status: 'rejected', source: 'explicit' }),
    ).toThrow('non-explicit rule');
  });

  it('throws on object with explicit source but wrong status', () => {
    expect(() =>
      neverAutoEnforceGuard({
        status: 'inferred_candidate',
        source: 'explicit',
      }),
    ).toThrow('non-explicit rule');
  });

  it('passes on explicit rule created by loadExplicitRules', () => {
    const [rule] = loadExplicitRules('repo-1', [mkRuleDef()]);
    expect(() => neverAutoEnforceGuard(rule)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadExplicitRules
// ---------------------------------------------------------------------------

describe('loadExplicitRules', () => {
  it('produces branded rules with correct status and source', () => {
    const defs: RuleDefinition[] = [
      mkRuleDef({ name: 'rule-a' }),
      mkRuleDef({ name: 'rule-b' }),
    ];
    const rules = loadExplicitRules('repo-1', defs);

    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.source).toBe('explicit');
      expect(rule.status).toBe('human_confirmed_explicit');
      expect(rule.repositoryId).toBe('repo-1');
    }
    expect(rules[0]!.name).toBe('rule-a');
    expect(rules[1]!.name).toBe('rule-b');
  });

  it('produces rules that pass neverAutoEnforceGuard', () => {
    const rules = loadExplicitRules('repo-1', [mkRuleDef()]);
    for (const rule of rules) {
      expect(() => neverAutoEnforceGuard(rule)).not.toThrow();
    }
  });

  it('returns empty array for empty definitions', () => {
    const rules = loadExplicitRules('repo-1', []);
    expect(rules).toEqual([]);
  });

  it('skips disabled rules and keeps enabled/default-enabled rules', () => {
    const defs: RuleDefinition[] = [
      mkRuleDef({ name: 'explicitly-enabled', enabled: true }),
      mkRuleDef({ name: 'explicitly-disabled', enabled: false }),
      mkRuleDef({ name: 'default-enabled' }), // enabled is undefined
    ];
    const rules = loadExplicitRules('repo-1', defs);

    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.name)).toEqual([
      'explicitly-enabled',
      'default-enabled',
    ]);
  });
});

// ---------------------------------------------------------------------------
// makeInferredCandidate
// ---------------------------------------------------------------------------

describe('makeInferredCandidate', () => {
  it('creates an unbranded inferred candidate with correct fields', () => {
    const candidate = makeInferredCandidate(
      'repo-1',
      mkRuleDef({ name: 'inferred-1' }),
      ['ev-1', 'ev-2'],
      ['exception-1'],
    );

    expect(candidate.status).toBe('inferred_candidate');
    expect(candidate.source).toBe('inferred');
    expect(candidate.name).toBe('inferred-1');
    expect(candidate.evidenceIds).toEqual(['ev-1', 'ev-2']);
    expect(candidate.knownExceptions).toEqual(['exception-1']);
    expect(candidate.repositoryId).toBe('repo-1');
  });

  it('does not share reference with input arrays', () => {
    const evidenceIds = ['ev-1'];
    const knownExceptions = ['ex-1'];
    const candidate = makeInferredCandidate(
      'repo-1',
      mkRuleDef(),
      evidenceIds,
      knownExceptions,
    );

    // Mutating input arrays should not affect the candidate
    evidenceIds.push('ev-2');
    knownExceptions.push('ex-2');
    expect(candidate.evidenceIds).toEqual(['ev-1']);
    expect(candidate.knownExceptions).toEqual(['ex-1']);
  });
});

// ---------------------------------------------------------------------------
// matchForbiddenImport
// ---------------------------------------------------------------------------

describe('matchForbiddenImport', () => {
  it('matches when both from and to paths match the rule globs', () => {
    const [rule] = loadExplicitRules('repo-1', [mkRuleDef()]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/index.ts', 'packages/db/src/connection.ts'),
    ).toBe(true);
  });

  it('does not match when from path does not match', () => {
    const [rule] = loadExplicitRules('repo-1', [mkRuleDef()]);
    expect(
      matchForbiddenImport(rule!, 'packages/cli/src/index.ts', 'packages/db/src/connection.ts'),
    ).toBe(false);
  });

  it('does not match when to path does not match', () => {
    const [rule] = loadExplicitRules('repo-1', [mkRuleDef()]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/index.ts', 'packages/utils/src/helper.ts'),
    ).toBe(false);
  });

  it('returns false for non-forbidden_import rules', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({ type: 'required_dependency' }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/index.ts', 'packages/db/src/connection.ts'),
    ).toBe(false);
  });

  it('matches with ** glob patterns', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({
        from: { pathGlob: '**' },
        to: { pathGlob: 'packages/internal/**' },
      }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'any/path/here.ts', 'packages/internal/secret.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'any/path/here.ts', 'packages/public/api.ts'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMvpRecipe
// ---------------------------------------------------------------------------

describe('isMvpRecipe', () => {
  const mvpTypes = [
    'source_span_check',
    'symbol_exists_check',
    'import_edge_check',
    'grep_check',
  ];

  for (const recipeType of mvpTypes) {
    it(`returns true for ${recipeType}`, () => {
      const recipe: VerificationRecipe = {
        recipeType,
        description: `Test ${recipeType}`,
      };
      expect(isMvpRecipe(recipe)).toBe(true);
    });
  }

  it('returns false for non-MVP recipe type', () => {
    const recipe: VerificationRecipe = {
      recipeType: 'custom_check',
      description: 'Test custom',
    };
    expect(isMvpRecipe(recipe)).toBe(false);
  });

  it('returns false for empty string recipe type', () => {
    const recipe: VerificationRecipe = {
      recipeType: '',
      description: 'Test empty',
    };
    expect(isMvpRecipe(recipe)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// picomatch behavioral equivalence for forbidden_import matching
// ---------------------------------------------------------------------------

describe('matchForbiddenImport with picomatch brace expansion', () => {
  it('matches basic glob patterns in forbidden_import rules', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({
        from: { pathGlob: 'packages/api/**' },
        to: { pathGlob: 'packages/db/**' },
      }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/handler.ts', 'packages/db/src/connection.ts'),
    ).toBe(true);
  });

  it('supports brace expansion {src,lib}/**/*.ts in from glob', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({
        from: { pathGlob: '{src,lib}/**/*.ts' },
        to: { pathGlob: 'packages/internal/**' },
      }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'src/api/handler.ts', 'packages/internal/secret.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'lib/utils/helper.ts', 'packages/internal/secret.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'test/helper.ts', 'packages/internal/secret.ts'),
    ).toBe(false);
  });

  it('supports brace expansion in to glob', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({
        from: { pathGlob: 'packages/api/**' },
        to: { pathGlob: 'packages/{db,cache}/**' },
      }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/handler.ts', 'packages/db/src/conn.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/handler.ts', 'packages/cache/src/redis.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/handler.ts', 'packages/utils/src/helper.ts'),
    ).toBe(false);
  });

  it('supports brace expansion in both from and to globs simultaneously', () => {
    const [rule] = loadExplicitRules('repo-1', [
      mkRuleDef({
        from: { pathGlob: '{packages/api,packages/web}/**' },
        to: { pathGlob: '{packages/db,packages/internal}/**' },
      }),
    ]);
    expect(
      matchForbiddenImport(rule!, 'packages/api/src/x.ts', 'packages/db/src/y.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'packages/web/src/x.ts', 'packages/internal/src/y.ts'),
    ).toBe(true);
    expect(
      matchForbiddenImport(rule!, 'packages/cli/src/x.ts', 'packages/db/src/y.ts'),
    ).toBe(false);
  });
});
