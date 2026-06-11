/**
 * CLI entry point for `npm run bench:evals`.
 *
 * Creates an eval engine from viewer-bench's allowed dependencies,
 * indexes a small fixture, runs all 12 scenarios, and prints results.
 *
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EVAL_SCENARIOS } from './evals/scenarios.js';
import { runEvalSuite } from './evals/eval-runner.js';
import { createEvalEngine } from './evals/engine-adapter.js';
import { generateFixture } from './fixture-gen.js';
import type { EvalReport } from './types.js';

function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push('=== Eval Report ===');
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Total: ${report.summary.total}  Passed: ${report.summary.passed}  Failed: ${report.summary.failed}`);
  lines.push('');

  for (const scenario of report.scenarios) {
    const status = scenario.passed ? 'PASS' : 'FAIL';
    lines.push(`  [${status}] ${scenario.scenarioId} (${scenario.category}) ${scenario.durationMs.toFixed(1)}ms`);
    for (const assertion of scenario.assertions) {
      if (!assertion.passed) {
        lines.push(`         FAIL: ${assertion.description}`);
        lines.push(`           expected: ${assertion.expected}`);
        lines.push(`           actual:   ${assertion.actual}`);
        if (assertion.diff) {
          lines.push(`           diff:     ${assertion.diff}`);
        }
      }
    }
  }

  lines.push('');
  if (report.summary.failed === 0) {
    lines.push('All scenarios passed.');
  } else {
    lines.push(`${report.summary.failed} scenario(s) failed.`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'eval-fixture-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'eval-data-'));

  try {
    generateFixture({
      languages: { typescript: 10, python: 0, rust: 0, go: 0 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });

    try {
      const report = await runEvalSuite([...EVAL_SCENARIOS], engine);
      const output = formatEvalReport(report);
      console.log(output);

      if (report.summary.failed > 0) {
        process.exitCode = 1;
      }
    } finally {
      engine.close();
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('Eval runner failed:', err);
  process.exitCode = 1;
});
