/**
 * TOOL_TABLE: 22 MCP tool definitions for viewer.
 *
 * 14 read tools, 1 verify tool, 6 feedback tools, 1 index tool.
 * Each entry: name, description, Zod input schema, capability class,
 * handler key, and optional pre-dispatch resolution config.
 */

import { z } from 'zod';
import type { CapabilityClass, ReferenceKind } from './types.js';

/** Pre-dispatch config: which arg to resolve and what hint to use. */
export interface ToolPreDispatch {
  argName: string;
  hint: ReferenceKind;
}

/** A single tool table entry. */
export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  capabilityClass: CapabilityClass;
  handlerKey: string;
  preDispatch?: ToolPreDispatch;
}

// -- Zod input schemas for each tool --

const DoctorSchema = z.object({}).strict();

const StatusSchema = z.object({}).strict();

const RepositoryOverviewSchema = z.object({
  repo: z.string().optional(),
  revision: z.string().optional(),
});

const FindEntrypointsSchema = z.object({
  query: z.string(),
  revision: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

const TraceFlowSchema = z.object({
  start: z.string(),
  targetOrIntent: z.string(),
  maxDepth: z.number().int().positive().optional(),
  prefer: z.enum(['tests', 'docs']).optional(),
  edgeKinds: z.array(z.string()).optional(),
});

const ExplainSubsystemSchema = z.object({
  subsystemId: z.string(),
});

const EstimateBlastRadiusSchema = z.object({
  changeScope: z.array(z.string()).min(1),
  maxDepth: z.number().int().positive().optional(),
});

const VerifyClaimSchema = z.object({
  claimId: z.string(),
  strategy: z.enum(['all', 'cheapest']).optional(),
});

const ListClaimsSchema = z.object({
  claimType: z.string().optional().describe(
    'Filter by claim type. Known types: file-defines-symbols, package-imports-package, directory-derived-subsystem-hypothesis, likely-entrypoint. Custom types may also be registered.',
  ),
  status: z.enum(['hypothesis', 'confirmed', 'rejected', 'contradicted', 'stale']).optional(),
  includeLowValue: z.boolean().optional(),
  publicApiOnly: z.boolean().optional(),
});

const ListUncertaintiesSchema = z.object({
  minSeverity: z.enum(['low', 'medium', 'high']).optional(),
  includeDiagnostic: z.boolean().optional(),
  scope: z.object({
    repositoryId: z.string().optional(),
    path: z.string().optional(),
    subsystemId: z.string().optional(),
  }).optional(),
});

const CheckInvariantsSchema = z.object({
  scope: z.object({
    repositoryId: z.string().optional(),
    path: z.string().optional(),
    subsystemId: z.string().optional(),
  }).optional(),
});

const ResolveReferenceSchema = z.object({
  input: z.string(),
  hint: z.enum(['path', 'symbol', 'claim', 'subsystem', 'intent', 'raw-id']).optional(),
});

const GetClaimHistorySchema = z.object({
  claimId: z.string(),
});

const CompareRevisionsSchema = z.object({
  revA: z.string(),
  revB: z.string(),
});

const ConfirmClaimSchema = z.object({
  claimId: z.string(),
  actor: z.string(),
  note: z.string().optional(),
});

const RejectClaimSchema = z.object({
  claimId: z.string(),
  actor: z.string(),
  note: z.string().optional(),
});

const AnnotateClaimSchema = z.object({
  claimId: z.string(),
  actor: z.string(),
  annotation: z.string(),
});

const ConfirmSubsystemSchema = z.object({
  targetId: z.string(),
  actor: z.string(),
  note: z.string().optional(),
});

const RejectSubsystemSchema = z.object({
  targetId: z.string(),
  actor: z.string(),
  note: z.string().optional(),
});

const AnnotateSubsystemSchema = z.object({
  targetId: z.string(),
  actor: z.string(),
  annotation: z.string(),
});

const GetImportGraphSchema = z.object({
  scope: z.string().describe('Scope: file path, subsystem name, or "*" for full repo.'),
  detectCycles: z.boolean().optional().default(false),
  transitiveDeps: z.boolean().optional().default(false),
  maxCycles: z.number().int().positive().optional().default(100),
});

const IndexSchema = z.object({
  repoRoot: z.string(),
  depth: z.number().int().nonnegative().optional(),
  full: z.boolean().optional(),
  workspace: z.enum(['auto', 'force', 'off']).optional(),
  workspaceDepth: z.number().int().positive().optional(),
  workspaceMaxRepos: z.number().int().positive().optional(),
  skipEmbed: z.boolean().optional(),
});

// -- The table --

export const TOOL_TABLE: readonly ToolEntry[] = [
  // === Read tools (14) ===
  {
    name: 'viewer.doctor',
    description: 'Check viewer health: Node.js version, SQLite binding, grammar availability, TS backend, git, model status.',
    inputSchema: DoctorSchema,
    capabilityClass: 'read',
    handlerKey: 'doctor',
  },
  {
    name: 'viewer.status',
    description: 'Return model revision and readiness state.',
    inputSchema: StatusSchema,
    capabilityClass: 'read',
    handlerKey: 'status',
  },
  {
    name: 'viewer.getRepositoryOverview',
    description: 'Get a structured overview of the indexed repository: languages, structure, subsystem candidates, entrypoints, claims, uncertainties.',
    inputSchema: RepositoryOverviewSchema,
    capabilityClass: 'read',
    handlerKey: 'getRepositoryOverview',
  },
  {
    name: 'viewer.findEntrypoints',
    description: 'Find candidate entrypoints matching a free-text intent query. Returns ranked candidates with evidence.',
    inputSchema: FindEntrypointsSchema,
    capabilityClass: 'read',
    handlerKey: 'findEntrypoints',
  },
  {
    name: 'viewer.traceFlow',
    description: 'Trace a flow from a start node toward a target or intent. Returns ordered path segments with edge kinds and confidence.',
    inputSchema: TraceFlowSchema,
    capabilityClass: 'read',
    handlerKey: 'traceFlow',
    preDispatch: { argName: 'start', hint: 'path' },
  },
  {
    name: 'viewer.explainSubsystem',
    description: 'Explain a subsystem: owned files, dependency shape, tests, purpose hypotheses, related claims.',
    inputSchema: ExplainSubsystemSchema,
    capabilityClass: 'read',
    handlerKey: 'explainSubsystem',
    preDispatch: { argName: 'subsystemId', hint: 'subsystem' },
  },
  {
    name: 'viewer.estimateBlastRadius',
    description: 'Estimate blast radius for file changes. RECALL-PRIORITIZED: includes every reachable node, uncertain edges in riskyEdges.',
    inputSchema: EstimateBlastRadiusSchema,
    capabilityClass: 'read',
    handlerKey: 'estimateBlastRadius',
    preDispatch: { argName: 'changeScope', hint: 'path' },
  },
  // === Verify tool (1) ===
  {
    name: 'viewer.verifyClaim',
    description: 'Run verification recipes on a claim, re-score, and create a successor with updated status.',
    inputSchema: VerifyClaimSchema,
    capabilityClass: 'verify',
    handlerKey: 'verifyClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
  },
  // === Read tools (continued) ===
  {
    name: 'viewer.listClaims',
    description: 'List surfaced claims. Filter by type, status. Use includeLowValue for the full pre-policy set.',
    inputSchema: ListClaimsSchema,
    capabilityClass: 'read',
    handlerKey: 'listClaims',
  },
  {
    name: 'viewer.listUncertainties',
    description: 'List uncertainties: sub-threshold claims, stale claims, contradictions, ambiguous memberships, weak edges.',
    inputSchema: ListUncertaintiesSchema,
    capabilityClass: 'read',
    handlerKey: 'listUncertainties',
  },
  {
    name: 'viewer.checkInvariants',
    description: 'Check explicit architecture rules for violations. Returns violations as edges with evidence.',
    inputSchema: CheckInvariantsSchema,
    capabilityClass: 'read',
    handlerKey: 'checkInvariants',
  },
  {
    name: 'viewer.resolveReference',
    description: 'Resolve a path, symbol, claim prefix, subsystem label, or intent to a stored model entity. Side-effect-free.',
    inputSchema: ResolveReferenceSchema,
    capabilityClass: 'read',
    handlerKey: 'resolveReference',
  },
  {
    name: 'viewer.getClaimHistory',
    description: 'Get the history of a claim: annotations, verification history, non-destructive successor chain.',
    inputSchema: GetClaimHistorySchema,
    capabilityClass: 'read',
    handlerKey: 'getClaimHistory',
    preDispatch: { argName: 'claimId', hint: 'claim' },
  },
  {
    name: 'viewer.compareRevisions',
    description: 'Compare two already-indexed revisions. Reports changed files, symbols, edges, and claims.',
    inputSchema: CompareRevisionsSchema,
    capabilityClass: 'read',
    handlerKey: 'compareRevisions',
  },
  // === Feedback tools (6) ===
  {
    name: 'viewer.confirmClaim',
    description: 'Confirm a claim with human annotation evidence. Re-scores and creates a non-destructive successor.',
    inputSchema: ConfirmClaimSchema,
    capabilityClass: 'feedback',
    handlerKey: 'confirmClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
  },
  {
    name: 'viewer.rejectClaim',
    description: 'Reject a claim with human annotation evidence. Creates a non-destructive successor with rejected status.',
    inputSchema: RejectClaimSchema,
    capabilityClass: 'feedback',
    handlerKey: 'rejectClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
  },
  {
    name: 'viewer.annotateClaim',
    description: 'Add an annotation to a claim. Does not change status. Creates a non-destructive successor.',
    inputSchema: AnnotateClaimSchema,
    capabilityClass: 'feedback',
    handlerKey: 'annotateClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
  },
  {
    name: 'viewer.confirmSubsystem',
    description: 'Confirm a subsystem hypothesis with human annotation evidence.',
    inputSchema: ConfirmSubsystemSchema,
    capabilityClass: 'feedback',
    handlerKey: 'confirmSubsystem',
    preDispatch: { argName: 'targetId', hint: 'subsystem' },
  },
  {
    name: 'viewer.rejectSubsystem',
    description: 'Reject a subsystem hypothesis with human annotation evidence.',
    inputSchema: RejectSubsystemSchema,
    capabilityClass: 'feedback',
    handlerKey: 'rejectSubsystem',
    preDispatch: { argName: 'targetId', hint: 'subsystem' },
  },
  {
    name: 'viewer.annotateSubsystem',
    description: 'Add an annotation to a subsystem. Does not change status.',
    inputSchema: AnnotateSubsystemSchema,
    capabilityClass: 'feedback',
    handlerKey: 'annotateSubsystem',
    preDispatch: { argName: 'targetId', hint: 'subsystem' },
  },
  // === Import graph (1) ===
  {
    name: 'viewer.getImportGraph',
    description: 'Query the import graph: adjacency list, fan-in/fan-out, cycle detection (one representative cycle per SCC), transitive dependencies. Scope by file, subsystem, or "*".',
    inputSchema: GetImportGraphSchema,
    capabilityClass: 'read',
    handlerKey: 'getImportGraph',
  },
  // === Index tool (1) ===
  {
    name: 'viewer.index',
    description: 'Index a repository: walk files, extract symbols, resolve imports, mine git history, infer subsystems, generate claims.',
    inputSchema: IndexSchema,
    capabilityClass: 'index',
    handlerKey: 'index',
  },
] as const;
