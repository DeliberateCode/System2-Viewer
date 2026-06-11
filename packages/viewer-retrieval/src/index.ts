// Types
export type {
  StructuredQuery,
  EvidenceRef,
  ExtractionQuality,
  UncertaintyItem,
  SuggestedCall,
  PartialitySummaryRef,
  ResultEnvelope,
  RetrievalQuery,
  RetrievalResult,
  RetrievalAnchor,
  RepositoryOverview,
  EntrypointResult,
  FlowTrace,
  SubsystemExplanation,
  BlastRadiusReport,
  ClaimSummary,
  ClaimSummaryRef,
  SubsystemRef,
  ClaimPayload,
  EvidenceAgreementSample,
  EvidenceAgreementAudit,
  ScopeFilter,
} from './types.js';

// Envelope construction and validation
export { buildEnvelope, assertStructured } from './envelope.js';
export type { EnvelopeInput } from './envelope.js';

// Pipeline
export { runRetrievalPipeline, PIPELINE_STAGES } from './pipeline.js';

// Handle types (internal but re-exported for composition root use)
export type {
  PipelineReadHandle,
  ReadView,
  EntrypointReadHandle,
  FlowReadHandle,
  SubsystemReadHandle,
  BlastReadHandle,
  ListClaimsReadHandle,
  ListUncertaintiesReadHandle,
  ClaimPayloadReadHandle,
  EvidenceAgreementReadHandle,
  NeighborEdge,
  FtsHit,
  ClaimReadRow,
  PartialityRow,
  SimilarityHit,
} from './handles.js';

// Operations
export { getRepositoryOverview } from './ops/overview.js';
export { findEntrypoints } from './ops/entrypoints.js';
export { traceFlow } from './ops/trace.js';
export { explainSubsystem } from './ops/subsystem.js';
export { estimateBlastRadius } from './ops/blast.js';
export { listClaims } from './ops/claims.js';
export { listUncertainties } from './ops/uncertainties.js';

// Utility functions
export { buildClaimPayload } from './ops/claim-payload.js';
export { sampleEvidenceAgreement } from './ops/evidence-agreement.js';
