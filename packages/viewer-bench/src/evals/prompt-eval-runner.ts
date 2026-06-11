/**
 * Prompt-level eval runner for viewer-scout behavioral evals.
 *
 * Executes PromptEvalScenario sequences against a PromptEvalClient and
 * validates assertions against the LLM response. When no API key is set,
 * the CLI entry point (run-prompt-evals.ts) skips gracefully.
 */

import type {
  PromptEvalClient,
  PromptEvalResponse,
} from './prompt-eval-client.js';
import type {
  PromptEvalScenario,
  PromptAssertion,
  PromptEvalDimension,
} from './prompt-scenarios.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PromptAssertionResult {
  description: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface PromptEvalResult {
  scenarioId: string;
  dimension: PromptEvalDimension;
  passed: boolean;
  assertions: PromptAssertionResult[];
  durationMs: number;
}

export interface PromptEvalReport {
  timestamp: string;
  scenarios: PromptEvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

// ---------------------------------------------------------------------------
// Assertion evaluators
// ---------------------------------------------------------------------------

function evaluatePromptAssertion(
  assertion: PromptAssertion,
  response: PromptEvalResponse,
): PromptAssertionResult {
  switch (assertion.kind) {
    case 'first_tool_call':
      return evaluateFirstToolCall(assertion, response);
    case 'contains':
      return evaluateContains(assertion, response);
    case 'not_contains':
      return evaluateNotContains(assertion, response);
    case 'no_tool_calls_after':
      return evaluateNoToolCallsAfter(assertion, response);
  }
}

function evaluateFirstToolCall(
  assertion: PromptAssertion,
  response: PromptEvalResponse,
): PromptAssertionResult {
  const expected = assertion.expected ?? '';
  if (response.toolCalls.length === 0) {
    return {
      description: assertion.description,
      passed: false,
      expected: `first tool call to be "${expected}"`,
      actual: 'no tool calls made',
    };
  }
  const actual = response.toolCalls[0].name;
  return {
    description: assertion.description,
    passed: actual === expected,
    expected: `first tool call to be "${expected}"`,
    actual: `first tool call was "${actual}"`,
  };
}

function evaluateContains(
  assertion: PromptAssertion,
  response: PromptEvalResponse,
): PromptAssertionResult {
  const pattern = assertion.pattern ?? '';
  const found = response.content.includes(pattern);
  return {
    description: assertion.description,
    passed: found,
    expected: `response to contain "${pattern}"`,
    actual: found
      ? 'found in response'
      : `not found in: ${response.content.slice(0, 200)}`,
  };
}

function evaluateNotContains(
  assertion: PromptAssertion,
  response: PromptEvalResponse,
): PromptAssertionResult {
  const pattern = assertion.pattern ?? '';
  const found = response.content.includes(pattern);
  return {
    description: assertion.description,
    passed: !found,
    expected: `response to NOT contain "${pattern}"`,
    actual: found ? 'found in response' : 'not found (correct)',
  };
}

function evaluateNoToolCallsAfter(
  assertion: PromptAssertion,
  response: PromptEvalResponse,
): PromptAssertionResult {
  const targetTool = assertion.expected ?? '';
  const idx = response.toolCalls.findIndex((tc) => tc.name === targetTool);

  if (idx === -1) {
    return {
      description: assertion.description,
      passed: false,
      expected: `tool "${targetTool}" to be called`,
      actual: `"${targetTool}" was never called`,
    };
  }

  const callsAfter = response.toolCalls.slice(idx + 1);
  const passed = callsAfter.length === 0;
  return {
    description: assertion.description,
    passed,
    expected: `no tool calls after "${targetTool}"`,
    actual: passed
      ? 'no subsequent calls (correct)'
      : `${callsAfter.length} call(s) after: ${callsAfter.map((c) => c.name).join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Mock tool response context builder
// ---------------------------------------------------------------------------

function buildUserMessage(scenario: PromptEvalScenario): string {
  if (!scenario.mockToolResponses || scenario.mockToolResponses.length === 0) {
    return scenario.userMessage;
  }

  const mockContext = scenario.mockToolResponses
    .map(
      (mock) =>
        `[Mock tool response for ${mock.toolName}]:\n${JSON.stringify(mock.response, null, 2)}`,
    )
    .join('\n\n');

  return `${scenario.userMessage}\n\n--- Mock Tool Responses (use these as if they were real tool call results) ---\n\n${mockContext}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single prompt-level eval scenario against the provided LLM client.
 */
export async function runPromptEvalScenario(
  scenario: PromptEvalScenario,
  client: PromptEvalClient,
): Promise<PromptEvalResult> {
  const start = performance.now();

  const userMessage = buildUserMessage(scenario);

  const response = await client.sendMessage({
    systemPrompt: scenario.systemPrompt,
    userMessage,
    temperature: 0,
  });

  const assertionResults = scenario.assertions.map((assertion) =>
    evaluatePromptAssertion(assertion, response),
  );

  const allPassed = assertionResults.every((a) => a.passed);
  const durationMs = performance.now() - start;

  return {
    scenarioId: scenario.id,
    dimension: scenario.dimension,
    passed: allPassed,
    assertions: assertionResults,
    durationMs,
  };
}

/**
 * Run a suite of prompt-level eval scenarios and aggregate results.
 */
export async function runPromptEvalSuite(
  scenarios: readonly PromptEvalScenario[] | PromptEvalScenario[],
  client: PromptEvalClient,
): Promise<PromptEvalReport> {
  const results: PromptEvalResult[] = [];

  for (const scenario of scenarios) {
    const result = await runPromptEvalScenario(scenario, client);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    timestamp: new Date().toISOString(),
    scenarios: results,
    summary: {
      total: results.length,
      passed,
      failed,
    },
  };
}
