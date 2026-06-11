/**
 * Tests for the 12 behavioral eval scenarios.
 *
 * Validates:
 *   - EVAL_SCENARIOS has exactly 12 entries
 *   - Each scenario has all required fields
 *   - All 4 dimensions are covered
 *   - Each scenario runs against a mock engine and assertions evaluate correctly
 *
 */
import { describe, it, expect } from 'vitest';
import { EVAL_SCENARIOS } from '../evals/scenarios.js';
import { runEvalScenario } from '../evals/eval-runner.js';
import type { EvalScenario } from '../types.js';
import type { EvalEngine } from '../evals/types.js';

// ---------------------------------------------------------------------------
// Mock engine responses: realistic ResultEnvelope shapes
// ---------------------------------------------------------------------------

function makeTagFidelityEngine(): EvalEngine {
  return {
    dispatch(op: string, _args: Record<string, unknown>): unknown {
      switch (op) {
        case 'getRepositoryOverview':
          return {
            data: {
              candidateSubsystems: [
                { id: 'sub-1', name: 'core', status: 'hypothesis' },
              ],
              mainLanguages: ['typescript'],
              totalFiles: 10,
              topClaims: [{ id: 'c-1', '[claim:c-1]': true }],
            },
            evidence: [
              { evidenceId: 'e-1', kind: 'source_span', '[evidence:e-1]': true },
            ],
            uncertainties: [
              { kind: 'low_confidence', severity: 'medium', message: 'hypothesis claim' },
            ],
            suggestedNextCalls: [{ tool: 'viewer.listClaims', reason: 'review claims' }],
            modelRevision: 'rev-001',
            '[claim:c-1]': true,
            '[hypothesis]': true,
          };
        case 'findEntrypoints':
          return {
            data: {
              candidates: [
                { id: 'n-1', name: 'index.ts', score: 0.9 },
              ],
            },
            evidence: [
              { evidenceId: 'e-2', kind: 'symbol_index_hit', '[evidence:e-2]': true },
            ],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
            '[evidence:e-2]': true,
          };
        case 'listUncertainties':
          return {
            data: [
              {
                kind: 'low_confidence',
                severity: 'medium',
                message: 'hypothesis claim below threshold',
                status: 'hypothesis',
                '[hypothesis]': true,
              },
              {
                kind: 'stale_claim',
                severity: 'low',
                message: 'claim freshness degraded',
                status: 'hypothesis',
              },
            ],
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        case 'doctor':
          return {
            data: {
              nodeVersion: 'v22.0.0',
              modelStatus: 'indexed',
              sqliteBinding: true,
              grammarAvailability: { typescript: true },
              effectiveBackend: 'treesitter',
            },
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        default:
          return null;
      }
    },
    close(): void { /* noop */ },
  };
}

function makeHypothesisStabilityEngine(): EvalEngine {
  let callCount = 0;
  return {
    dispatch(op: string, _args: Record<string, unknown>): unknown {
      callCount++;
      switch (op) {
        case 'listClaims':
          return {
            data: [
              {
                id: 'claim-1',
                status: 'hypothesis',
                confidence: 'low',
                claimType: 'file-defines-symbol',
              },
              {
                id: 'claim-2',
                status: 'hypothesis',
                confidence: 'low',
                claimType: 'directory-derived-subsystem-hypothesis',
              },
            ],
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        case 'findEntrypoints':
          return {
            data: {
              candidates: [
                { id: 'n-1', name: 'index.ts', score: 0.85 },
              ],
            },
            evidence: [{ evidenceId: 'e-1', kind: 'symbol_index_hit' }],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        case 'listUncertainties':
          return {
            data: [
              {
                kind: 'low_confidence',
                severity: 'medium',
                message: 'hypothesis sub-threshold claim',
                status: 'hypothesis',
              },
            ],
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        default:
          return null;
      }
    },
    close(): void { /* noop */ },
  };
}

function makeDoctorEngine(): EvalEngine {
  return {
    dispatch(op: string, _args: Record<string, unknown>): unknown {
      switch (op) {
        case 'doctor':
          return {
            data: {
              nodeVersion: 'v22.0.0',
              sqliteBinding: true,
              grammarAvailability: {
                typescript: true,
                json: true,
              },
              tsBackendAvailable: false,
              gitAvailable: true,
              modelStatus: 'indexed',
              effectiveBackend: 'treesitter',
              degradationReason: null,
              backendCoverage: {},
              grammars: {
                typescript: 'available',
                json: 'available',
                python: 'not_installed',
                rust: 'not_installed',
                go: 'not_installed',
              },
            },
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        case 'getRepositoryOverview':
          return {
            data: {
              candidateSubsystems: [
                { id: 'sub-1', name: 'core', status: 'hypothesis' },
              ],
              mainLanguages: ['typescript'],
              totalFiles: 5,
            },
            evidence: [],
            uncertainties: [],
            suggestedNextCalls: [],
            modelRevision: 'rev-001',
          };
        default:
          return null;
      }
    },
    close(): void { /* noop */ },
  };
}

function makeDegradationEngine(): EvalEngine {
  return {
    dispatch(op: string, args: Record<string, unknown>): unknown {
      switch (op) {
        case 'getRepositoryOverview':
          return {
            data: null,
            evidence: [],
            uncertainties: [
              {
                kind: 'no_model',
                severity: 'high',
                message: 'NoModelIndexedError: no model indexed',
              },
            ],
            suggestedNextCalls: [{ tool: 'viewer.index', reason: 'Index the repository first' }],
            modelRevision: '',
            error: 'NoModelIndexedError',
          };
        case 'buildClaimPayload': {
          const claimId = args['claimId'] as string;
          return {
            data: null,
            evidence: [],
            uncertainties: [
              {
                id: `err-claim-not-found-${claimId}`,
                kind: 'claim_not_found',
                severity: 'high',
                description: `Claim not found: ${claimId}`,
              },
            ],
            suggestedNextCalls: [
              { op: 'listClaims', args: {}, reason: 'List available claims' },
            ],
            modelRevision: 'rev-001',
          };
        }
        default:
          return null;
      }
    },
    close(): void { /* noop */ },
  };
}

// Map scenario IDs to appropriate mock engines
function engineForScenario(scenario: EvalScenario): EvalEngine {
  if (scenario.category === 'tag_fidelity') return makeTagFidelityEngine();
  if (scenario.category === 'hypothesis_stability') return makeHypothesisStabilityEngine();
  if (scenario.category === 'doctor_first') return makeDoctorEngine();
  if (scenario.category === 'graceful_degradation') return makeDegradationEngine();
  throw new Error(`Unknown category: ${scenario.category}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EVAL_SCENARIOS structure', () => {
  it('has exactly 12 entries', () => {
    expect(EVAL_SCENARIOS).toHaveLength(12);
  });

  it('each scenario has all required fields', () => {
    for (const scenario of EVAL_SCENARIOS) {
      expect(typeof scenario.id).toBe('string');
      expect(scenario.id.length).toBeGreaterThan(0);

      expect(typeof scenario.name).toBe('string');
      expect(scenario.name.length).toBeGreaterThan(0);

      expect(typeof scenario.description).toBe('string');
      expect(scenario.description.length).toBeGreaterThan(0);

      expect(['tag_fidelity', 'hypothesis_stability', 'doctor_first', 'graceful_degradation'])
        .toContain(scenario.category);

      expect(Array.isArray(scenario.operations)).toBe(true);
      expect(scenario.operations.length).toBeGreaterThan(0);

      expect(Array.isArray(scenario.assertions)).toBe(true);
      expect(scenario.assertions.length).toBeGreaterThan(0);
    }
  });

  it('each scenario has a unique id', () => {
    const ids = EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all 4 dimensions are covered', () => {
    const categories = new Set(EVAL_SCENARIOS.map((s) => s.category));
    expect(categories).toContain('tag_fidelity');
    expect(categories).toContain('hypothesis_stability');
    expect(categories).toContain('doctor_first');
    expect(categories).toContain('graceful_degradation');
    expect(categories.size).toBe(4);
  });

  it('has 4 tag_fidelity scenarios', () => {
    const count = EVAL_SCENARIOS.filter((s) => s.category === 'tag_fidelity').length;
    expect(count).toBe(4);
  });

  it('has 3 hypothesis_stability scenarios', () => {
    const count = EVAL_SCENARIOS.filter((s) => s.category === 'hypothesis_stability').length;
    expect(count).toBe(3);
  });

  it('has 3 doctor_first scenarios', () => {
    const count = EVAL_SCENARIOS.filter((s) => s.category === 'doctor_first').length;
    expect(count).toBe(3);
  });

  it('has 2 graceful_degradation scenarios', () => {
    const count = EVAL_SCENARIOS.filter((s) => s.category === 'graceful_degradation').length;
    expect(count).toBe(2);
  });

  it('every operation has op and args fields', () => {
    for (const scenario of EVAL_SCENARIOS) {
      for (const op of scenario.operations) {
        expect(typeof op.op).toBe('string');
        expect(op.op.length).toBeGreaterThan(0);
        expect(typeof op.args).toBe('object');
        expect(op.args).not.toBeNull();
      }
    }
  });

  it('every assertion has target, matcher, pattern, and description', () => {
    for (const scenario of EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        expect(['data', 'evidence', 'uncertainties', 'suggestedNextCalls', 'full_envelope'])
          .toContain(assertion.target);
        expect(['contains', 'not_contains', 'matches_regex', 'structural'])
          .toContain(assertion.matcher);
        expect(assertion.pattern).toBeDefined();
        expect(typeof assertion.description).toBe('string');
        expect(assertion.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('EVAL_SCENARIOS execution against mock engines', () => {
  for (const scenario of EVAL_SCENARIOS) {
    it(`${scenario.id}: all assertions pass with realistic mock`, async () => {
      const engine = engineForScenario(scenario);
      const result = await runEvalScenario(scenario, engine);

      expect(result.scenarioId).toBe(scenario.id);
      expect(result.scenarioName).toBe(scenario.name);
      expect(result.category).toBe(scenario.category);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      for (const assertion of result.assertions) {
        expect(assertion.passed).toBe(true);
        if (!assertion.passed) {
          // Provide diagnostic info on failure
          expect.fail(
            `Assertion failed for ${scenario.id}: ${assertion.description}\n` +
            `  Expected: ${assertion.expected}\n` +
            `  Actual: ${assertion.actual}\n` +
            `  Diff: ${assertion.diff ?? 'none'}`,
          );
        }
      }

      expect(result.passed).toBe(true);
    });
  }
});
