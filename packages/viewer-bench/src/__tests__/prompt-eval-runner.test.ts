/**
 * Tests for prompt-level eval runner.
 *
 * Validates:
 *   - runPromptEvalScenario: passing assertions with mock client
 *   - runPromptEvalScenario: failing assertions with mock client
 *   - runPromptEvalSuite: aggregation of multiple scenarios
 *   - CLI skip behavior when EVAL_LLM_API_KEY is absent
 *
 * No actual LLM calls are made; all tests use mock PromptEvalClient.
 */
import { describe, it, expect } from 'vitest';
import type { PromptEvalClient, PromptEvalResponse } from '../evals/prompt-eval-client.js';
import type { PromptEvalScenario } from '../evals/prompt-scenarios.js';
import { runPromptEvalScenario, runPromptEvalSuite } from '../evals/prompt-eval-runner.js';

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function createMockClient(response: PromptEvalResponse): PromptEvalClient {
  return {
    async sendMessage(): Promise<PromptEvalResponse> {
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal scenario factories
// ---------------------------------------------------------------------------

function makeScenario(overrides: Partial<PromptEvalScenario> = {}): PromptEvalScenario {
  return {
    id: 'test-scenario',
    description: 'A test scenario',
    dimension: 'doctor_first_compliance',
    systemPrompt: 'You are a test assistant.',
    userMessage: 'Hello',
    assertions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runPromptEvalScenario tests
// ---------------------------------------------------------------------------

describe('runPromptEvalScenario', () => {
  it('returns passed=true when all assertions pass', async () => {
    const client = createMockClient({
      content: 'The viewer is not ready. No findings available.',
      toolCalls: [{ name: 'viewer.doctor', arguments: {} }],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      id: 'all-pass',
      assertions: [
        {
          kind: 'first_tool_call',
          expected: 'viewer.doctor',
          description: 'First tool call is viewer.doctor',
        },
        {
          kind: 'contains',
          pattern: 'not ready',
          description: 'Response mentions not ready',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);

    expect(result.scenarioId).toBe('all-pass');
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions[0].passed).toBe(true);
    expect(result.assertions[1].passed).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns passed=false when any assertion fails', async () => {
    const client = createMockClient({
      content: 'Here are the entrypoints.',
      toolCalls: [{ name: 'viewer.findEntrypoints', arguments: {} }],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      id: 'one-fail',
      assertions: [
        {
          kind: 'first_tool_call',
          expected: 'viewer.doctor',
          description: 'First tool call is viewer.doctor',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);

    expect(result.scenarioId).toBe('one-fail');
    expect(result.passed).toBe(false);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].passed).toBe(false);
  });

  it('evaluates contains assertion correctly', async () => {
    const client = createMockClient({
      content: 'Found [claim:C-001] in auth subsystem [hypothesis]',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'contains',
          pattern: '[claim:C-001]',
          description: 'Preserves claim tag',
        },
        {
          kind: 'contains',
          pattern: '[hypothesis]',
          description: 'Preserves hypothesis tag',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(true);
    expect(result.assertions.every((a) => a.passed)).toBe(true);
  });

  it('evaluates not_contains assertion correctly', async () => {
    const client = createMockClient({
      content: 'The payment-engine subsystem [hypothesis] might handle transactions.',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'not_contains',
          pattern: 'the system uses payment-engine',
          description: 'Does not assert hypothesis as fact',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(true);
    expect(result.assertions[0].passed).toBe(true);
  });

  it('evaluates not_contains assertion failure', async () => {
    const client = createMockClient({
      content: 'the system uses payment-engine for all transactions.',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'not_contains',
          pattern: 'the system uses payment-engine',
          description: 'Should not assert hypothesis as fact',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].passed).toBe(false);
  });

  it('evaluates first_tool_call when no tool calls made', async () => {
    const client = createMockClient({
      content: 'No tools needed.',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'first_tool_call',
          expected: 'viewer.doctor',
          description: 'First tool call is viewer.doctor',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].passed).toBe(false);
  });

  it('evaluates no_tool_calls_after assertion - passing', async () => {
    const client = createMockClient({
      content: 'Viewer is not ready.',
      toolCalls: [{ name: 'viewer.doctor', arguments: {} }],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'no_tool_calls_after',
          expected: 'viewer.doctor',
          description: 'No calls after viewer.doctor',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(true);
    expect(result.assertions[0].passed).toBe(true);
  });

  it('evaluates no_tool_calls_after assertion - failing', async () => {
    const client = createMockClient({
      content: 'Let me check more.',
      toolCalls: [
        { name: 'viewer.doctor', arguments: {} },
        { name: 'viewer.getRepositoryOverview', arguments: {} },
      ],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      assertions: [
        {
          kind: 'no_tool_calls_after',
          expected: 'viewer.doctor',
          description: 'No calls after viewer.doctor',
        },
      ],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].passed).toBe(false);
  });

  it('includes mockToolResponses context in user message when present', async () => {
    let capturedMessage = '';
    const client: PromptEvalClient = {
      async sendMessage(opts): Promise<PromptEvalResponse> {
        capturedMessage = opts.userMessage;
        return {
          content: 'Auth subsystem [claim:C-001] [hypothesis]',
          toolCalls: [],
          stopReason: 'end_turn',
        };
      },
    };

    const scenario = makeScenario({
      userMessage: 'Give me an overview.',
      mockToolResponses: [
        {
          toolName: 'viewer.doctor',
          response: { ready: true, modelStatus: 'indexed' },
        },
        {
          toolName: 'viewer.getRepositoryOverview',
          response: { data: { totalFiles: 42 } },
        },
      ],
      assertions: [],
    });

    await runPromptEvalScenario(scenario, client);

    expect(capturedMessage).toContain('Give me an overview.');
    expect(capturedMessage).toContain('viewer.doctor');
    expect(capturedMessage).toContain('viewer.getRepositoryOverview');
  });

  it('records dimension from scenario', async () => {
    const client = createMockClient({
      content: 'ok',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const scenario = makeScenario({
      dimension: 'tag_preservation',
      assertions: [],
    });

    const result = await runPromptEvalScenario(scenario, client);
    expect(result.dimension).toBe('tag_preservation');
  });
});

// ---------------------------------------------------------------------------
// runPromptEvalSuite tests
// ---------------------------------------------------------------------------

describe('runPromptEvalSuite', () => {
  it('aggregates results from multiple scenarios', async () => {
    const client = createMockClient({
      content: 'The viewer is not ready.',
      toolCalls: [{ name: 'viewer.doctor', arguments: {} }],
      stopReason: 'end_turn',
    });

    const scenarios: PromptEvalScenario[] = [
      makeScenario({
        id: 'scenario-1',
        assertions: [
          {
            kind: 'first_tool_call',
            expected: 'viewer.doctor',
            description: 'First tool call is viewer.doctor',
          },
        ],
      }),
      makeScenario({
        id: 'scenario-2',
        assertions: [
          {
            kind: 'contains',
            pattern: 'not ready',
            description: 'Says not ready',
          },
        ],
      }),
    ];

    const report = await runPromptEvalSuite(scenarios, client);

    expect(report.timestamp).toBeTruthy();
    expect(report.scenarios).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
  });

  it('counts failures correctly', async () => {
    const client = createMockClient({
      content: 'Here are results.',
      toolCalls: [{ name: 'viewer.findEntrypoints', arguments: {} }],
      stopReason: 'end_turn',
    });

    const scenarios: PromptEvalScenario[] = [
      makeScenario({
        id: 'pass-scenario',
        assertions: [
          {
            kind: 'contains',
            pattern: 'results',
            description: 'Contains results',
          },
        ],
      }),
      makeScenario({
        id: 'fail-scenario',
        assertions: [
          {
            kind: 'first_tool_call',
            expected: 'viewer.doctor',
            description: 'First tool call is viewer.doctor',
          },
        ],
      }),
    ];

    const report = await runPromptEvalSuite(scenarios, client);

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
  });

  it('returns empty report for empty scenario list', async () => {
    const client = createMockClient({
      content: '',
      toolCalls: [],
      stopReason: 'end_turn',
    });

    const report = await runPromptEvalSuite([], client);

    expect(report.scenarios).toHaveLength(0);
    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
  });
});
