import type { ConfidenceBand, FreshnessBand, ClaimStatus, Epistemic } from '@system2-viewer/viewer-core';

export type RevisionId = string;

export interface NeighborEdge {
  id: string;
  kind: string;
  fromNodeId: string;
  toNodeId: string;
  depth: number;
  confidenceBand: string | null;
  epistemic: string | null;
  evidenceIdsJson: string | null;
}

export interface ClaimReadRow {
  id: string;
  claimType: string;
  statement: string;
  status: string;
  confidenceBand: string;
  freshnessBand: string;
  validFromRevision: string;
  validToRevision: string | null;
  scopeJson: string;
  supportingEvidenceIds: string[];
  repositoryId?: string;
  verificationRecipesJson?: string;
  surfaced?: number;
}

export interface EvidenceReadRow {
  id: string;
  kind: string;
  contentHash: string | null;
  revision: string;
  path: string | null;
}

export interface PartialityRow {
  id: string;
  revision: string;
  scope: string;
  extractedJson: string | null;
  failedJson: string | null;
  skippedJson: string | null;
}

export interface PartialityWriteRow {
  id: string;
  revision: string;
  scope: string;
  extractedJson: string | null;
  failedJson: string | null;
  skippedJson: string | null;
  createdAt: string;
}

export interface VerificationHistoryRow {
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
}

export interface FtsHit {
  objectId: string;
  objectType: string;
  text: string;
  path: string | null;
  rank: number;
}

export interface NodeRow {
  id: string;
  kind: string;
  stableKey: string;
  displayName: string | null;
  repositoryId: string;
  path: string | null;
  language: string | null;
  fileClass: string | null;
  provenanceMethod: string;
  extractor: string;
  metadataJson: string | null;
  validFromRevision: string;
  validToRevision: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeRow {
  id: string;
  kind: string;
  epistemic: Epistemic;
  fromNodeId: string;
  toNodeId: string;
  repositoryId: string;
  confidenceBand: ConfidenceBand;
  provenanceMethod: string;
  extractor: string;
  evidenceIdsJson: string | null;
  metadataJson: string | null;
  validFromRevision: string;
  validToRevision: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRow {
  id: string;
  kind: string;
  epistemic: Epistemic;
  repositoryId: string;
  revision: string;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  contentHash: string | null;
  extractor: string;
  derivationLocality: 'local' | 'remote';
  actor: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface ClaimRow {
  id: string;
  claimType: string;
  statement: string;
  status: ClaimStatus;
  repositoryId: string;
  scopeJson: string;
  confidenceBand: ConfidenceBand;
  freshnessBand: FreshnessBand;
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
}

export interface RuleRow {
  id: string;
  name: string;
  ruleType: string;
  status: 'inferred_candidate' | 'human_confirmed_explicit' | 'rejected';
  source: 'explicit' | 'inferred';
  repositoryId: string;
  definitionJson: string;
  validFromRevision: string;
  validToRevision: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmbeddingRow {
  nodeId: string;
  modelName: string;
  dimension: number;
  vector: Buffer;
  createdAt: string;
}

export interface SimilarityHit {
  nodeId: string;
  score: number;
}

export interface FileHashRow {
  path: string;
  repositoryId: string;
  hash: string;
  revision: string;
  updatedAt: string;
  mtimeMs?: number | null;
  size?: number | null;
}
