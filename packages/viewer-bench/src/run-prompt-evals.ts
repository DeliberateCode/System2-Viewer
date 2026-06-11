/**
 * CLI entry point for `npm run bench:prompt-evals`.
 *
 * Checks for EVAL_LLM_API_KEY. If absent, prints a skip message and exits 0.
 * If present, creates an Anthropic client, runs all prompt-level eval
 * scenarios, prints results, and exits 0 (advisory, never blocking).
 *
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_EVAL_SCENARIOS } from './evals/prompt-scenarios.js';
import { createAnthropicClient } from './evals/anthropic-adapter.js';
import { runPromptEvalSuite } from './evals/prompt-eval-runner.js';
import type { PromptEvalReport } from './evals/prompt-eval-runner.js';

function formatPromptEvalReport(report: PromptEvalReport): string {
  const lines: string[] = [];
  lines.push('=== Prompt Eval Report ===');
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(
    `Total: ${report.summary.total}  Passed: ${report.summary.passed}  Failed: ${report.summary.failed}`,
  );
  lines.push('');

  for (const scenario of report.scenarios) {
    const status = scenario.passed ? 'PASS' : 'FAIL';
    lines.push(
      `  [${status}] ${scenario.scenarioId} (${scenario.dimension}) ${scenario.durationMs.toFixed(1)}ms`,
    );
    for (const assertion of scenario.assertions) {
      if (!assertion.passed) {
        lines.push(`         FAIL: ${assertion.description}`);
        lines.push(`           expected: ${assertion.expected}`);
        lines.push(`           actual:   ${assertion.actual}`);
      }
    }
  }

  lines.push('');
  if (report.summary.failed === 0) {
    lines.push('All prompt eval scenarios passed.');
  } else {
    lines.push(`${report.summary.failed} prompt eval scenario(s) failed.`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const client = await createAnthropicClient();

  if (!client) {
    console.log(
      `Skipping prompt evals (EVAL_LLM_API_KEY not set). ${PROMPT_EVAL_SCENARIOS.length} scenario(s) skipped.`,
    );
    return;
  }

  const report = await runPromptEvalSuite(PROMPT_EVAL_SCENARIOS, client);
  const output = formatPromptEvalReport(report);
  console.log(output);

  // Write structured JSON report
  const benchDir = join('.system2-viewer', 'bench');
  mkdirSync(benchDir, { recursive: true });
  const ts = report.timestamp.replace(/[:.]/g, '-');
  const reportPath = join(benchDir, `prompt-eval-${ts}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nJSON report written to ${reportPath}`);

  // Advisory only: prompt eval failures never block CI.
  // Exit 0 regardless of pass/fail.
}

main().catch((err: unknown) => {
  console.error('Prompt eval runner failed:', err);
  process.exitCode = 1;
});
