/**
 * Surface-level types for viewer-surface.
 *
 * Defines the ViewerEngine, ViewerOperations, FeedbackOperations,
 * and supporting types for the composition root.
 */

import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import type {
  VerificationResult,
  InvariantCheckResult,
} from '@system2-viewer/viewer-verify';
import type { ProgressReporter } from '@system2-viewer/viewer-indexer';

/** Workspace discovery mode for the indexer. */
export type WorkspaceMode = 'auto' | 'force' | 'off';

/** Capability class for tool partitioning (re-export from viewer-core for convenience). */
export type CapabilityClass = 'read' | 'feedback' | 'verify' | 'index';

/** Descriptor for a single MCP/CLI tool. */
export interface ToolDescriptor {
  name: string;
  capability: CapabilityClass;
  mutatesModel: boolean;
}

/** Result of a feedback operation (confirm/reject/annotate). */
export interface FeedbackSummary {
  claimId: string;
  priorStatus: string;
  newStatus: string;
  evidenceAppended: boolean;
  successorId: string | null;
  error?: string;
}

/** Input shape for claim feedback operations. */
export interface ClaimFeedbackInput {
  claimId: string;
  actor: string;
  note?: string;
}

/** Input shape for claim annotation. */
export interface ClaimAnnotateInput {
  claimId: string;
  actor: string;
  annotation: string;
}

/** Input shape for subsystem feedback operations. */
export interface SubsystemFeedbackInput {
  targetId: string;
  actor: string;
  note?: string;
}

/** Input shape for subsystem annotation. */
export interface SubsystemAnnotateInput {
  targetId: string;
  actor: string;
  annotation: string;
}

/** Six feedback operations: confirm/reject/annotate for claims and subsystems. */
export interface FeedbackOperations {
  confirmClaim(input: ClaimFeedbackInput): FeedbackSummary;
  rejectClaim(input: ClaimFeedbackInput): FeedbackSummary;
  annotateClaim(input: ClaimAnnotateInput): FeedbackSummary;
  confirmSubsystem(input: SubsystemFeedbackInput): FeedbackSummary;
  rejectSubsystem(input: SubsystemFeedbackInput): FeedbackSummary;
  annotateSubsystem(input: SubsystemAnnotateInput): FeedbackSummary;
}

/** Structural read handle for feedback operations (load claim from readonly db). */
export interface FeedbackReadHandle {
  getClaim(id: string): FeedbackClaimRecord | null;
  getEvidence(id: string): { id: string; kind: string } | null;
}

/** Structural write handle for feedback operations. */
export interface FeedbackWriteTxn {
  appendEvidence(row: Record<string, unknown>): void;
  versionClaim(row: Record<string, unknown>): void;
  closeInterval(id: string, revision: string): void;
  commit(): void;
  abort(): void;
}

/** Claim record shape needed by feedback operations. */
export interface FeedbackClaimRecord {
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
}

/** Indexer-like interface for engine composition (avoids importing Indexer class type directly). */
export interface IndexerLike {
  index(input: {
    repoRoot: string;
    depth?: number;
    full?: boolean;
    workspace?: WorkspaceMode;
    workspaceDepth?: number;
    workspaceMaxRepos?: number;
    skipEmbed?: boolean;
    repositoryName?: string;
    progress?: ProgressReporter;
    workerCount?: number;
    workerMinFiles?: number;
  }): Promise<{ revision: string }>;
}

/** Map of operation names to functions for CLI and MCP dispatch. */
export interface ViewerOperations {
  getRepositoryOverview(args: Record<string, unknown>): ResultEnvelope<unknown>;
  findEntrypoints(args: Record<string, unknown>): ResultEnvelope<unknown>;
  traceFlow(args: Record<string, unknown>): ResultEnvelope<unknown>;
  explainSubsystem(args: Record<string, unknown>): ResultEnvelope<unknown>;
  estimateBlastRadius(args: Record<string, unknown>): ResultEnvelope<unknown>;
  listClaims(args: Record<string, unknown>): ResultEnvelope<unknown>;
  listUncertainties(args: Record<string, unknown>): ResultEnvelope<unknown>;
  checkInvariants(args: Record<string, unknown>): ResultEnvelope<InvariantCheckResult>;
  verifyClaim(args: Record<string, unknown>): ResultEnvelope<VerificationResult>;
  buildClaimPayload(args: Record<string, unknown>): ResultEnvelope<unknown>;
  sampleEvidenceAgreement(args: Record<string, unknown>): ResultEnvelope<unknown>;
}

/** Result of the `init` command. */
export interface InitResult {
  configPath: string;
  created: boolean;
  existed: boolean;
  gitignorePath?: string;
}

/** Result of the `mcp-config` command. */
export interface McpConfigResult {
  targetPath: string;
  created: boolean;
}

/** Reference kind for the resolver. */
export type ReferenceKind =
  | 'path'
  | 'symbol'
  | 'claim'
  | 'subsystem'
  | 'intent'
  | 'raw-id';

/** Result of reference resolution. */
export type ResolveResult =
  | { status: 'resolved'; id: string; kind: ReferenceKind; displayName: string }
  | { status: 'ambiguous'; candidates: Array<{ id: string; displayName: string }> }
  | { status: 'not_found'; input: string };

/** A detected rename candidate between two revisions. */
export interface RenameCandidate {
  oldPath: string;
  newPath: string;
  confidence: number;
}

