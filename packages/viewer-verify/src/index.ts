// Classes
export { VerificationEngine } from './verification-engine.js';
export { RulesEngine, checkInvariants } from './rules-engine.js';
export type { BoundaryContext } from './rules-engine.js';

// Rule model functions
export {
  loadExplicitRules,
  makeInferredCandidate,
  matchForbiddenImport,
  neverAutoEnforceGuard,
} from './rule-model.js';

// Rule model types
export type {
  EnforceableRule,
  InferredCandidateRule,
  RejectedRule,
  Rule,
} from './rule-model.js';

// Recipes
export { runRecipe, isMvpRecipe } from './recipes.js';

// Rescore
export { rescoreFromEvidence } from './rescore.js';

// On-demand
export {
  generateOnDemandClaims,
  persistOnDemandClaims,
  NON_EAGER_CLAIM_TYPES,
} from './on-demand.js';

// Types
export type {
  RuleDefinition,
  RuleType,
  RuleStatus,
  RuleSource,
  ScopeFilter,
  InvariantCheckResult,
  RuleViolation,
  InferredCandidateClaim,
  VerificationResult,
  VerificationRecipe,
  VerificationModelHandle,
  VerificationWriteTxn,
  VerificationReadHandle,
  RulesReadHandle,
  RuleWriteTxn,
  ModelImportEdge,
  RescoreInput,
  RescoreResult,
  RecipeOutcome,
  RecipeEvidence,
  SourceSpanRef,
  OnDemandReadHandle,
  OnDemandWriteTxn,
  OnDemandQuery,
  OnDemandClaimsResult,
} from './types.js';
