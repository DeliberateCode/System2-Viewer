/** Ordinal confidence bands -- never floats. */
export type ConfidenceBand = 'none' | 'low' | 'medium' | 'high';

/** Ordinal freshness bands -- never floats. */
export type FreshnessBand = 'stale' | 'aging' | 'fresh';

/** Claim lifecycle status. */
export type ClaimStatus =
  | 'hypothesis'
  | 'confirmed'
  | 'rejected'
  | 'contradicted'
  | 'stale';

/** Evidence kind (open registry -- known literals plus string extensibility). */
export type EvidenceKind =
  | 'human_annotation'
  | 'test_result'
  | 'symbol_index_hit'
  | 'static_analysis_result'
  | 'tree_sitter_query'
  | 'grep_hit'
  | 'source_span'
  | 'git_commit'
  | 'llm_derivation'
  | 'runtime_trace'
  | 'embedding_similarity'
  | (string & {});

/** Edge kinds (open registry -- known literals plus string extensibility). */
export type EdgeKind =
  | 'contains'
  | 'defines'
  | 'references'
  | 'imports'
  | 'tested_by'
  | 'changed_with'
  | 'owns'
  | 'violates'
  | 'rename_candidate'
  | (string & {});

/** Epistemic marker for relationships and evidence. */
export type Epistemic = 'static' | 'inferred' | 'observed';

/** Node kind -- open string type. */
export type NodeKind = string;

/** Resolvable evidence pointer for scoring inputs. */
export interface EvidenceRef {
  evidenceId: string;
  kind: EvidenceKind;
}

/** Scored state used as prior input to scoring. */
export interface ScoredState {
  confidence: ConfidenceBand;
  freshness: FreshnessBand;
}

/** Change set describing a scoped change for freshness computation. */
export interface ChangeSet {
  touchesScope: boolean;
  priorFreshness: FreshnessBand;
  changeRevision: string;
}

/** Minimal claim projection for state machine operations. */
export interface Claim {
  id: string;
  status: ClaimStatus;
  confidence: ConfidenceBand;
  supportingEvidence: EvidenceRef[];
  contradictingEvidence: EvidenceRef[];
  verificationRecipeCount: number;
  claimType?: string;
  scope?: Record<string, unknown>;
}

/** Surfacing classification category. */
export type ClaimCategory =
  | 'exported-symbol'
  | 'entrypoint'
  | 'package'
  | 'subsystem'
  | 'import'
  | 'invariant'
  | 'local-symbol'
  | 'other'
  | (string & {});

/** Importance level for surfacing classification. */
export type Importance = 'low' | 'medium' | 'high';
