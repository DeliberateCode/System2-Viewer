export interface BenchmarkConfig {
  fixtureDir: string;
  warmupRuns?: number;
  measuredRuns?: number;
  thresholds?: {
    maxIndexTimeMs?: number;
    maxQueryTimeMs?: number;
    maxRssBytes?: number;
  };
}

export interface BenchmarkResult {
  timestamp: string;
  fixture: string;
  indexingThroughput: {
    filesPerSecond: number;
    totalFiles: number;
    totalTimeMs: number;
  };
  peakRss: {
    bytes: number;
  };
  queryLatency: {
    getRepositoryOverview: {
      p50: number;
      p95: number;
      p99: number;
    };
  };
  thresholdResults: Array<{
    metric: string;
    actual: number;
    threshold: number;
    passed: boolean;
  }>;
}

export interface CoverageResult {
  perLanguage: Record<
    string,
    {
      expected: number;
      actual: number;
      missing: string[];
      extra: string[];
      matchRate: number;
    }
  >;
  overall: {
    expected: number;
    actual: number;
    missing: number;
    extra: number;
  };
}

export interface FixtureConfig {
  totalFiles?: number;
  languages: Record<string, number>;
  locRange: [number, number];
  nestingDepth: number;
  outputDir: string;
}

export interface EvalOperation {
  op: string;
  args: Record<string, unknown>;
  repeat?: number;
}

export interface EvalAssertion {
  target: 'data' | 'evidence' | 'uncertainties' | 'suggestedNextCalls' | 'full_envelope';
  matcher: 'contains' | 'not_contains' | 'matches_regex' | 'structural';
  pattern: unknown;
  description: string;
}

export interface EvalScenario {
  id: string;
  name: string;
  category: 'tag_fidelity' | 'hypothesis_stability' | 'doctor_first' | 'graceful_degradation';
  description: string;
  operations: EvalOperation[];
  assertions: EvalAssertion[];
}

export interface EvalResult {
  scenarioId: string;
  scenarioName: string;
  category: string;
  passed: boolean;
  assertions: Array<{
    description: string;
    passed: boolean;
    expected: string;
    actual: string;
    diff?: string;
  }>;
  durationMs: number;
}

export interface EvalReport {
  timestamp: string;
  scenarios: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}
