// Types
export type {
  ConfidenceBand,
  FreshnessBand,
  ClaimStatus,
  EvidenceKind,
  EdgeKind,
  Epistemic,
  NodeKind,
  EvidenceRef,
  ScoredState,
  ChangeSet,
  Claim,
  ClaimCategory,
  Importance,
} from './types.js';

// Scoring
export { computeConfidence, computeFreshness } from './scoring.js';

// Claim state machine
export {
  nextClaimStatus,
  isSurfaceable,
  claimSurfacingClass,
  importanceAtLeast,
  TH_07_SURFACING_CUTOFF,
} from './claim-state.js';

// Stable key
export { stableKey } from './stable-key.js';

// Repository ID
export { deriveRepositoryId } from './repository-id.js';

// Capability
export type { CapabilityClass } from './capability.js';
export { SOURCE_WRITE_IS_UNREPRESENTABLE } from './capability.js';

// Logger
export type { LogLevel, Logger } from './logger.js';
export { createLogger, NULL_LOGGER } from './logger.js';

// Constants
export { DEFAULT_GIT_HISTORY_DEPTH } from './constants.js';
