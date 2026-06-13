/**
 * Rules engine for invariant checking and inferred candidate surfacing.
 *
 * checkInvariants accepts ONLY EnforceableRule[] by type.
 * Inferred candidates are surfaced separately as hypothesis claims.
 */

import { buildEnvelope } from '@system2-viewer/viewer-retrieval';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

import type { EnforceableRule, InferredCandidateRule } from './rule-model.js';
import { matchForbiddenImport, neverAutoEnforceGuard } from './rule-model.js';
import type {
  InvariantCheckResult,
  InferredCandidateClaim,
  RulesReadHandle,
  RuleWriteTxn,
  RuleViolation,
  ScopeFilter,
} from './types.js';

/**
 * Rules engine that checks explicit rule invariants and surfaces inferred candidates.
 */
export class RulesEngine {
  private readonly _explicitRules: EnforceableRule[];
  private readonly _inferredCandidates: InferredCandidateRule[];

  constructor(
    explicitRules: EnforceableRule[],
    inferredCandidates: InferredCandidateRule[],
  ) {
    this._explicitRules = [...explicitRules];
    this._inferredCandidates = [...inferredCandidates];
  }

  /**
   * Checks invariants against the model using ONLY explicit enforceable rules.
   * The type signature ensures InferredCandidateRule cannot be passed here.
   */
  checkInvariants(
    handle: RulesReadHandle,
    options?: { scope?: ScopeFilter; boundaryContext?: BoundaryContext; importEdges?: Array<{ fromPath: string; toPath: string }> },
  ): InvariantCheckResult {
    const violations: RuleViolation[] = [];
    const importEdges = options?.importEdges ?? handle.allImportEdges?.() ?? [];

    for (const rule of this._explicitRules) {
      // Runtime backstop: defense-in-depth
      neverAutoEnforceGuard(rule);

      if (rule.definition.type === 'forbidden_import') {
        for (const edge of importEdges) {
          // Apply scope filter if provided
          if (options?.scope?.path) {
            if (
              !edge.fromPath.startsWith(options.scope.path) &&
              !edge.toPath.startsWith(options.scope.path)
            ) {
              continue;
            }
          }

          if (matchForbiddenImport(rule, edge.fromPath, edge.toPath, options?.boundaryContext)) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.name,
              ruleType: rule.ruleType,
              fromPath: edge.fromPath,
              toPath: edge.toPath,
              severity: rule.definition.severity,
              evidence: [
                {
                  kind: 'static_analysis_result',
                  path: edge.fromPath,
                  description: `Import from ${edge.fromPath} to ${edge.toPath} violates rule "${rule.name}"`,
                },
              ],
            });
          }
        }
      }
    }

    return {
      violations,
      rulesChecked: this._explicitRules.length,
      passed: violations.length === 0,
    };
  }

  /**
   * Surfaces inferred candidate rules as hypothesis claims.
   * These are never auto-enforced.
   */
  surfaceInferredCandidates(): InferredCandidateClaim[] {
    return this._inferredCandidates.map((candidate) => ({
      ruleId: candidate.id,
      ruleName: candidate.name,
      ruleType: candidate.ruleType,
      evidenceIds: [...candidate.evidenceIds],
      knownExceptions: [...candidate.knownExceptions],
      statement: `Inferred rule "${candidate.name}" (${candidate.ruleType}): ${candidate.definition.from.pathGlob} -> ${candidate.definition.to.pathGlob}`,
    }));
  }
}

export interface BoundaryContext {
  fileToBoundary: Map<string, { boundaryName: string; isPublic: boolean }>;
  boundaries: Map<string, { publicFiles: Set<string>; allowedDependencies?: string[] }>;
}

/**
 * Standalone envelope-producing wrapper around RulesEngine.checkInvariants.
 * Not to be confused with the class method — this function adds boundary
 * violation detection and wraps the result in a ResultEnvelope.
 */
export function checkInvariants(
  engine: RulesEngine,
  handle: RulesReadHandle,
  options?: { scope?: ScopeFilter; txn?: RuleWriteTxn; boundaryContext?: BoundaryContext },
): ResultEnvelope<InvariantCheckResult> {
  const importEdges = handle.allImportEdges?.() ?? [];
  const result = engine.checkInvariants(handle, { ...options, importEdges });

  if (options?.boundaryContext) {
    const bc = options.boundaryContext;
    let boundaryChecks = 0;

    for (const edge of importEdges) {
      if (options?.scope?.path) {
        if (!edge.fromPath.startsWith(options.scope.path) && !edge.toPath.startsWith(options.scope.path)) {
          continue;
        }
      }

      const fromMembership = bc.fileToBoundary.get(edge.fromPath);
      const toMembership = bc.fileToBoundary.get(edge.toPath);

      if (!fromMembership || !toMembership) continue;
      if (fromMembership.boundaryName === toMembership.boundaryName) continue;

      const toBoundary = bc.boundaries.get(toMembership.boundaryName);
      if (!toBoundary) continue;

      const fromBoundary = bc.boundaries.get(fromMembership.boundaryName);

      boundaryChecks++;

      if (fromBoundary?.allowedDependencies && !fromBoundary.allowedDependencies.includes(toMembership.boundaryName)) {
        result.violations.push({
          ruleId: `boundary:${fromMembership.boundaryName}:disallowed-dep:${toMembership.boundaryName}`,
          ruleName: `boundary-dependency:${fromMembership.boundaryName}->${toMembership.boundaryName}`,
          ruleType: 'forbidden_import',
          fromPath: edge.fromPath,
          toPath: edge.toPath,
          severity: 'warning',
          evidence: [{
            kind: 'static_analysis_result',
            path: edge.fromPath,
            description: `Boundary "${fromMembership.boundaryName}" is not allowed to depend on boundary "${toMembership.boundaryName}"`,
          }],
        });
      }

      if (!toMembership.isPublic) {
        result.violations.push({
          ruleId: `boundary:${toMembership.boundaryName}:non-public-import`,
          ruleName: `boundary-violation:${fromMembership.boundaryName}->${toMembership.boundaryName}`,
          ruleType: 'forbidden_import',
          fromPath: edge.fromPath,
          toPath: edge.toPath,
          severity: 'warning',
          evidence: [{
            kind: 'static_analysis_result',
            path: edge.fromPath,
            description: `Import from "${fromMembership.boundaryName}" to non-public file in "${toMembership.boundaryName}"`,
          }],
        });
      }
    }

    result.rulesChecked += boundaryChecks;
    result.passed = result.violations.length === 0;
  }

  return buildEnvelope<InvariantCheckResult>({
    op: 'checkInvariants',
    args: { scope: options?.scope ?? {} },
    data: result,
    modelRevision: 'latest',
  });
}
