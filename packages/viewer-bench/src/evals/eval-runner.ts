/**
 * Behavioral eval runner for viewer-scout.
 *
 * Executes EvalScenario sequences against an EvalEngine and validates
 * assertions. Deterministic: no LLM dependency, no network calls.
 *
 */

import type { EvalScenario, EvalResult, EvalReport, EvalEngine } from './types.js';
import { evaluateAssertion } from './matchers.js';

/**
 * Run a single eval scenario against the provided engine.
 *
 * Steps:
 *  1. Execute the scenario's operations in order
 *  2. Run assertions against the last operation result
 *  3. Record pass/fail for each assertion with evidence
 */
export async function runEvalScenario(
  scenario: EvalScenario,
  engine: EvalEngine,
): Promise<EvalResult> {
  const start = performance.now();
  let lastResult: unknown = null;

  for (const op of scenario.operations) {
    const count = op.repeat ?? 1;
    for (let i = 0; i < count; i++) {
      const raw = engine.dispatch(op.op, op.args);
      lastResult = raw instanceof Promise ? await raw : raw;
    }
  }

  const assertionResults = scenario.assertions.map((assertion) => {
    const matchResult = evaluateAssertion(assertion, lastResult);
    return {
      description: assertion.description,
      passed: matchResult.passed,
      expected: matchResult.expected,
      actual: matchResult.actual,
      diff: matchResult.diff,
    };
  });

  const allPassed = assertionResults.every((a) => a.passed);
  const durationMs = performance.now() - start;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    category: scenario.category,
    passed: allPassed,
    assertions: assertionResults,
    durationMs,
  };
}

/**
 * Run a suite of eval scenarios and aggregate results into a report.
 */
export async function runEvalSuite(
  scenarios: EvalScenario[],
  engine: EvalEngine,
): Promise<EvalReport> {
  const results: EvalResult[] = [];

  for (const scenario of scenarios) {
    const result = await runEvalScenario(scenario, engine);
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