/** Result of comparing two already-indexed revisions. */
export interface CompareRevisionsResult {
  revA: string;
  revB: string;
  changedFiles: string[];
  changedSymbols: string[];
  changedEdges: string[];
  changedClaims: string[];
  renames: RenameCandidate[];
}

/** Per-language grammar probe status. */
export type GrammarStatus = 'available' | 'load_failed' | 'not_installed' | 'checksum_mismatch';

/** Actionable suggestion from doctor diagnostics. */
export interface DoctorSuggestion {
  issue: string;
  command: string;
  severity: 'error' | 'warning' | 'info';
}

/** Result of running doctor --fix auto-remediation. */
export interface DoctorFixResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/** Doctor report result type. */
export interface DoctorReport {
  nodeVersion: string;
  sqliteBinding: boolean;
  nativeBinding?: 'prebuilt' | 'compiled' | 'unknown';
  grammarAvailability: Record<string, boolean>;
  grammars?: Record<string, GrammarStatus>;
  tsBackendAvailable: boolean;
  gitAvailable: boolean;
  modelStatus: string;
  configuredBackend?: string;
  effectiveBackend: string;
  degradationReason: string | null;
  backendCoverage: Record<string, unknown>;
  embeddingModel?: {
    status: 'available' | 'not_installed' | 'load_failed';
    modelName?: string;
    dimension?: number;
  };
  sqlitePragmas?: {
    pageSize: number;
    cacheSize: number;
    mmapSize: number;
    busyTimeout: number;
  };
  secretPatternCount?: number;
  secretScrubbing?: {
    coverage: 'full' | 'partial' | 'none';
    patternCount: number;
  };
  workerPool?: {
    configured: number;
    effective: number;
    available: number;
  };
  absolutePathsDetected?: boolean;
  suggestions: DoctorSuggestion[];
  schemaMigration?: {
    currentVersion: number;
    latestVersion: number;
    pendingMigrations: number;
    appliedMigrations: Array<{ version: number; name: string; appliedAt: string }>;
  };
}

/** Options for buildDoctorReport. */
export interface DoctorOpts {
  dataDir?: string;
  repoRoot?: string;
}

/** Status report result type. */
export interface StatusReport {
  modelRevision: string;
  readinessState: string;
  hasPartiality: boolean;
}

/** CLI operations interface (union of viewer ops + feedback + special ops). */
export interface CliOps extends ViewerOperations {
  feedback: FeedbackOperations;
  index(args: Record<string, unknown>): Promise<ResultEnvelope<unknown>>;
  resolveRef(args: { input: string; hint?: ReferenceKind }): ResultEnvelope<ResolveResult>;
  getClaimHistory(args: { claimId: string }): ResultEnvelope<unknown>;
  compareRevisions(args: { revA: string; revB: string }): ResultEnvelope<CompareRevisionsResult>;
  createCustomClaim(args: CreateCustomClaimInput): ResultEnvelope<CreateCustomClaimResult>;
  doctor(): Promise<ResultEnvelope<DoctorReport>>;
  status(): ResultEnvelope<StatusReport>;
  initConfig(args: { force?: boolean; noGitignore?: boolean }): InitResult;
  mcpConfig?(args: Record<string, unknown>): McpConfigResult;
}

/** Input for creating a custom claim. */
export interface CreateCustomClaimInput {
  claimType: string;
  statement: string;
  scope: Record<string, unknown>;
  actor: string;
}

/** Result of creating a custom claim. */
export interface CreateCustomClaimResult {
  claimId: string;
}

/** Full ViewerEngine interface returned by createViewerEngine. */
export interface ViewerEngine extends ViewerOperations {
  feedback: FeedbackOperations;
  indexer: IndexerLike;
  resolveRef(input: { input: string; hint?: ReferenceKind }): ResultEnvelope<ResolveResult>;
  getClaimHistory(input: { claimId: string }): ResultEnvelope<unknown>;
  compareRevisions(input: { revA: string; revB: string }): ResultEnvelope<CompareRevisionsResult>;
  createCustomClaim(input: CreateCustomClaimInput): ResultEnvelope<CreateCustomClaimResult>;
  doctor(): Promise<ResultEnvelope<DoctorReport>>;
  status(): ResultEnvelope<StatusReport>;
  initConfig(input: { force?: boolean; noGitignore?: boolean }): InitResult;
  mcpConfig?(input: Record<string, unknown>): McpConfigResult;
  close(): void;
}

/** Derived view types for CLI rendering (defined here). */
export type ViewKind =
  | 'overview'
  | 'entrypoints'
  | 'trace'
  | 'subsystem'
  | 'blast'
  | 'claims'
  | 'uncertainties'
  | 'invariants'
  | 'verify'
  | 'feedback'
  | 'doctor'
  | 'status'
  | 'resolve'
  | 'history'
  | 'compare'
  | 'init'
  | 'mcp-config'
  | 'index'
  | 'generic';

export interface ViewLine {
  text: string;
  backing:
    | { type: 'evidence'; evidenceId: string }
    | { type: 'claim'; claimId: string }
    | { type: 'hypothesis' }
    | { type: 'trivial' };
  uncertainty?: string;
}

export interface DerivedView {
  kind: ViewKind;
  op: string;
  modelRevision: string;
  lines: ViewLine[];
}
