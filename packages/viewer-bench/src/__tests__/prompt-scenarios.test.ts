/**
 * Tests for PROMPT_EVAL_SCENARIOS data structure.
 *
 * Validates:
 *   - At least 4 scenarios exist
 *   - All 4 dimensions are covered
 *   - Each scenario has all required fields
 *   - Each scenario has a unique id
 *   - System prompts contain viewer-scout content
 *   - Assertions are well-formed
 */
import { describe, it, expect } from 'vitest';
import {
  PROMPT_EVAL_SCENARIOS,
  VIEWER_SCOUT_SYSTEM_PROMPT,
  type PromptEvalScenario,
  type PromptAssertion,
  type PromptEvalDimension,
  type MockToolResponse,
} from '../evals/prompt-scenarios.js';

// ---------------------------------------------------------------------------
// Structure tests
// ---------------------------------------------------------------------------

describe('PROMPT_EVAL_SCENARIOS structure', () => {
  it('has at least 4 entries', () => {
    expect(PROMPT_EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(4);
  });

  it('each scenario has all required fields', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      expect(typeof scenario.id).toBe('string');
      expect(scenario.id.length).toBeGreaterThan(0);

      expect(typeof scenario.description).toBe('string');
      expect(scenario.description.length).toBeGreaterThan(0);

      const validDimensions: PromptEvalDimension[] = [
        'doctor_first_compliance',
        'tag_preservation',
        'hypothesis_stability',
        'graceful_unready',
      ];
      expect(validDimensions).toContain(scenario.dimension);

      expect(typeof scenario.systemPrompt).toBe('string');
      expect(scenario.systemPrompt.length).toBeGreaterThan(0);

      expect(typeof scenario.userMessage).toBe('string');
      expect(scenario.userMessage.length).toBeGreaterThan(0);

      expect(Array.isArray(scenario.assertions)).toBe(true);
      expect(scenario.assertions.length).toBeGreaterThan(0);
    }
  });

  it('each scenario has a unique id', () => {
    const ids = PROMPT_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all 4 dimensions', () => {
    const dimensions = new Set(PROMPT_EVAL_SCENARIOS.map((s) => s.dimension));
    expect(dimensions).toContain('doctor_first_compliance');
    expect(dimensions).toContain('tag_preservation');
    expect(dimensions).toContain('hypothesis_stability');
    expect(dimensions).toContain('graceful_unready');
    expect(dimensions.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// System prompt tests
// ---------------------------------------------------------------------------

describe('VIEWER_SCOUT_SYSTEM_PROMPT', () => {
  it('contains the viewer-scout agent name', () => {
    expect(VIEWER_SCOUT_SYSTEM_PROMPT).toContain('viewer-scout');
  });

  it('contains the Tool Order section', () => {
    expect(VIEWER_SCOUT_SYSTEM_PROMPT).toContain('## Tool Order');
  });

  it('contains the Operating Rules section', () => {
    expect(VIEWER_SCOUT_SYSTEM_PROMPT).toContain('## Operating Rules');
  });

  it('references viewer.doctor in Tool Order', () => {
    expect(VIEWER_SCOUT_SYSTEM_PROMPT).toContain('viewer.doctor');
  });

  it('every scenario uses the canonical system prompt', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      expect(scenario.systemPrompt).toBe(VIEWER_SCOUT_SYSTEM_PROMPT);
    }
  });
});

// ---------------------------------------------------------------------------
// Assertion shape tests
// ---------------------------------------------------------------------------

describe('PromptAssertion shape', () => {
  const validKinds = ['first_tool_call', 'contains', 'not_contains', 'no_tool_calls_after'];

  it('every assertion has a valid kind', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        expect(validKinds).toContain(assertion.kind);
      }
    }
  });

  it('every assertion has a non-empty description', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        expect(typeof assertion.description).toBe('string');
        expect(assertion.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('first_tool_call assertions have expected field', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        if (assertion.kind === 'first_tool_call') {
          expect(typeof assertion.expected).toBe('string');
          expect(assertion.expected!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('contains and not_contains assertions have pattern field', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        if (assertion.kind === 'contains' || assertion.kind === 'not_contains') {
          expect(typeof assertion.pattern).toBe('string');
          expect(assertion.pattern!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('no_tool_calls_after assertions have expected field', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        if (assertion.kind === 'no_tool_calls_after') {
          expect(typeof assertion.expected).toBe('string');
          expect(assertion.expected!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Per-scenario content tests
// ---------------------------------------------------------------------------

describe('doctor-first-compliance scenario', () => {
  const scenario = PROMPT_EVAL_SCENARIOS.find((s) => s.id === 'doctor-first-compliance')!;

  it('exists', () => {
    expect(scenario).toBeDefined();
  });

  it('has dimension doctor_first_compliance', () => {
    expect(scenario.dimension).toBe('doctor_first_compliance');
  });

  it('has a first_tool_call assertion targeting viewer.doctor', () => {
    const assertion = scenario.assertions.find((a) => a.kind === 'first_tool_call');
    expect(assertion).toBeDefined();
    expect(assertion!.expected).toBe('viewer.doctor');
  });
});

describe('tag-preservation-in-summary scenario', () => {
  const scenario = PROMPT_EVAL_SCENARIOS.find((s) => s.id === 'tag-preservation-in-summary')!;

  it('exists', () => {
    expect(scenario).toBeDefined();
  });

  it('has dimension tag_preservation', () => {
    expect(scenario.dimension).toBe('tag_preservation');
  });

  it('has mock tool responses', () => {
    expect(scenario.mockToolResponses).toBeDefined();
    expect(scenario.mockToolResponses!.length).toBeGreaterThan(0);
  });

  it('asserts [claim:C-001] is preserved', () => {
    const assertion = scenario.assertions.find(
      (a) => a.kind === 'contains' && a.pattern === '[claim:C-001]',
    );
    expect(assertion).toBeDefined();
  });

  it('asserts [hypothesis] is preserved', () => {
    const assertion = scenario.assertions.find(
      (a) => a.kind === 'contains' && a.pattern === '[hypothesis]',
    );
    expect(assertion).toBeDefined();
  });

  it('mock responses contain the tags to preserve', () => {
    const overviewMock = scenario.mockToolResponses!.find(
      (m) => m.toolName === 'viewer.getRepositoryOverview',
    );
    expect(overviewMock).toBeDefined();
    const responseStr = JSON.stringify(overviewMock!.response);
    expect(responseStr).toContain('[claim:C-001]');
    expect(responseStr).toContain('[hypothesis]');
  });
});

describe('hypothesis-not-promoted scenario', () => {
  const scenario = PROMPT_EVAL_SCENARIOS.find((s) => s.id === 'hypothesis-not-promoted')!;

  it('exists', () => {
    expect(scenario).toBeDefined();
  });

  it('has dimension hypothesis_stability', () => {
    expect(scenario.dimension).toBe('hypothesis_stability');
  });

  it('has not_contains assertions for assertive language', () => {
    const notContainsAssertions = scenario.assertions.filter(
      (a) => a.kind === 'not_contains',
    );
    expect(notContainsAssertions.length).toBeGreaterThanOrEqual(2);
  });

  it('has a contains assertion for [hypothesis] tag preservation', () => {
    const assertion = scenario.assertions.find(
      (a) => a.kind === 'contains' && a.pattern === '[hypothesis]',
    );
    expect(assertion).toBeDefined();
  });
});

describe('graceful-unready scenario', () => {
  const scenario = PROMPT_EVAL_SCENARIOS.find((s) => s.id === 'graceful-unready')!;

  it('exists', () => {
    expect(scenario).toBeDefined();
  });

  it('has dimension graceful_unready', () => {
    expect(scenario.dimension).toBe('graceful_unready');
  });

  it('mock doctor response has ready: false', () => {
    const doctorMock = scenario.mockToolResponses!.find(
      (m) => m.toolName === 'viewer.doctor',
    );
    expect(doctorMock).toBeDefined();
    expect(doctorMock!.response.ready).toBe(false);
  });

  it('asserts response mentions not ready', () => {
    const assertion = scenario.assertions.find(
      (a) => a.kind === 'contains' && a.pattern === 'not ready',
    );
    expect(assertion).toBeDefined();
  });

  it('asserts no tool calls after doctor', () => {
    const assertion = scenario.assertions.find(
      (a) => a.kind === 'no_tool_calls_after',
    );
    expect(assertion).toBeDefined();
    expect(assertion!.expected).toBe('viewer.doctor');
  });
});

// ---------------------------------------------------------------------------
// MockToolResponse shape tests
// ---------------------------------------------------------------------------

describe('MockToolResponse shape', () => {
  it('every mockToolResponse has toolName and response', () => {
    for (const scenario of PROMPT_EVAL_SCENARIOS) {
      if (scenario.mockToolResponses) {
        for (const mock of scenario.mockToolResponses) {
          expect(typeof mock.toolName).toBe('string');
          expect(mock.toolName.length).toBeGreaterThan(0);
          expect(typeof mock.response).toBe('object');
          expect(mock.response).not.toBeNull();
        }
      }
    }
  });
});
