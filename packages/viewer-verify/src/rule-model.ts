/**
 * Rule model with branded type separation.
 *
 * EnforceableRule is a BRANDED type, producible ONLY via loadExplicitRules().
 * InferredCandidateRule is structurally DISJOINT (no brand symbol).
 * There is NO function converting inferred -> enforceable without human confirmation.
 */

import picomatch from 'picomatch';
import type { RuleDefinition, RuleType } from './types.js';

/** Unique brand symbol for enforceable rules. */
declare const ENFORCEABLE_BRAND: unique symbol;

/** Base fields shared by all rule representations. */
interface RuleBase {
  id: string;
  name: string;
  ruleType: RuleType;
  repositoryId: string;
  definition: RuleDefinition;
}

/**
 * A rule that has been explicitly configured and confirmed for enforcement.
 * The brand symbol makes this structurally incompatible with InferredCandidateRule.
 * Only producible via loadExplicitRules().
 */
export type EnforceableRule = RuleBase & {
  readonly [ENFORCEABLE_BRAND]: true;
  readonly status: 'human_confirmed_explicit';
  readonly source: 'explicit';
};

/**
 * An inferred rule candidate that has NOT been confirmed for enforcement.
 * Structurally disjoint from EnforceableRule: lacks the brand, has
 * different status/source literals, and carries inference metadata.
 */
export type InferredCandidateRule = RuleBase & {
  readonly status: 'inferred_candidate';
  readonly source: 'inferred';
  readonly evidenceIds: string[];
  readonly knownExceptions: string[];
};

/**
 * A rule that has been explicitly rejected.
 */
export type RejectedRule = RuleBase & {
  readonly status: 'rejected';
  readonly source: 'explicit' | 'inferred';
};

/** Union of all rule states. */
export type Rule = EnforceableRule | InferredCandidateRule | RejectedRule;

/**
 * Brands rule definitions from configuration as enforceable.
 * This is the ONLY production path to create EnforceableRule instances.
 */
export function loadExplicitRules(
  repositoryId: string,
  defs: RuleDefinition[],
): EnforceableRule[] {
  const enabledDefs = defs.filter((def) => def.enabled !== false);
  return enabledDefs.map((def, index) => {
    const rule = {
      id: `rule-explicit-${repositoryId}-${index}-${def.name}`,
      name: def.name,
      ruleType: def.type as RuleType,
      repositoryId,
      definition: def,
      status: 'human_confirmed_explicit' as const,
      source: 'explicit' as const,
    };
    // Cast through unknown to apply the brand. This is the ONLY place
    // the brand is applied -- the unique symbol prevents external construction.
    return rule as unknown as EnforceableRule;
  });
}

/**
 * Creates an unbranded inferred candidate rule.
 * Cannot be passed where EnforceableRule is expected (compile-time enforcement).
 */
export function makeInferredCandidate(
  repositoryId: string,
  def: RuleDefinition,
  evidenceIds: string[],
  knownExceptions: string[],
): InferredCandidateRule {
  return {
    id: `rule-inferred-${repositoryId}-${def.name}`,
    name: def.name,
    ruleType: def.type as RuleType,
    repositoryId,
    definition: def,
    status: 'inferred_candidate' as const,
    source: 'inferred' as const,
    evidenceIds: [...evidenceIds],
    knownExceptions: [...knownExceptions],
  };
}

/**
 * Matches a forbidden_import rule against a source->target import path.
 * Uses simple glob matching: '*' matches any sequence of non-separator chars,
 * '**' matches any path segment sequence.
 */
export function matchForbiddenImport(
  rule: EnforceableRule,
  fromPath: string,
  toPath: string,
  boundaryContext?: {
    fileToBoundary: Map<string, { boundaryName: string; isPublic: boolean }>;
  },
): boolean {
  if (rule.definition.type !== 'forbidden_import') return false;

  const fromGlob = rule.definition.from.pathGlob;
  const toGlob = rule.definition.to.pathGlob;

  const fromMatch = matchBoundaryOrGlob(fromGlob, fromPath, boundaryContext);
  const toMatch = matchBoundaryOrGlob(toGlob, toPath, boundaryContext);

  return fromMatch && toMatch;
}

function matchBoundaryOrGlob(
  pattern: string,
  filePath: string,
  boundaryContext?: { fileToBoundary: Map<string, { boundaryName: string; isPublic: boolean }> },
): boolean {
  if (pattern.startsWith('boundary:')) {
    if (!boundaryContext) return false;
    const rest = pattern.slice('boundary:'.length);
    const lastColon = rest.lastIndexOf(':');
    const knownScopes = ['internal'];
    let boundaryName: string;
    let scope: string | undefined;
    if (lastColon > 0 && knownScopes.includes(rest.slice(lastColon + 1))) {
      boundaryName = rest.slice(0, lastColon);
      scope = rest.slice(lastColon + 1);
    } else {
      boundaryName = rest;
      scope = undefined;
    }
    const membership = boundaryContext.fileToBoundary.get(filePath);
    if (!membership || membership.boundaryName !== boundaryName) return false;
    if (scope === 'internal') return !membership.isPublic;
    return true;
  }
  return globMatch(pattern, filePath);
}

/**
 * Runtime backstop that THROWS if a non-explicit/unconfirmed rule reaches
 * an enforcement path. Defense-in-depth alongside compile-time brand separation.
 */
export function neverAutoEnforceGuard(
  rule: unknown,
): asserts rule is EnforceableRule {
  if (rule === null || rule === undefined || typeof rule !== 'object') {
    throw new Error(
      'neverAutoEnforceGuard: received non-object value in enforcement path',
    );
  }

  const r = rule as Record<string, unknown>;

  if (r['status'] !== 'human_confirmed_explicit') {
    throw new Error(
      `neverAutoEnforceGuard: non-explicit rule reached enforcement path (status: ${String(r['status'])})`,
    );
  }

  if (r['source'] !== 'explicit') {
    throw new Error(
      `neverAutoEnforceGuard: non-explicit rule reached enforcement path (source: ${String(r['source'])})`,
    );
  }
}

/**
 * Glob matcher supporting '*' (single segment wildcard) and
 * '**' (multi-segment wildcard). Delegates to picomatch.
 */
function globMatch(pattern: string, value: string): boolean {
  return picomatch.isMatch(value, pattern, { dot: true });
}
