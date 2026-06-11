/**
 * Eval harness types for behavioral evaluation of viewer-scout.
 */

export type {
  EvalScenario,
  EvalOperation,
  EvalAssertion,
  EvalResult,
  EvalReport,
} from '../types.js';

/**
 * Minimal engine interface for eval dispatch.
 *
 * viewer-bench cannot import viewer-surface (boundary rule). Callers
 * adapt ViewerEngine to this shape.
 */
export interface EvalEngine {
  dispatch(op: string, args: Record<string, unknown>): unknown;
  close(): void;
}

/** Result of a single matcher evaluation. */
export interface MatcherResult {
  passed: boolean;
  expected: string;
  actual: string;
  diff?: string;
}
