/**
 * Integration test for the benchmark CLI entry point and report pipeline.
 *
 *
 * Validates that:
 * - run-bench module exports and compiles correctly
 * - runBenchmark + formatReport + writeReport pipeline produces valid output
 * - JSON report written to disk contains all required fields
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateFixture } from '../fixture-gen.js';
import { runBenchmark } from '../bench-runner.js';
import { formatReport, writeReport } from '../report.js';
import type { BenchmarkResult, FixtureConfig } from '../types.js';

function makeTempDir(label: string): string {
  return join(
    tmpdir(),
    `bench-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

describe('benchmark integration', () => {
  const tempDirs: string[] = [];

  function trackDir(dir: string): string {
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('full pipeline: generate fixture, run benchmark, format and write report', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    const fixtureConfig: FixtureConfig = {
      languages: { typescript: 10, python: 0, rust: 0, go: 0 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir: fixtureDir,
    };
    generateFixture(fixtureConfig);

    const result = await runBenchmark({
      fixtureDir,
      warmupRuns: 0,
      measuredRuns: 1,
    });

    // formatReport returns a non-empty string
    const formatted = formatReport(result);
    expect(formatted).toContain('Benchmark Results');
    expect(formatted).toContain('Indexing Throughput');
    expect(formatted).toContain('Peak RSS');
    expect(formatted).toContain('Query Latency');

    // writeReport writes a valid JSON file
    const reportPath = writeReport(result, dataDir);
    expect(existsSync(reportPath)).toBe(true);

    const reportJson = JSON.parse(readFileSync(reportPath, 'utf-8')) as BenchmarkResult;
    expect(reportJson.timestamp).toBe(result.timestamp);
    expect(reportJson.fixture).toBe(result.fixture);
    expect(reportJson.indexingThroughput.filesPerSecond).toBeGreaterThanOrEqual(0);
    expect(reportJson.indexingThroughput.totalFiles).toBeGreaterThanOrEqual(10);
    expect(reportJson.indexingThroughput.totalTimeMs).toBeGreaterThan(0);
    expect(reportJson.peakRss.bytes).toBeGreaterThan(0);
    expect(reportJson.queryLatency.getRepositoryOverview.p50).toBeGreaterThanOrEqual(0);
    expect(reportJson.queryLatency.getRepositoryOverview.p95).toBeGreaterThanOrEqual(0);
    expect(reportJson.queryLatency.getRepositoryOverview.p99).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(reportJson.thresholdResults)).toBe(true);
  });

  it('report file is written under bench/ subdirectory', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 5, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const result = await runBenchmark({
      fixtureDir,
      warmupRuns: 0,
      measuredRuns: 1,
    });

    const reportPath = writeReport(result, dataDir);
    expect(reportPath).toContain(join('bench', 'bench-'));
    expect(reportPath).toMatch(/\.json$/);
  });
});

describe('run-bench module', () => {
  it('exports parseBenchArgs', async () => {
    const mod = await import('../run-bench.js');
    expect(typeof mod.parseBenchArgs).toBe('function');
  });

  it('parseBenchArgs returns defaults when no args provided', async () => {
    const { parseBenchArgs } = await import('../run-bench.js');
    const args = parseBenchArgs([]);
    expect(args.files).toBe(100);
    expect(args.languages).toEqual(['typescript']);
    expect(args.runs).toBe(3);
    expect(args.output).toBeUndefined();
  });

  it('parseBenchArgs parses --files flag', async () => {
    const { parseBenchArgs } = await import('../run-bench.js');
    const args = parseBenchArgs(['--files', '50']);
    expect(args.files).toBe(50);
  });

  it('parseBenchArgs parses --languages flag', async () => {
    const { parseBenchArgs } = await import('../run-bench.js');
    const args = parseBenchArgs(['--languages', 'ts,py,rs']);
    expect(args.languages).toEqual(['ts', 'py', 'rs']);
  });

  it('parseBenchArgs parses --runs flag', async () => {
    const { parseBenchArgs } = await import('../run-bench.js');
    const args = parseBenchArgs(['--runs', '5']);
    expect(args.runs).toBe(5);
  });

  it('parseBenchArgs parses --output flag', async () => {
    const { parseBenchArgs } = await import('../run-bench.js');
    const args = parseBenchArgs(['--output', '/tmp/report']);
    expect(args.output).toBe('/tmp/report');
  });
});

describe('run-evals module', () => {
  it('exports are importable', async () => {
    const mod = await import('../run-evals.js');
    expect(mod).toBeDefined();
  });
});
