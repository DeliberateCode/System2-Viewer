/**
 * Tests for viewer-verify RulesEngine and checkInvariants envelope wrapper.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { RulesEngine, checkInvariants } from '../rules-engine.js';
import {
  loadExplicitRules,
  makeInferredCandidate,
} from '../rule-model.js';
import type {
  RulesReadHandle,
  ModelImportEdge,
  RuleDefinition,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkRuleDef(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    name: 'no-api-to-db',
    type: 'forbidden_import',
    from: { pathGlob: 'packages/api/**' },
    to: { pathGlob: 'packages/db/**' },
    severity: 'error',
    ...overrides,
  };
}

function mkReadHandle(
  importEdges: ModelImportEdge[] = [],
): RulesReadHandle {
  return {
    neighbors: vi.fn().mockReturnValue([]),
    getNode: vi.fn().mockReturnValue(null),
    allImportEdges: vi.fn().mockReturnValue(importEdges),
  };
}

// ---------------------------------------------------------------------------
// RulesEngine.checkInvariants
// ---------------------------------------------------------------------------

describe('RulesEngine.checkInvariants', () => {
  it('reports violation when a forbidden import edge matches', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/handler.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.ruleName).toBe('no-api-to-db');
    expect(result.violations[0]!.fromPath).toBe('packages/api/src/handler.ts');
    expect(result.violations[0]!.toPath).toBe('packages/db/src/connection.ts');
    expect(result.violations[0]!.severity).toBe('error');
  });

  it('passes when no import edges match', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/cli/src/index.ts',
        toPath: 'packages/utils/src/helper.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesChecked).toBe(1);
  });

  it('reports rulesChecked count correctly', () => {
    const explicitRules = loadExplicitRules('repo-1', [
      mkRuleDef({ name: 'rule-a' }),
      mkRuleDef({ name: 'rule-b' }),
    ]);
    const engine = new RulesEngine(explicitRules, []);
    const handle = mkReadHandle([]);

    const result = engine.checkInvariants(handle);
    expect(result.rulesChecked).toBe(2);
  });

  it('does not enforce inferred candidates (they are in a separate list)', () => {
    const inferred = makeInferredCandidate('repo-1', mkRuleDef(), ['ev-1'], []);
    const engine = new RulesEngine([], [inferred]);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/handler.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);
    // Inferred candidates are not checked -- only explicit rules
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesChecked).toBe(0);
  });

  it('applies scope filter to edges', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/handler.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    // Scope filter to a different path -- the violation should be excluded
    const result = engine.checkInvariants(handle, {
      scope: { path: 'packages/web/' },
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('includes edge when scope filter matches from path', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/handler.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    const result = engine.checkInvariants(handle, {
      scope: { path: 'packages/api/' },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('handles empty import edge list', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);
    const handle = mkReadHandle([]);

    const result = engine.checkInvariants(handle);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RulesEngine.surfaceInferredCandidates
// ---------------------------------------------------------------------------

describe('RulesEngine.surfaceInferredCandidates', () => {
  it('returns inferred candidates as hypothesis claims', () => {
    const inferred = makeInferredCandidate(
      'repo-1',
      mkRuleDef({ name: 'inferred-layer-rule' }),
      ['ev-1', 'ev-2'],
      ['exception-1'],
    );
    const engine = new RulesEngine([], [inferred]);

    const candidates = engine.surfaceInferredCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.ruleName).toBe('inferred-layer-rule');
    expect(candidates[0]!.evidenceIds).toEqual(['ev-1', 'ev-2']);
    expect(candidates[0]!.knownExceptions).toEqual(['exception-1']);
    expect(candidates[0]!.statement).toContain('Inferred rule');
  });

  it('returns empty array when no inferred candidates exist', () => {
    const engine = new RulesEngine([], []);
    expect(engine.surfaceInferredCandidates()).toEqual([]);
  });

  it('does not share references with internal arrays', () => {
    const inferred = makeInferredCandidate(
      'repo-1',
      mkRuleDef(),
      ['ev-1'],
      ['ex-1'],
    );
    const engine = new RulesEngine([], [inferred]);

    const candidates = engine.surfaceInferredCandidates();
    // Mutating returned arrays should not affect the engine
    candidates[0]!.evidenceIds.push('ev-mutated');

    const candidates2 = engine.surfaceInferredCandidates();
    expect(candidates2[0]!.evidenceIds).not.toContain('ev-mutated');
  });
});

// ---------------------------------------------------------------------------
// checkInvariants (standalone wrapper)
// ---------------------------------------------------------------------------

describe('checkInvariants (standalone)', () => {
  it('wraps result in a ResultEnvelope', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);
    const handle = mkReadHandle([]);

    const envelope = checkInvariants(engine, handle);

    expect(envelope.query.op).toBe('checkInvariants');
    expect(envelope.data.passed).toBe(true);
    expect(envelope.data.rulesChecked).toBe(1);
    expect(envelope.modelRevision).toBe('latest');
    expect(Array.isArray(envelope.evidence)).toBe(true);
    expect(Array.isArray(envelope.uncertainties)).toBe(true);
    expect(Array.isArray(envelope.suggestedNextCalls)).toBe(true);
  });

  it('passes scope through to the engine', () => {
    const explicitRules = loadExplicitRules('repo-1', [mkRuleDef()]);
    const engine = new RulesEngine(explicitRules, []);
    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/x.ts',
        toPath: 'packages/db/src/y.ts',
      },
    ]);

    const envelope = checkInvariants(engine, handle, {
      scope: { path: 'packages/other/' },
    });

    // The scope filter should exclude the violation
    expect(envelope.data.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// picomatch brace expansion in RulesEngine forbidden_import matching
// ---------------------------------------------------------------------------

describe('RulesEngine with brace expansion patterns', () => {
  it('detects violation when from path matches brace-expanded pattern', () => {
    const explicitRules = loadExplicitRules('repo-1', [
      mkRuleDef({
        name: 'no-ui-to-db',
        from: { pathGlob: '{packages/api,packages/web}/**' },
        to: { pathGlob: 'packages/db/**' },
      }),
    ]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/web/src/page.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.ruleName).toBe('no-ui-to-db');
  });

  it('detects violation when to path matches brace-expanded pattern', () => {
    const explicitRules = loadExplicitRules('repo-1', [
      mkRuleDef({
        name: 'no-api-to-internal',
        from: { pathGlob: 'packages/api/**' },
        to: { pathGlob: '{packages/db,packages/internal}/**' },
      }),
    ]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/api/src/handler.ts',
        toPath: 'packages/internal/src/secret.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.ruleName).toBe('no-api-to-internal');
  });

  it('passes when edge does not match any brace-expanded alternative', () => {
    const explicitRules = loadExplicitRules('repo-1', [
      mkRuleDef({
        name: 'no-ui-to-db',
        from: { pathGlob: '{packages/api,packages/web}/**' },
        to: { pathGlob: 'packages/db/**' },
      }),
    ]);
    const engine = new RulesEngine(explicitRules, []);

    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'packages/cli/src/index.ts',
        toPath: 'packages/db/src/connection.ts',
      },
    ]);

    const result = engine.checkInvariants(handle);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkInvariants envelope wrapper with BoundaryContext
// ---------------------------------------------------------------------------

describe('checkInvariants with BoundaryContext', () => {
  it('detects cross-boundary violation for disallowed dependency', () => {
    const engine = new RulesEngine([], []);
    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'src/api/handler.ts',
        toPath: 'src/db/connection.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/connection.ts', { boundaryName: 'db', isPublic: true }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['utils'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const violations = result.data.violations;
    expect(violations.length).toBeGreaterThan(0);
    const boundaryViolation = violations.find(v => v.ruleId.startsWith('boundary:'));
    expect(boundaryViolation).toBeDefined();
  });

  it('allows cross-boundary import when dependency is listed', () => {
    const engine = new RulesEngine([], []);
    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'src/api/handler.ts',
        toPath: 'src/db/connection.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/connection.ts', { boundaryName: 'db', isPublic: true }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['db'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const boundaryViolations = result.data.violations.filter(v => v.ruleId.startsWith('boundary:'));
    expect(boundaryViolations).toHaveLength(0);
  });

  it('detects non-public file import violation', () => {
    const engine = new RulesEngine([], []);
    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'src/api/handler.ts',
        toPath: 'src/db/internal.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/internal.ts', { boundaryName: 'db', isPublic: false }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['db'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const violations = result.data.violations;
    const nonPublicViolation = violations.find(v => v.ruleId.includes('non-public'));
    expect(nonPublicViolation).toBeDefined();
  });

  it('ignores same-boundary imports', () => {
    const engine = new RulesEngine([], []);
    const handle = mkReadHandle([
      {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        fromPath: 'src/db/connection.ts',
        toPath: 'src/db/internal.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/db/connection.ts', { boundaryName: 'db', isPublic: true }],
        ['src/db/internal.ts', { boundaryName: 'db', isPublic: false }],
      ]),
      boundaries: new Map([
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const boundaryViolations = result.data.violations.filter(v => v.ruleId.startsWith('boundary:'));
    expect(boundaryViolations).toHaveLength(0);
  });
});
