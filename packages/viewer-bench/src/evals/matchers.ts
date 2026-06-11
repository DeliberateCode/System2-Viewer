/**
 * Assertion matchers for the behavioral eval harness.
 *
 * Four matchers: contains, not_contains, matches_regex, structural.
 * Each operates on a target field extracted from the operation result.
 *
 */

import type { EvalAssertion } from '../types.js';
import type { MatcherResult } from './types.js';

function extractTarget(target: EvalAssertion['target'], envelope: unknown): unknown {
  if (envelope == null) return undefined;
  if (typeof envelope !== 'object') return undefined;
  const obj = envelope as Record<string, unknown>;
  if (target === 'full_envelope') return obj;
  return obj[target];
}

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function matchContains(targetValue: unknown, pattern: unknown): MatcherResult {
  const haystack = stringify(targetValue);
  const needle = stringify(pattern);
  const found = haystack.includes(needle);
  return {
    passed: found,
    expected: `target to contain: ${needle}`,
    actual: found ? `found in target` : `not found in: ${haystack.slice(0, 200)}`,
  };
}

function matchNotContains(targetValue: unknown, pattern: unknown): MatcherResult {
  const haystack = stringify(targetValue);
  const needle = stringify(pattern);
  const found = haystack.includes(needle);
  return {
    passed: !found,
    expected: `target to NOT contain: ${needle}`,
    actual: found ? `found in target` : `not found (correct)`,
  };
}

function matchRegex(targetValue: unknown, pattern: unknown): MatcherResult {
  const haystack = stringify(targetValue);
  const regexStr = typeof pattern === 'string' ? pattern : String(pattern);
  let matched: boolean;
  try {
    const re = new RegExp(regexStr);
    matched = re.test(haystack);
  } catch {
    return {
      passed: false,
      expected: `valid regex: ${regexStr}`,
      actual: 'invalid regex pattern',
      diff: `Could not compile regex: ${regexStr}`,
    };
  }
  return {
    passed: matched,
    expected: `target to match regex: ${regexStr}`,
    actual: matched ? 'matched' : `no match in: ${haystack.slice(0, 200)}`,
  };
}

interface StructuralPattern {
  fieldPresence?: string[];
  fieldValue?: Record<string, unknown>;
  minLength?: number;
}

function matchStructural(targetValue: unknown, pattern: unknown): MatcherResult {
  const spec = pattern as StructuralPattern;
  const failures: string[] = [];

  if (spec.fieldPresence) {
    if (targetValue == null || typeof targetValue !== 'object') {
      return {
        passed: false,
        expected: `object with fields: ${spec.fieldPresence.join(', ')}`,
        actual: `target is ${targetValue == null ? 'null/undefined' : typeof targetValue}`,
        diff: `Expected object, got ${typeof targetValue}`,
      };
    }
    const obj = targetValue as Record<string, unknown>;
    for (const field of spec.fieldPresence) {
      if (!(field in obj)) {
        failures.push(`missing field: ${field}`);
      }
    }
  }

  if (spec.fieldValue) {
    const obj = (targetValue != null && typeof targetValue === 'object'
      ? targetValue
      : {}) as Record<string, unknown>;
    for (const [key, expectedVal] of Object.entries(spec.fieldValue)) {
      const actualVal = obj[key];
      if (actualVal !== expectedVal) {
        failures.push(`field "${key}": expected ${stringify(expectedVal)}, got ${stringify(actualVal)}`);
      }
    }
  }

  if (spec.minLength !== undefined) {
    const len = Array.isArray(targetValue)
      ? targetValue.length
      : typeof targetValue === 'string'
        ? targetValue.length
        : 0;
    if (len < spec.minLength) {
      failures.push(`minLength: expected >= ${spec.minLength}, got ${len}`);
    }
  }

  return {
    passed: failures.length === 0,
    expected: `structural match against ${JSON.stringify(pattern)}`,
    actual: failures.length === 0 ? 'all checks passed' : failures.join('; '),
    diff: failures.length > 0 ? failures.join('\n') : undefined,
  };
}

export function evaluateAssertion(assertion: EvalAssertion, envelope: unknown): MatcherResult {
  const targetValue = extractTarget(assertion.target, envelope);

  switch (assertion.matcher) {
    case 'contains':
      return matchContains(targetValue, assertion.pattern);
    case 'not_contains':
      return matchNotContains(targetValue, assertion.pattern);
    case 'matches_regex':
      return matchRegex(targetValue, assertion.pattern);
    case 'structural':
      return matchStructural(targetValue, assertion.pattern);
    default: {
      const _exhaustive: never = assertion.matcher;
      return {
        passed: false,
        expected: `known matcher type`,
        actual: `unknown matcher: ${_exhaustive}`,
      };
    }
  }
}
