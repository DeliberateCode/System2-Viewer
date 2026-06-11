/**
 * Symbol coverage evaluator for viewer-bench.
 *
 * Compares extracted symbols against golden fixture expectations
 * to measure extraction accuracy (precision, recall, match rate).
 */
import type { GoldenFixture } from './golden-fixture.js';
import type { CoverageResult } from './types.js';

export interface ExtractionResultLike {
  symbols: Array<{ name: string; kind: string; exported: boolean; startLine: number; endLine: number }>;
  imports: Array<{ specifier: string; names: string[]; isTypeOnly: boolean; line: number }>;
  language: string;
  partial: boolean;
  partialReason?: string;
}

export type ExtractionFn = (
  filePath: string,
  content: string,
  language?: string,
) => Promise<ExtractionResultLike>;

/**
 * Evaluate symbol extraction coverage against golden fixtures.
 *
 * For each fixture, calls `extractFn` with the fixture's source content,
 * then compares the extracted symbol names against the expected symbol names.
 * Returns per-language and aggregate metrics.
 */
export async function evaluateCoverage(
  fixtures: GoldenFixture[],
  extractFn: ExtractionFn,
): Promise<CoverageResult> {
  const perLanguage: CoverageResult['perLanguage'] = {};

  for (const fixture of fixtures) {
    const result = await extractFn(
      `golden.${fixture.language}`,
      fixture.sourceFile,
      fixture.language,
    );

    const expectedNames = new Set(fixture.expectedSymbols.map((s) => s.name));
    const actualNames = new Set(result.symbols.map((s) => s.name));

    const missing: string[] = [];
    for (const name of expectedNames) {
      if (!actualNames.has(name)) missing.push(name);
    }

    const extra: string[] = [];
    for (const name of actualNames) {
      if (!expectedNames.has(name)) extra.push(name);
    }

    const matchCount = expectedNames.size - missing.length;
    const matchRate = expectedNames.size === 0 ? 1 : matchCount / expectedNames.size;

    perLanguage[fixture.language] = {
      expected: expectedNames.size,
      actual: actualNames.size,
      missing,
      extra,
      matchRate,
    };
  }

  let totalExpected = 0;
  let totalActual = 0;
  let totalMissing = 0;
  let totalExtra = 0;

  for (const entry of Object.values(perLanguage)) {
    totalExpected += entry.expected;
    totalActual += entry.actual;
    totalMissing += entry.missing.length;
    totalExtra += entry.extra.length;
  }

  return {
    perLanguage,
    overall: {
      expected: totalExpected,
      actual: totalActual,
      missing: totalMissing,
      extra: totalExtra,
    },
  };
}
