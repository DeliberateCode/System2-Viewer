/**
 * viewer-verify types.
 *
 * Defines all structural types for the verification and rules engines.
 * Imports only from viewer-core and viewer-retrieval.
 */

import type {
  ConfidenceBand,
  FreshnessBand,
  ClaimStatus,
  EvidenceKind,
  EvidenceRef as CoreEvidenceRef,
  ScoredState,
} from '@system2-viewer/viewer-core';

import type {
  ClaimReadRow,
  NeighborEdge,
  ScopeFilter as RetrievalScopeFilter,
} from '@system2-viewer/viewer-retrieval';

/** Scope filter for rules/invariant checking. */
export interface ScopeFilter {
  repositoryId?: string;
  path?: string;
  subsystemId?: string;
}

/** Rule type identifiers. */
export type RuleType = 'forbidden_import' | 'required_dependency' | (string & {});

/** Rule status in the lifecycle. */
export type RuleStatus =
  | 'inferred_candidate'
  | 'human_confirmed_explicit'
  | 'rejected';

/** Rule source: explicit (from config) or inferred (from analysis). */
export type RuleSource = 'explicit' | 'inferred';

/** Definition of a rule as provided by configuration or inference. */
export interface RuleDefinition {
  name: string;
  type: RuleType;
  from: { pathGlob: string };
  to: { pathGlob: string };
  severity: string;
  enabled?: boolean;
}

/** A single invariant violation detected by the rules engine. */
export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  fromPath: string;
  toPath: string;
  severity: string;
  evidence: RecipeEvidence[];
}

/** Result of invariant checking. */
export interface InvariantCheckResult {
  violations: RuleViolation[];
  rulesChecked: number;
  passed: boolean;
}

/** A surfaced inferred candidate claim from the rules engine. */
export interface InferredCandidateClaim {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  evidenceIds: string[];
  knownExceptions: string[];
  statement: string;
}

/** Result of a single verification recipe execution. */
export interface RecipeOutcome {
  recipeType: string;
  passed: boolean;
  evidence: RecipeEvidence[];
  reason?: string;
}

/** Evidence produced by a verification recipe. */
export interface RecipeEvidence {
  kind: EvidenceKind;
  path?: string;
  startLine?: number;
  endLine?: number;
  contentHash?: string;
  description: string;
}

/** A source span reference for verification. */
export interface SourceSpanRef {
  path: string;
  startLine: number;
  endLine: number;
  contentHash?: string;
}

/** A verification recipe definition attached to claims. */
export interface VerificationRecipe {
  recipeType: string;
  description: string;
  command?: string;
  sourceSpan?: SourceSpanRef;
  symbolName?: string;
  fromPath?: string;
  toPath?: string;
  pattern?: string;
}

/** Result of verifying a single claim. */
export interface VerificationResult {
  claimId: string;
  priorStatus: ClaimStatus;
  newStatus: ClaimStatus;
  priorConfidence: ConfidenceBand;
  newConfidence: ConfidenceBand;
  priorFreshness: FreshnessBand;
  newFreshness: FreshnessBand;
  recipeOutcomes: RecipeOutcome[];
  unresolvedReason?: string;
}

/** Extended claim row with fields needed for verification. */
export interface VerificationClaimRow extends ClaimReadRow {
  repositoryId?: string;
  verificationRecipesJson?: string;
  surfaced?: number;
}

/** Structural read handle for verification operations (read-only). */
export interface VerificationModelHandle {
  getClaim(id: string): VerificationClaimRow | null;
  getNode(id: string): Record<string, unknown> | null;
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
  readFileContent?(path: string): string | null;
}

/** Structural write handle for verification (creates successors, audit trail). */
export interface VerificationWriteTxn {
  appendEvidence(row: {
    id: string;
    kind: string;
    epistemic: string;
    repositoryId: string;
    revision: string;
    path: string | null;
    startLine: number | null;
    endLine: number | null;
    contentHash: string | null;
    extractor: string;
    derivationLocality: string;
    actor: string | null;
    metadataJson: string | null;
    createdAt: string;
  }): void;
  appendVerificationHistory(row: {
    id: string;
    claimId: string;
    recipesJson: string;
    priorConfidence: string | null;
    newConfidence: string | null;
    priorFreshness: string | null;
    newFreshness: string | null;
    priorStatus: string | null;
    newStatus: string | null;
    unresolvedReason: string | null;
    ranAt: string;
  }): void;
  versionClaim(row: {
    id: string;
    claimType: string;
    statement: string;
    status: string;
    repositoryId: string;
    scopeJson: string;
    confidenceBand: string;
    freshnessBand: string;
    supportingEvidenceIdsJson: string;
    contradictingEvidenceIdsJson: string | null;
    verificationRecipesJson: string;
    derivationMethod: string;
    generationId: string;
    surfaced: number;
    validFromRevision: string;
    validToRevision: string | null;
    createdAt: string;
    updatedAt: string;
  }): void;
  closeInterval(id: string, revision: string): void;
  commit(): void;
  abort(): void;
}

/** Structural read handle for verification recipe execution. */
export interface VerificationReadHandle {
  readFileContent?(path: string): string | null;
  getNode(id: string): Record<string, unknown> | null;
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
}

/** Structural read handle for the rules engine. */
export interface RulesReadHandle {
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
  getNode(id: string): Record<string, unknown> | null;
  allImportEdges?(): ModelImportEdge[];
}

/** An import edge as seen in the model. */
export interface ModelImportEdge {
  fromNodeId: string;
  toNodeId: string;
  fromPath: string;
  toPath: string;
}

/** Structural write handle for rule operations. */
export interface RuleWriteTxn {
  promoteRule(row: {
    id: string;
    name: string;
    ruleType: string;
    status: string;
    source: string;
    repositoryId: string;
    definitionJson: string;
    validFromRevision: string;
    validToRevision: string | null;
    createdAt: string;
    updatedAt: string;
  }): void;
  commit(): void;
  abort(): void;
}

/** Input for rescoring. */
export interface RescoreInput {
  evidence: CoreEvidenceRef[];
  contradictions: CoreEvidenceRef[];
  priorState: ScoredState;
  scopedChange?: {
    touchesScope: boolean;
    priorFreshness: FreshnessBand;
    changeRevision: string;
  };
  lastEvidenceRevision?: string;
}

/** Result of rescoring. */
export interface RescoreResult {
  confidence: ConfidenceBand;
  freshness: FreshnessBand;
}

/** Structural read handle for on-demand claim generation. */
export interface OnDemandReadHandle {
  getNode(id: string): Record<string, unknown> | null;
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
  allClaimIds?(): string[];
  getClaim?(id: string): ClaimReadRow | null;
}

/** Structural write handle for persisting on-demand claims. */
export interface OnDemandWriteTxn {
  versionClaim(row: Record<string, unknown>): void;
  appendEvidence(row: Record<string, unknown>): void;
  commit(): void;
  abort(): void;
}

/** Query for on-demand claim generation. */
export interface OnDemandQuery {
  nodeIds: string[];
  revision: string;
  claimTypes?: string[];
}

/** Result of on-demand claim generation. */
export interface OnDemandClaimsResult {
  claims: Array<{
    id: string;
    claimType: string;
    statement: string;
    status: ClaimStatus;
    confidence: ConfidenceBand;
    freshness: FreshnessBand;
    evidence: CoreEvidenceRef[];
    verificationRecipes: VerificationRecipe[];
  }>;
  generated: number;
}
