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
    options?: { scope?: ScopeFilter },
  ): InvariantCheckResult {
    const violations: RuleViolation[] = [];

    for (const rule of this._explicitRules) {
      // Runtime backstop: defense-in-depth
      neverAutoEnforceGuard(rule);

      if (rule.definition.type === 'forbidden_import') {
        const importEdges = handle.allImportEdges?.() ?? [];

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

          if (matchForbiddenImport(rule, edge.fromPath, edge.toPath)) {
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

/**
 * Standalone wrapper that runs checkInvariants and produces a ResultEnvelope.
 */
export function checkInvariants(
  engine: RulesEngine,
  handle: RulesReadHandle,
  options?: { scope?: ScopeFilter; txn?: RuleWriteTxn },
): ResultEnvelope<InvariantCheckResult> {
  const result = engine.checkInvariants(handle, options);

  return buildEnvelope<InvariantCheckResult>({
    op: 'checkInvariants',
    args: { scope: options?.scope ?? {} },
    data: result,
    modelRevision: 'latest',
  });
}
