/**
 * Backend comparison reporter for viewer-bench.
 *
 * Runs symbol coverage evaluation across multiple extraction backends
 * and produces a side-by-side comparison. Currently only tree-sitter
 * exists; the structure is ready for future LSP backends.
 */
import type { GoldenFixture } from './golden-fixture.js';
import type { CoverageResult } from './types.js';
import { evaluateCoverage, type ExtractionFn } from './coverage-eval.js';

export interface BackendCoverageEntry {
  name: string;
  coverage: CoverageResult;
}

export interface BackendComparisonResult {
  backends: BackendCoverageEntry[];
}

/**
 * Compare symbol coverage across multiple extraction backends.
 *
 * For each named backend, runs `evaluateCoverage` against the provided
 * golden fixtures and collects the results into a comparison report.
 */
export async function compareBackends(
  fixtures: GoldenFixture[],
  backends: Record<string, ExtractionFn>,
): Promise<BackendComparisonResult> {
  const entries: BackendCoverageEntry[] = [];

  for (const [name, extractFn] of Object.entries(backends)) {
    const coverage = await evaluateCoverage(fixtures, extractFn);
    entries.push({ name, coverage });
  }

  return { backends: entries };
}
