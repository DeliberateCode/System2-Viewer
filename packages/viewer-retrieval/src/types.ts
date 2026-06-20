/**
 * viewer-retrieval response types.
 *
 * These are the structured types returned by retrieval operations.
 */

/** Structured query echo included in every ResultEnvelope. */
export interface StructuredQuery {
  op: string;
  args: Record<string, unknown>;
}

/** Resolvable evidence pointer for retrieval results. */
export interface EvidenceRef {
  evidenceId: string;
  kind: string;
  path: string | null;
  revision: string;
  extractor: string;
}

/** A decision-relevant uncertainty surfaced in retrieval results. */
export interface UncertaintyItem {
  id: string;
  kind: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  relatedClaimIds: string[];
  relatedNodeIds: string[];
  recommendedAction: string;
}

/** Suggested next MCP call for agent guidance. */
export interface SuggestedCall {
  op: string;
  args: Record<string, unknown>;
  reason: string;
}

/** Reference to a partiality summary when the result is partial. */
export interface PartialitySummaryRef {
  ref: string;
  scopes: Array<{ id: string; scope: string }>;
}

/** Quality metadata for the extraction backend used to build the model. */
export interface ExtractionQuality {
  backend: 'treesitter' | 'lsp' | 'regex-fallback';
  grammarsUsed: string[];
  partialityLevel: 'none' | 'partial' | 'degraded';
}

/** Universal response wrapper for all read operations. */
export interface ResultEnvelope<T> {
  query: StructuredQuery;
  data: T;
  evidence: EvidenceRef[];
  uncertainties: UncertaintyItem[];
  partiality?: PartialitySummaryRef;
  extractionQuality?: ExtractionQuality;
  suggestedNextCalls: SuggestedCall[];
  modelRevision: string;
}

/** Input to the retrieval pipeline. */
export interface RetrievalQuery {
  text?: string;
  nodeIds?: string[];
  revision: string;
  maxDepth?: number;
  queryEmbedding?: Float32Array;
}

/** A single anchor produced by a pipeline stage. */
export interface RetrievalAnchor {
  id: string;
  kind: string;
  source: string;
  rank: number;
  data: Record<string, unknown>;
}

/** Result of the retrieval pipeline. */
export interface RetrievalResult {
  anchors: RetrievalAnchor[];
  revision: string;
}

/** Repository overview result data. */
export interface BoundaryContextsSummary {
  declared: number;
  totalFiles: number;
  coveragePercent: number;
  violationCount?: number;
}

export interface EventTopologySummary {
  channels: number;
  edges: number;
  transports: string[];
  unresolvedHints?: number;
}

export interface RepositoryOverview {
  mainLanguages: string[];
  structure: { directories: number; totalFiles: number };
  candidateSubsystems: SubsystemRef[];
  candidateEntrypoints: string[];
  topClaims: ClaimSummaryRef[];
  topUncertainties: UncertaintyItem[];
  backendCoverage: Record<string, unknown>;
  boundaryContexts?: BoundaryContextsSummary;
  eventTopology?: EventTopologySummary;
}

/** Entrypoint search result data. */
export interface EntrypointResult {
  candidates: Array<{
    nodeId: string;
    displayName: string;
    score: number;
    evidence: EvidenceRef[];
    source?: string;
    entrypointKind?: string;
  }>;
}

/** Flow trace result data. */
export interface FlowTrace {
  segments: Array<{
    fromNodeId: string;
    toNodeId: string;
    edgeKind: string;
    epistemic: string;
    confidence: string;
    evidence: EvidenceRef[];
    unknown?: boolean;
    ambiguity?: string;
    declaredTag?: string;
  }>;
}

/** Subsystem explanation result data. */
export interface SubsystemExplanation {
  subsystemId: string;
  ownedFiles: string[];
  dependencies: { inbound: string[]; outbound: string[] };
  tests: string[];
  purposeHypotheses: string[];
  relatedClaims: ClaimSummaryRef[];
  contradictions: ClaimSummaryRef[];
}

/** Blast radius report result data. */
export interface BlastRadiusReport {
  affectedNodes: Array<{
    nodeId: string;
    distance: number;
    viaUncertainEdge: boolean;
  }>;
  riskyEdges: Array<{
    edgeId: string;
    fromNodeId: string;
    toNodeId: string;
    confidence: string;
    epistemic: string;
  }>;
}

/** Summary of a single claim for list results. */
export interface ClaimSummary {
  id: string;
  claimType: string;
  statement: string;
  status: string;
  confidence: string;
  freshness: string;
}

/** Resolvable claim reference for overview/subsystem results. */
export interface ClaimSummaryRef {
  claimId: string;
  claimType: string;
  statement: string;
}

/** Reference to a subsystem. */
export interface SubsystemRef {
  id: string;
  name: string;
}

/** Payload for a single claim with full detail. */
export interface ClaimPayload {
  id: string;
  claimType: string;
  statement: string;
  status: string;
  confidence: string;
  freshness: string;
  supportingEvidence: EvidenceRef[];
  contradictingEvidence: EvidenceRef[];
  verificationRecipes: Array<{ recipeType: string; description: string }>;
}

/** A single evidence agreement sample. */
export interface EvidenceAgreementSample {
  claimId: string;
  evidenceId: string;
  agrees: boolean;
  reason: string;
}

/** Result of evidence agreement audit. */
export interface EvidenceAgreementAudit {
  sampleSize: number;
  agreementRate: number;
  samples: EvidenceAgreementSample[];
}

/** Scope filter for list operations. */
export interface ScopeFilter {
  repositoryId?: string;
  path?: string;
  subsystemId?: string;
}
