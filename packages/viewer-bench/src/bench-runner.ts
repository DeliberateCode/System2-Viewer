/**
 * Indexing throughput benchmark runner for viewer-bench.
 *
 * Measures indexing throughput (files/sec), peak RSS, and query latency
 * against a pre-generated fixture directory.
 *
 */
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '@system2-viewer/viewer-store';
import { Indexer } from '@system2-viewer/viewer-indexer';
import { getRepositoryOverview } from '@system2-viewer/viewer-retrieval';
import type { BenchmarkConfig, BenchmarkResult } from './types.js';

const DEFAULT_WARMUP_RUNS = 1;
const DEFAULT_MEASURED_RUNS = 3;
const DEFAULT_QUERY_RUNS = 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Run the indexing throughput benchmark.
 *
 * Steps:
 *   1. Create a temporary data dir for ModelStore.
 *   2. Run warmup indexing passes (results discarded).
 *   3. Run measured indexing passes, recording wall-clock time and peak RSS.
 *   4. Run getRepositoryOverview queries, collecting latency samples.
 *   5. Evaluate advisory thresholds.
 *   6. Clean up temporary data dir.
 *   7. Return structured BenchmarkResult.
 */
export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const warmupRuns = config.warmupRuns ?? DEFAULT_WARMUP_RUNS;
  const measuredRuns = config.measuredRuns ?? DEFAULT_MEASURED_RUNS;
  const fixtureDir = config.fixtureDir;

  // Resolve thresholds from config or env vars
  const thresholds = {
    maxIndexTimeMs: config.thresholds?.maxIndexTimeMs
      ?? parseEnvNumber('BENCH_MAX_INDEX_MS'),
    maxQueryTimeMs: config.thresholds?.maxQueryTimeMs
      ?? parseEnvNumber('BENCH_MAX_QUERY_MS'),
    maxRssBytes: config.thresholds?.maxRssBytes
      ?? parseEnvNumber('BENCH_MAX_RSS'),
  };

  let peakRss = 0;
  const indexTimings: number[] = [];
  let totalFilesIndexed = 0;

  // Warmup runs
  for (let i = 0; i < warmupRuns; i++) {
    const dataDir = mkdtempSync(join(tmpdir(), 'bench-warmup-'));
    try {
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: fixtureDir });
      store.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }

  // Measured runs
  for (let i = 0; i < measuredRuns; i++) {
    const dataDir = mkdtempSync(join(tmpdir(), 'bench-measured-'));
    try {
      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);

      const rssBefore = process.memoryUsage().rss;
      const start = performance.now();
      const { revision } = await indexer.index({ repoRoot: fixtureDir });
      const elapsed = performance.now() - start;
      const rssAfter = process.memoryUsage().rss;

      indexTimings.push(elapsed);
      peakRss = Math.max(peakRss, rssAfter, rssBefore);

      // Count indexed files from the last measured run
      if (i === measuredRuns - 1) {
        const readHandle = store.read(revision);
        totalFilesIndexed = countFileNodes(readHandle, revision);
        readHandle.close();
      }

      store.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }

  // Query latency measurement
  const queryTimings: number[] = [];
  const queryDataDir = mkdtempSync(join(tmpdir(), 'bench-query-'));
  try {
    const store = ModelStore.open(queryDataDir);
    const indexer = new Indexer(store);
    const { revision } = await indexer.index({ repoRoot: fixtureDir });

    // The Indexer stores the repository node with id === revision
    const readHandle = store.read(revision);
    const repoNodeId = revision;

    const queryRuns = Math.max(DEFAULT_QUERY_RUNS, measuredRuns);
    for (let i = 0; i < queryRuns; i++) {
      const qStart = performance.now();
      getRepositoryOverview(readHandle, repoNodeId, { revision });
      const qElapsed = performance.now() - qStart;
      queryTimings.push(qElapsed);
    }
    readHandle.close();
    store.close();
  } finally {
    rmSync(queryDataDir, { recursive: true, force: true });
  }

  // Compute statistics
  const sortedIndex = [...indexTimings].sort((a, b) => a - b);
  const medianIndexTime = percentile(sortedIndex, 50);

  const sortedQuery = [...queryTimings].sort((a, b) => a - b);

  const avgIndexTime = indexTimings.reduce((a, b) => a + b, 0) / indexTimings.length;
  const filesPerSecond = totalFilesIndexed > 0 && avgIndexTime > 0
    ? (totalFilesIndexed / avgIndexTime) * 1000
    : 0;

  // Threshold evaluation
  const thresholdResults: BenchmarkResult['thresholdResults'] = [];

  if (thresholds.maxIndexTimeMs != null) {
    thresholdResults.push({
      metric: 'indexTimeMs',
      actual: medianIndexTime,
      threshold: thresholds.maxIndexTimeMs,
      passed: medianIndexTime <= thresholds.maxIndexTimeMs,
    });
  }

  if (thresholds.maxQueryTimeMs != null) {
    const p95Query = percentile(sortedQuery, 95);
    thresholdResults.push({
      metric: 'queryTimeMs_p95',
      actual: p95Query,
      threshold: thresholds.maxQueryTimeMs,
      passed: p95Query <= thresholds.maxQueryTimeMs,
    });
  }

  if (thresholds.maxRssBytes != null) {
    thresholdResults.push({
      metric: 'peakRssBytes',
      actual: peakRss,
      threshold: thresholds.maxRssBytes,
      passed: peakRss <= thresholds.maxRssBytes,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    fixture: fixtureDir,
    indexingThroughput: {
      filesPerSecond,
      totalFiles: totalFilesIndexed,
      totalTimeMs: medianIndexTime,
    },
    peakRss: {
      bytes: peakRss,
    },
    queryLatency: {
      getRepositoryOverview: {
        p50: percentile(sortedQuery, 50),
        p95: percentile(sortedQuery, 95),
        p99: percentile(sortedQuery, 99),
      },
    },
    thresholdResults,
  };
}

/**
 * Count file nodes reachable from the repository node via 'contains' edges.
 * The Indexer uses the revision string as the repository node ID.
 */
function countFileNodes(
  readHandle: {
    neighbors(id: string, kind?: string, maxDepth?: number): Array<{ toNodeId: string }>;
    getNode(id: string): Record<string, unknown> | null;
  },
  repoNodeId: string,
): number {
  const edges = readHandle.neighbors(repoNodeId, 'contains', 64);
  let count = 0;
  for (const edge of edges) {
    const node = readHandle.getNode(edge.toNodeId);
    if (node && node['kind'] === 'file') {
      count++;
    }
  }
  return count;
}

function parseEnvNumber(key: string): number | undefined {
  const val = process.env[key];
  if (val == null) return undefined;
  const num = Number(val);
  return Number.isFinite(num) ? num : undefined;
}
