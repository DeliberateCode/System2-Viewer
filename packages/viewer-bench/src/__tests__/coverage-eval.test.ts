/**
 * Tests for the symbol coverage evaluator and backend comparison reporter.
 *
 */
import { describe, it, expect } from 'vitest';
import { evaluateCoverage, type ExtractionFn } from '../coverage-eval.js';
import { compareBackends } from '../backend-compare.js';
import {
  GOLDEN_FIXTURES,
  type GoldenFixture,
  type ExpectedSymbol,
} from '../golden-fixture.js';
import type { CoverageResult } from '../types.js';

// --- Helpers ---

/** Build a mock extraction function that returns exactly the expected symbols. */
function perfectExtractor(fixtures: readonly GoldenFixture[]): ExtractionFn {
  return async (_filePath: string, content: string, language?: string) => {
    const fixture = fixtures.find((f) => f.sourceFile === content);
    if (!fixture) {
      return { symbols: [], imports: [], language: language ?? 'unknown', partial: false };
    }
    return {
      symbols: fixture.expectedSymbols.map((s, i) => ({
        name: s.name,
        kind: s.kind,
        exported: s.exported,
        startLine: i + 1,
        endLine: i + 1,
      })),
      imports: fixture.expectedImports.map((imp, i) => ({
        specifier: imp.source,
        names: imp.names ?? [],
        isTypeOnly: false,
        line: i + 1,
      })),
      language: fixture.language,
      partial: false,
    };
  };
}

/** Build a mock extractor that returns only a subset of symbols. */
function partialExtractor(fixtures: readonly GoldenFixture[], keepFraction: number): ExtractionFn {
  return async (_filePath: string, content: string, language?: string) => {
    const fixture = fixtures.find((f) => f.sourceFile === content);
    if (!fixture) {
      return { symbols: [], imports: [], language: language ?? 'unknown', partial: false };
    }
    const kept = fixture.expectedSymbols.slice(0, Math.ceil(fixture.expectedSymbols.length * keepFraction));
    return {
      symbols: kept.map((s, i) => ({
        name: s.name,
        kind: s.kind,
        exported: s.exported,
        startLine: i + 1,
        endLine: i + 1,
      })),
      imports: fixture.expectedImports.map((imp, i) => ({
        specifier: imp.source,
        names: imp.names ?? [],
        isTypeOnly: false,
        line: i + 1,
      })),
      language: fixture.language,
      partial: false,
    };
  };
}

/** Build a mock extractor that returns expected symbols plus extras. */
function overExtractor(fixtures: readonly GoldenFixture[]): ExtractionFn {
  return async (_filePath: string, content: string, language?: string) => {
    const fixture = fixtures.find((f) => f.sourceFile === content);
    if (!fixture) {
      return { symbols: [], imports: [], language: language ?? 'unknown', partial: false };
    }
    const base = fixture.expectedSymbols.map((s, i) => ({
      name: s.name,
      kind: s.kind,
      exported: s.exported,
      startLine: i + 1,
      endLine: i + 1,
    }));
    base.push({ name: '__extra_symbol__', kind: 'function', exported: false, startLine: 999, endLine: 999 });
    return {
      symbols: base,
      imports: fixture.expectedImports.map((imp, i) => ({
        specifier: imp.source,
        names: imp.names ?? [],
        isTypeOnly: false,
        line: i + 1,
      })),
      language: fixture.language,
      partial: false,
    };
  };
}

// --- Tests ---

