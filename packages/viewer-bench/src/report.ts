/**
 * Benchmark report writer and formatter for viewer-bench.
 *
 * Writes structured JSON reports and prints summary tables to stdout.
 *
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkResult } from './types.js';

/**
 * Write a structured JSON benchmark report to disk.
 *
 * Reports are stored under `<dataDir>/bench/bench-<timestamp>.json`.
 */
export function writeReport(result: BenchmarkResult, dataDir: string): string {
  const benchDir = join(dataDir, 'bench');
  mkdirSync(benchDir, { recursive: true });

  const ts = result.timestamp.replace(/[:.]/g, '-');
  const filename = `bench-${ts}.json`;
  const filePath = join(benchDir, filename);

  writeFileSync(filePath, JSON.stringify(result, null, 2) + '\n');
  return filePath;
}

/**
 * Format a BenchmarkResult as a human-readable summary string.
 */
export function formatReport(result: BenchmarkResult): string {
  const lines: string[] = [];

  lines.push('=== Benchmark Results ===');
  lines.push(`Timestamp: ${result.timestamp}`);
  lines.push(`Fixture:   ${result.fixture}`);
  lines.push('');

  lines.push('--- Indexing Throughput ---');
  lines.push(`  Files indexed:    ${result.indexingThroughput.totalFiles}`);
  lines.push(`  Total time (ms):  ${result.indexingThroughput.totalTimeMs.toFixed(2)}`);
  lines.push(`  Files/sec:        ${result.indexingThroughput.filesPerSecond.toFixed(2)}`);
  lines.push('');

  lines.push('--- Peak RSS ---');
  const rssMB = result.peakRss.bytes / (1024 * 1024);
  lines.push(`  ${rssMB.toFixed(2)} MB`);
  lines.push('');

  lines.push('--- Query Latency (getRepositoryOverview) ---');
  const ql = result.queryLatency.getRepositoryOverview;
  lines.push(`  p50:  ${ql.p50.toFixed(2)} ms`);
  lines.push(`  p95:  ${ql.p95.toFixed(2)} ms`);
  lines.push(`  p99:  ${ql.p99.toFixed(2)} ms`);
  lines.push('');

  if (result.thresholdResults.length > 0) {
    lines.push('--- Threshold Results ---');
    for (const tr of result.thresholdResults) {
      const status = tr.passed ? 'PASS' : 'FAIL';
      lines.push(`  [${status}] ${tr.metric}: ${tr.actual.toFixed(2)} (threshold: ${tr.threshold})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
