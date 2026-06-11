/**
 * Tests for baseline metrics and benchmark regression.
 *
 *
 * - Validates the BASELINE_METRICS constant structure
 * - Runs a small 10-file benchmark and verifies result structure
 * - Regression test: 10 files must complete within 5 seconds
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASELINE_METRICS } from '../baselines.js';
import { generateFixture } from '../fixture-gen.js';
import { runBenchmark } from '../bench-runner.js';
import type { FixtureConfig } from '../types.js';

function makeTempDir(label: string): string {
  return join(
    tmpdir(),
    `bench-baseline-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

describe('BASELINE_METRICS', () => {
  it('has all required fields with positive values', () => {
    expect(typeof BASELINE_METRICS.files).toBe('number');
    expect(BASELINE_METRICS.files).toBeGreaterThan(0);

    expect(typeof BASELINE_METRICS.elapsed_ms).toBe('number');
    expect(BASELINE_METRICS.elapsed_ms).toBeGreaterThan(0);

    expect(typeof BASELINE_METRICS.symbols_per_file).toBe('number');
    expect(BASELINE_METRICS.symbols_per_file).toBeGreaterThan(0);

    expect(typeof BASELINE_METRICS.edges).toBe('number');
    expect(BASELINE_METRICS.edges).toBeGreaterThan(0);

    expect(typeof BASELINE_METRICS.memory_rss).toBe('number');
    expect(BASELINE_METRICS.memory_rss).toBeGreaterThan(0);
  });

  it('files count matches a 100-file fixture run', () => {
    expect(BASELINE_METRICS.files).toBeGreaterThanOrEqual(100);
  });
});

describe('benchmark regression', () => {
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

  it('10-file benchmark produces valid result structure', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const fixtureConfig: FixtureConfig = {
      languages: { typescript: 10 },
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

    expect(result.indexingThroughput.totalFiles).toBeGreaterThanOrEqual(10);
    expect(result.indexingThroughput.totalTimeMs).toBeGreaterThan(0);
    expect(result.indexingThroughput.filesPerSecond).toBeGreaterThan(0);
    expect(result.peakRss.bytes).toBeGreaterThan(0);
    expect(result.queryLatency.getRepositoryOverview.p50).toBeGreaterThanOrEqual(0);
  });

  it('10-file benchmark completes within 5 seconds', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const fixtureConfig: FixtureConfig = {
      languages: { typescript: 10 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir: fixtureDir,
    };
    generateFixture(fixtureConfig);

    const start = performance.now();
    const result = await runBenchmark({
      fixtureDir,
      warmupRuns: 0,
      measuredRuns: 1,
    });
    const wallTime = performance.now() - start;

    expect(wallTime).toBeLessThan(5000);
    expect(result.indexingThroughput.totalTimeMs).toBeLessThan(5000);
  });
});