describe('evaluateCoverage', () => {
  const tsFixture = GOLDEN_FIXTURES.find((f) => f.language === 'typescript')!;

  it('reports perfect coverage when all symbols are found', async () => {
    const result = await evaluateCoverage([tsFixture], perfectExtractor(GOLDEN_FIXTURES));

    expect(result.perLanguage['typescript']).toBeDefined();
    const ts = result.perLanguage['typescript'];
    expect(ts.expected).toBe(tsFixture.expectedSymbols.length);
    expect(ts.actual).toBe(tsFixture.expectedSymbols.length);
    expect(ts.missing).toEqual([]);
    expect(ts.extra).toEqual([]);
    expect(ts.matchRate).toBe(1);
  });

  it('detects missing symbols when extractor returns fewer', async () => {
    const result = await evaluateCoverage([tsFixture], partialExtractor(GOLDEN_FIXTURES, 0.5));

    const ts = result.perLanguage['typescript'];
    expect(ts.missing.length).toBeGreaterThan(0);
    expect(ts.matchRate).toBeLessThan(1);
    expect(ts.matchRate).toBeGreaterThan(0);
  });

  it('detects extra symbols when extractor returns more', async () => {
    const result = await evaluateCoverage([tsFixture], overExtractor(GOLDEN_FIXTURES));

    const ts = result.perLanguage['typescript'];
    expect(ts.extra).toContain('__extra_symbol__');
    expect(ts.missing).toEqual([]);
    expect(ts.matchRate).toBe(1);
  });

  it('handles empty fixtures gracefully', async () => {
    const emptyFixture: GoldenFixture = {
      language: 'empty',
      sourceFile: '',
      expectedSymbols: [],
      expectedImports: [],
    };
    const noopExtract: ExtractionFn = async () => ({
      symbols: [],
      imports: [],
      language: 'empty',
      partial: false,
    });

    const result = await evaluateCoverage([emptyFixture], noopExtract);

    expect(result.perLanguage['empty']).toBeDefined();
    const empty = result.perLanguage['empty'];
    expect(empty.expected).toBe(0);
    expect(empty.actual).toBe(0);
    expect(empty.missing).toEqual([]);
    expect(empty.extra).toEqual([]);
    expect(empty.matchRate).toBe(1);
  });

  it('aggregates metrics across multiple languages', async () => {
    const result = await evaluateCoverage(
      [...GOLDEN_FIXTURES],
      perfectExtractor(GOLDEN_FIXTURES),
    );

    const totalExpected = GOLDEN_FIXTURES.reduce((sum, f) => sum + f.expectedSymbols.length, 0);
    expect(result.overall.expected).toBe(totalExpected);
    expect(result.overall.actual).toBe(totalExpected);
    expect(result.overall.missing).toBe(0);
    expect(result.overall.extra).toBe(0);
    expect(Object.keys(result.perLanguage).length).toBe(GOLDEN_FIXTURES.length);
  });

  it('computes correct aggregate with partial coverage across languages', async () => {
    const result = await evaluateCoverage(
      [...GOLDEN_FIXTURES],
      partialExtractor(GOLDEN_FIXTURES, 0.5),
    );

    expect(result.overall.missing).toBeGreaterThan(0);
    expect(result.overall.actual).toBeLessThan(result.overall.expected);
    for (const lang of Object.keys(result.perLanguage)) {
      const entry = result.perLanguage[lang];
      expect(entry.matchRate).toBeGreaterThanOrEqual(0);
      expect(entry.matchRate).toBeLessThanOrEqual(1);
    }
  });

  it('returns well-formed CoverageResult structure', async () => {
    const result = await evaluateCoverage([tsFixture], perfectExtractor(GOLDEN_FIXTURES));

    expect(result).toHaveProperty('perLanguage');
    expect(result).toHaveProperty('overall');
    expect(result.overall).toHaveProperty('expected');
    expect(result.overall).toHaveProperty('actual');
    expect(result.overall).toHaveProperty('missing');
    expect(result.overall).toHaveProperty('extra');
  });
});

describe('compareBackends', () => {
  const tsFixture = GOLDEN_FIXTURES.find((f) => f.language === 'typescript')!;

  it('produces comparison across multiple backends', async () => {
    const result = await compareBackends(
      [tsFixture],
      {
        'perfect': perfectExtractor(GOLDEN_FIXTURES),
        'partial': partialExtractor(GOLDEN_FIXTURES, 0.5),
      },
    );

    expect(result.backends).toHaveLength(2);
    expect(result.backends.map((b) => b.name).sort()).toEqual(['partial', 'perfect']);

    const perfect = result.backends.find((b) => b.name === 'perfect')!;
    const partial = result.backends.find((b) => b.name === 'partial')!;

    expect(perfect.coverage.overall.missing).toBe(0);
    expect(partial.coverage.overall.missing).toBeGreaterThan(0);
  });

  it('handles single backend', async () => {
    const result = await compareBackends(
      [tsFixture],
      { 'treesitter': perfectExtractor(GOLDEN_FIXTURES) },
    );

    expect(result.backends).toHaveLength(1);
    expect(result.backends[0].name).toBe('treesitter');
  });

  it('handles empty fixtures for all backends', async () => {
    const emptyFixture: GoldenFixture = {
      language: 'empty',
      sourceFile: '',
      expectedSymbols: [],
      expectedImports: [],
    };
    const noopExtract: ExtractionFn = async () => ({
      symbols: [],
      imports: [],
      language: 'empty',
      partial: false,
    });

    const result = await compareBackends(
      [emptyFixture],
      { 'noop': noopExtract },
    );

    expect(result.backends).toHaveLength(1);
    expect(result.backends[0].coverage.overall.expected).toBe(0);
  });
});
