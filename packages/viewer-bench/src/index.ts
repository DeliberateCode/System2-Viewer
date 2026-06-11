export { generateFixture } from './fixture-gen.js';
export { runBenchmark } from './bench-runner.js';
export { writeReport, formatReport } from './report.js';
export { BASELINE_METRICS, type BaselineMetrics } from './baselines.js';
export {
  GOLDEN_FIXTURES,
  GOLDEN_QUERY_FIXTURES,
  type GoldenFixture,
  type GoldenQueryResult,
  type ExpectedSymbol,
  type ExpectedImport,
} from './golden-fixture.js';
export { evaluateCoverage, type ExtractionFn } from './coverage-eval.js';
export {
  compareBackends,
  type BackendComparisonResult,
  type BackendCoverageEntry,
} from './backend-compare.js';
export { runEvalScenario, runEvalSuite } from './evals/eval-runner.js';
export { evaluateAssertion } from './evals/matchers.js';
export { EVAL_SCENARIOS } from './evals/scenarios.js';
export { createEvalEngine } from './evals/engine-adapter.js';
export { createAnthropicClient } from './evals/anthropic-adapter.js';
export type {
  PromptEvalClient,
  PromptEvalResponse,
  ToolCall,
  ToolDefinition,
} from './evals/prompt-eval-client.js';
export {
  PROMPT_EVAL_SCENARIOS,
  VIEWER_SCOUT_SYSTEM_PROMPT,
} from './evals/prompt-scenarios.js';
export type {
  PromptEvalScenario,
  PromptAssertion,
  PromptEvalDimension,
  MockToolResponse,
} from './evals/prompt-scenarios.js';
export { runPromptEvalScenario, runPromptEvalSuite } from './evals/prompt-eval-runner.js';
export type {
  PromptAssertionResult,
  PromptEvalResult,
  PromptEvalReport,
} from './evals/prompt-eval-runner.js';
export type { EvalEngine, MatcherResult } from './evals/types.js';
export type {
  FixtureConfig,
  BenchmarkConfig,
  BenchmarkResult,
  CoverageResult,
  EvalScenario,
  EvalResult,
  EvalReport,
} from './types.js';
