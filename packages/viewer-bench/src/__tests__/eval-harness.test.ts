/**
 * Tests for the behavioral eval harness.
 *
 */
import { describe, it, expect } from 'vitest';
import { runEvalScenario, runEvalSuite } from '../evals/eval-runner.js';
import { evaluateAssertion } from '../evals/matchers.js';
import type {
  EvalScenario,
  EvalAssertion,
  EvalEngine,
  EvalResult,
  EvalReport,
} from '../evals/types.js';

function makeMockEngine(results: Record<string, unknown>): EvalEngine {
  return {
    dispatch(op: string, _args: Record<string, unknown>): unknown {
      return results[op] ?? null;
    },
    close(): void {
      /* noop */
    },
  };
}

const ENVELOPE_WITH_DATA = {
  query: { operation: 'test', params: {} },
  data: {
    subsystems: [{ id: 's1', name: 'core', status: 'hypothesis' }],
    tags: ['[hypothesis]', '[claim:c1]', '[evidence:e1]'],
  },
  evidence: [{ id: 'e1', kind: 'source_node', anchor: 'file.ts' }],
  uncertainties: [
    { kind: 'partial_extraction', severity: 'medium', message: 'Some files skipped' },
  ],
  suggestedNextCalls: [{ tool: 'viewer.listClaims', reason: 'inspect claims' }],
  modelRevision: 'abc123',
};

