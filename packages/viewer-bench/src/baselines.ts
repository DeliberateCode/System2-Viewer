/**
 * Baseline performance metrics for the benchmark harness.
 *
 * These are reference values recorded from a run of 100 TypeScript files
 * on the development machine. They serve as documentation, not hard thresholds.
 * Use BenchmarkConfig.thresholds for enforceable limits.
 *
 */

export interface BaselineMetrics {
  /** Number of files in the fixture (including generated package.json). */
  files: number;
  /** Median indexing time in milliseconds for 100 TS files. */
  elapsed_ms: number;
  /** Approximate symbols extracted per source file. */
  symbols_per_file: number;
  /** Approximate total edges produced for the fixture. */
  edges: number;
  /** Peak RSS in bytes during indexing. */
  memory_rss: number;
}

/**
 * Baseline metrics recorded from a 100-file TypeScript benchmark run.
 *
 * Machine: macOS ARM64, Node 22, better-sqlite3 WAL mode.
 * These values are approximate and vary by hardware.
 */
export const BASELINE_METRICS: BaselineMetrics = {
  files: 101,
  elapsed_ms: 100,
  symbols_per_file: 6,
  edges: 400,
  memory_rss: 180 * 1024 * 1024,
};
