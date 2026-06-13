/**
 * Structural ReadHandle interfaces for viewer-retrieval.
 *
 * These are TypeScript structural types defined locally. They are NOT
 * imports from viewer-store. The real viewer-store ReadHandle satisfies
 * these by shape at the composition root (viewer-surface).
 *
 * Row shapes (NeighborEdge, FtsHit, ClaimReadRow, PartialityRow) are
 * redefined here as structural types to enforce the boundary: viewer-retrieval
 * has zero knowledge of viewer-store.
 */

/** A neighbor edge as returned by the graph traversal. */
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

/** A full-text search hit. */
export interface FtsHit {
  objectId: string;
  objectType: string;
  text: string;
  path: string | null;
  rank: number;
}

/** A claim row as read from the store. */
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

/** A semantic similarity search hit. */
export interface SimilarityHit {
  nodeId: string;
  score: number;
}

/** A partiality tracking row. */
export interface PartialityRow {
  id: string;
  revision: string;
  scope: string;
  extractedJson: string | null;
  failedJson: string | null;
  skippedJson: string | null;
}

/**
 * Base read handle for the retrieval pipeline. Satisfied structurally
 * by viewer-store's ReadHandle.
 */
export type PipelineReadHandle = {
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
  ftsSearch(q: string): FtsHit[];
  getNode(id: string): Record<string, unknown> | null;
  getClaim(id: string): ClaimReadRow | null;
  claimsByPrefix?(prefix: string, limit?: number): ClaimReadRow[];
  partiality(rev: string): PartialityRow[];
  semanticSearch?(queryVector: Float32Array, limit?: number): SimilarityHit[];
};

/**
 * ReadView for getRepositoryOverview. Widens PipelineReadHandle with
 * optional accessors for richer data retrieval at the composition root.
 */
export type ReadView = PipelineReadHandle & {
  enumerateContainedNodes?(rootId: string): Array<Record<string, unknown>>;
  allEdges?(kind?: string): Array<{ fromNodeId: string; toNodeId: string; kind: string }>;
};

/** Handle for findEntrypoints. Widens with decorated-symbol enumeration. */
export type EntrypointReadHandle = PipelineReadHandle & {
  decoratedSymbols?(): Array<{ id: string; metadataJson: string; path: string | null }>;
};

/** Handle for traceFlow. Widens with inbound edge lookup. */
export type FlowReadHandle = PipelineReadHandle & {
  inboundEdges?(nodeId: string, kind?: string): NeighborEdge[];
};

/** Handle for explainSubsystem. Widens with contained-node enumeration. */
export type SubsystemReadHandle = PipelineReadHandle & {
  enumerateContainedNodes?(rootId: string): Array<Record<string, unknown>>;
};

/** Handle for estimateBlastRadius. */
export type BlastReadHandle = PipelineReadHandle;

/** Handle for listClaims. Widens with bulk claim access. */
export type ListClaimsReadHandle = PipelineReadHandle & {
  allClaimIds?(): string[];
  getClaimRecord?(id: string): ClaimReadRow | null;
};

/** Handle for listUncertainties. Widens with bulk claim access and edge queries. */
export type ListUncertaintiesReadHandle = PipelineReadHandle & {
  allClaimIds?(): string[];
  getClaimRecord?(id: string): ClaimReadRow | null;
  allEdges?(kind?: string): Array<{ fromNodeId: string; toNodeId: string; kind: string }>;
};

/** Handle for buildClaimPayload. */
export type ClaimPayloadReadHandle = PipelineReadHandle & {
  getClaimRecord?(id: string): ClaimReadRow | null;
};

/** Handle for sampleEvidenceAgreement. */
export type EvidenceAgreementReadHandle = PipelineReadHandle & {
  allClaimIds?(): string[];
  getClaimRecord?(id: string): ClaimReadRow | null;
};