describe('evaluateAssertion', () => {
  it('contains matcher passes when pattern is found in stringified target', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'contains',
      pattern: 'hypothesis',
      description: 'data contains hypothesis',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('contains matcher fails when pattern is not found', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'contains',
      pattern: 'nonexistent_value_xyz',
      description: 'data contains nonexistent',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
    expect(result.expected).toContain('nonexistent_value_xyz');
  });

  it('not_contains matcher passes when pattern is absent', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'not_contains',
      pattern: 'nonexistent_value_xyz',
      description: 'data does not contain nonexistent',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('not_contains matcher fails when pattern is present', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'not_contains',
      pattern: 'hypothesis',
      description: 'data does not contain hypothesis',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
  });

  it('matches_regex matcher passes on valid regex match', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'matches_regex',
      pattern: '\\[hypothesis\\]',
      description: 'data matches hypothesis tag regex',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('matches_regex matcher fails on no match', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'matches_regex',
      pattern: '\\[missing_tag\\]',
      description: 'data matches missing tag',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
  });

  it('structural matcher checks field presence', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['subsystems', 'tags'] },
      description: 'data has subsystems and tags fields',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('structural matcher fails on missing field', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'structural',
      pattern: { fieldPresence: ['subsystems', 'nonexistent'] },
      description: 'data has nonexistent field',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
    expect(result.diff).toContain('nonexistent');
  });

  it('structural matcher checks field values', () => {
    const assertion: EvalAssertion = {
      target: 'evidence',
      matcher: 'structural',
      pattern: { fieldValue: { length: 1 } },
      description: 'evidence has exactly one entry',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('structural matcher fails on wrong field value', () => {
    const assertion: EvalAssertion = {
      target: 'evidence',
      matcher: 'structural',
      pattern: { fieldValue: { length: 5 } },
      description: 'evidence has 5 entries',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
  });

  it('structural matcher checks minLength', () => {
    const assertion: EvalAssertion = {
      target: 'uncertainties',
      matcher: 'structural',
      pattern: { minLength: 1 },
      description: 'at least one uncertainty',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('structural matcher fails on minLength violation', () => {
    const assertion: EvalAssertion = {
      target: 'uncertainties',
      matcher: 'structural',
      pattern: { minLength: 10 },
      description: 'at least 10 uncertainties',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(false);
  });

  it('handles full_envelope target', () => {
    const assertion: EvalAssertion = {
      target: 'full_envelope',
      matcher: 'contains',
      pattern: 'modelRevision',
      description: 'envelope contains modelRevision',
    };
    const result = evaluateAssertion(assertion, ENVELOPE_WITH_DATA);
    expect(result.passed).toBe(true);
  });

  it('handles null envelope gracefully', () => {
    const assertion: EvalAssertion = {
      target: 'data',
      matcher: 'contains',
      pattern: 'anything',
      description: 'works with null',
    };
    const result = evaluateAssertion(assertion, null);
    expect(result.passed).toBe(false);
  });
});

describe('runEvalScenario', () => {
  it('runs a simple scenario with one operation and one passing assertion', async () => {
    const scenario: EvalScenario = {
      id: 'test-simple',
      name: 'Simple test',
      category: 'tag_fidelity',
      description: 'A minimal passing scenario',

      operations: [{ op: 'getRepositoryOverview', args: {} }],
      assertions: [
        {
          target: 'data',
          matcher: 'contains',
          pattern: 'hello',
          description: 'data contains hello',
        },
      ],
    };

    const engine = makeMockEngine({
      getRepositoryOverview: { data: 'hello world', evidence: [], uncertainties: [], suggestedNextCalls: [] },
    });

    const result = await runEvalScenario(scenario, engine);
    expect(result.scenarioId).toBe('test-simple');
    expect(result.scenarioName).toBe('Simple test');
    expect(result.category).toBe('tag_fidelity');
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].passed).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports failure when an assertion does not pass', async () => {
    const scenario: EvalScenario = {
      id: 'test-fail',
      name: 'Failing test',
      category: 'hypothesis_stability',
      description: 'A scenario that should fail',

      operations: [{ op: 'listClaims', args: {} }],
      assertions: [
        {
          target: 'data',
          matcher: 'contains',
          pattern: 'should_not_exist',
          description: 'data contains missing value',
        },
      ],
    };

    const engine = makeMockEngine({
      listClaims: { data: { claims: [] }, evidence: [], uncertainties: [], suggestedNextCalls: [] },
    });

    const result = await runEvalScenario(scenario, engine);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].passed).toBe(false);
  });

  it('executes multiple operations in order', async () => {
    const callOrder: string[] = [];
    const engine: EvalEngine = {
      dispatch(op: string, _args: Record<string, unknown>): unknown {
        callOrder.push(op);
        return { data: { op }, evidence: [], uncertainties: [], suggestedNextCalls: [] };
      },
      close(): void {
        /* noop */
      },
    };

    const scenario: EvalScenario = {
      id: 'test-order',
      name: 'Operation order',
      category: 'doctor_first',
      description: 'Operations execute in sequence',

      operations: [
        { op: 'doctor', args: {} },
        { op: 'getRepositoryOverview', args: {} },
        { op: 'listClaims', args: {} },
      ],
      assertions: [
        {
          target: 'full_envelope',
          matcher: 'contains',
          pattern: 'listClaims',
          description: 'last result is from listClaims',
        },
      ],
    };

    await runEvalScenario(scenario, engine);
    expect(callOrder).toEqual(['doctor', 'getRepositoryOverview', 'listClaims']);
  });

  it('handles operation repeat count', async () => {
    let callCount = 0;
    const engine: EvalEngine = {
      dispatch(_op: string, _args: Record<string, unknown>): unknown {
        callCount++;
        return { data: { count: callCount }, evidence: [], uncertainties: [], suggestedNextCalls: [] };
      },
      close(): void {
        /* noop */
      },
    };

    const scenario: EvalScenario = {
      id: 'test-repeat',
      name: 'Repeat operations',
      category: 'hypothesis_stability',
      description: 'Operations can repeat',

      operations: [{ op: 'getRepositoryOverview', args: {}, repeat: 3 }],
      assertions: [
        {
          target: 'data',
          matcher: 'structural',
          pattern: { fieldValue: { count: 3 } },
          description: 'last call is the third',
        },
      ],
    };

    const result = await runEvalScenario(scenario, engine);
    expect(callCount).toBe(3);
    expect(result.passed).toBe(true);
  });

  it('handles multiple assertions with mixed results', async () => {
    const engine = makeMockEngine({
      getRepositoryOverview: {
        data: { status: 'hypothesis', tags: ['[hypothesis]'] },
        evidence: [{ id: 'e1' }],
        uncertainties: [],
        suggestedNextCalls: [],
      },
    });

    const scenario: EvalScenario = {
      id: 'test-mixed',
      name: 'Mixed assertions',
      category: 'tag_fidelity',
      description: 'Some pass, some fail',

      operations: [{ op: 'getRepositoryOverview', args: {} }],
      assertions: [
        {
          target: 'data',
          matcher: 'contains',
          pattern: 'hypothesis',
          description: 'passes: contains hypothesis',
        },
        {
          target: 'data',
          matcher: 'contains',
          pattern: 'nonexistent',
          description: 'fails: contains nonexistent',
        },
      ],
    };

    const result = await runEvalScenario(scenario, engine);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].passed).toBe(true);
    expect(result.assertions[1].passed).toBe(false);
  });
});

describe('runEvalSuite', () => {
  it('aggregates results across scenarios', async () => {
    const engine = makeMockEngine({
      getRepositoryOverview: {
        data: 'hello',
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
      },
      listClaims: {
        data: 'world',
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
      },
    });

    const scenarios: EvalScenario[] = [
      {
        id: 'suite-pass',
        name: 'Passing scenario',
        category: 'tag_fidelity',
        description: 'Should pass',
  
        operations: [{ op: 'getRepositoryOverview', args: {} }],
        assertions: [
          { target: 'data', matcher: 'contains', pattern: 'hello', description: 'pass' },
        ],
      },
      {
        id: 'suite-fail',
        name: 'Failing scenario',
        category: 'graceful_degradation',
        description: 'Should fail',
  
        operations: [{ op: 'listClaims', args: {} }],
        assertions: [
          { target: 'data', matcher: 'contains', pattern: 'missing', description: 'fail' },
        ],
      },
    ];

    const report = await runEvalSuite(scenarios, engine);
    expect(report.scenarios).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.timestamp).toBeTruthy();
  });

  it('returns all-passed summary when every scenario passes', async () => {
    const engine = makeMockEngine({
      doctor: { data: { ok: true }, evidence: [], uncertainties: [], suggestedNextCalls: [] },
    });

    const scenarios: EvalScenario[] = [
      {
        id: 's1',
        name: 'Scenario 1',
        category: 'doctor_first',
        description: 'Pass 1',
  
        operations: [{ op: 'doctor', args: {} }],
        assertions: [
          { target: 'data', matcher: 'contains', pattern: 'ok', description: 'contains ok' },
        ],
      },
      {
        id: 's2',
        name: 'Scenario 2',
        category: 'doctor_first',
        description: 'Pass 2',
  
        operations: [{ op: 'doctor', args: {} }],
        assertions: [
          { target: 'data', matcher: 'contains', pattern: 'true', description: 'contains true' },
        ],
      },
    ];

    const report = await runEvalSuite(scenarios, engine);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
  });

  it('handles empty scenario list', async () => {
    const engine = makeMockEngine({});
    const report = await runEvalSuite([], engine);
    expect(report.scenarios).toHaveLength(0);
    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
  });
});
