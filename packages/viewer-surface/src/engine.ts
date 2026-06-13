/**
 * Composition root: createViewerEngine.
 *
 * The SINGLE production seam where all packages meet:
 *   - Opens ModelStore
 *   - Opens separate readonly better-sqlite3 connection
 *   - Loads config rules -> branded EnforceableRule[]
 *   - Computes inferred candidates -> InferredCandidateRule[]
 *   - Persists configured rules via SnapshotTxn.promoteRule()
 *   - Provides withRead<T>(revision, fn) for per-operation snapshots
 *   - Wires all retrieval, verification, and feedback operations
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ModelStore } from '@system2-viewer/viewer-store';
import { deriveRepositoryId, NULL_LOGGER } from '@system2-viewer/viewer-core';
import type { Logger } from '@system2-viewer/viewer-core';
import type { ReadHandle } from '@system2-viewer/viewer-store';
import { loadConfig, buildExcludeSet, DEFAULT_FRAMEWORK_HINTS } from '@system2-viewer/viewer-config';
import type { ViewerConfig, RuleDef } from '@system2-viewer/viewer-config';
import { Indexer, tryLoadEmbedder, resolveBoundaryMembership } from '@system2-viewer/viewer-indexer';
// inferDefaultLayerRules is available for computing inferred candidates
// after indexing; currently deferred until indexed data exists.
import {
  getRepositoryOverview,
  findEntrypoints,
  traceFlow,
  explainSubsystem,
  estimateBlastRadius,
  listClaims,
  listUncertainties,
  buildEnvelope,
  buildClaimPayload,
  sampleEvidenceAgreement,
  getImportGraph,
} from '@system2-viewer/viewer-retrieval';
import type { ResultEnvelope, ExtractionQuality } from '@system2-viewer/viewer-retrieval';
import {
  VerificationEngine,
  RulesEngine,
  checkInvariants as verifyCheckInvariants,
  loadExplicitRules,
} from '@system2-viewer/viewer-verify';
import type {
  BoundaryContext,
  EnforceableRule,
  InferredCandidateRule,
  RuleDefinition,
  VerificationModelHandle,
} from '@system2-viewer/viewer-verify';
// makeInferredCandidate is available from viewer-verify for computing
// inferred candidates after indexing; deferred until indexed data exists.

import { bindHandle } from './bind-handle.js';
import type { UnionHandle } from './bind-handle.js';
import { createFeedbackOperations } from './feedback.js';
import { WriteTxnAdapter } from './write-txn-adapter.js';
import { NoModelIndexedError } from './errors.js';
import { buildDoctorReport } from './doctor.js';
import { buildStatusReport } from './status.js';
import { runInit } from './init.js';
import { generateMcpConfig } from './mcp-config-gen.js';
import { ReferenceResolver } from './reference-resolver.js';
import { compareRevisions as compareRevisionsImpl } from './compare.js';
import { getClaimHistory as getClaimHistoryImpl } from './claim-history.js';
import type {
  ViewerEngine,
  FeedbackOperations,
  IndexerLike,
  CompareRevisionsResult,
  DoctorReport,
  StatusReport,
  ReferenceKind,
} from './types.js';

const DEFAULT_DATA_DIR = '.system2-viewer';

/**
 * Wraps a synchronous operation with timing instrumentation.
 * Logs elapsed time via the provided Logger (NULL_LOGGER by default,
 * so no output unless a real logger is configured).
 */
function withTiming<T>(opName: string, logger: Logger, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  logger.debug(`${opName} completed`, { elapsedMs: Math.round(elapsed) });
  return result;
}

/**
 * Returns true if a string looks like a filesystem path rather than
 * an internal node ID. Heuristic: contains path separators or is '.'.
 */
function looksLikePath(s: string): boolean {
  return s === '.' || s.includes('/') || s.includes('\\');
}

/**
 * Reads and parses .gitignore from the repository root.
 * Returns an empty array if the file is missing or unreadable.
 */
function readGitignorePatterns(repoRoot: string): string[] {
  const gitignorePath = join(repoRoot, '.gitignore');
  try {
    if (!existsSync(gitignorePath)) return [];
    const content = readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Resolves the absolute repo root from the data directory.
 * Falls back to cwd if no persisted workspace locator exists.
 */
function resolveRepoRootAbs(dataDir: string): string | null {
  const locatorPath = join(dataDir, 'workspace-locator.json');
  try {
    if (existsSync(locatorPath)) {
      const raw: unknown = JSON.parse(
        readFileSync(locatorPath, 'utf-8'),
      );
      if (typeof raw === 'object' && raw !== null) {
        const obj = raw as Record<string, unknown>;
        if (typeof obj['repoRoot'] === 'string') {
          const root = obj['repoRoot'];
          // Security check: split on both separators for cross-platform safety
          if (root.split(/[/\\]/).some((seg: string) => seg === '..')) {
            return null;
          }
          return root;
        }
      }
    }
  } catch {
    // Fall through to cwd
  }
  return null;
}

/**
 * Finds the latest revision id from the database.
 * Returns empty string if no revisions exist or db is null.
 */
function latestRevision(db: Database.Database | null): string {
  if (!db) return '';
  const sql = `
    SELECT id FROM revisions
    ORDER BY rowid DESC
    LIMIT 1
  `;
  try {
    const row = db.prepare(sql).get() as { id: string } | undefined;
    return row?.id ?? '';
  } catch {
    // revisions table may not exist yet if no indexing has been done
    // Try nodes table as fallback (repository nodes have revision-like ids)
    try {
      const fallbackSql = `
        SELECT id FROM nodes
        WHERE kind = 'repository' AND valid_to_revision IS NULL
        ORDER BY rowid DESC
        LIMIT 1
      `;
      const row = db.prepare(fallbackSql).get() as { id: string } | undefined;
      return row?.id ?? '';
    } catch {
      return '';
    }
  }
}

/**
 * Derives ExtractionQuality from partiality rows and the configured
 * symbol backend. Returns undefined when no model revision is available.
 */
function deriveExtractionQuality(
  db: Database.Database | null,
  rev: string,
  symbolBackend: string,
): ExtractionQuality | undefined {
  if (!db || rev === '') return undefined;

  const backend: ExtractionQuality['backend'] =
    symbolBackend === 'lsp'
      ? 'lsp'
      : symbolBackend === 'treesitter'
        ? 'treesitter'
        : 'regex-fallback';

  let partialityRows: Array<{
    scope: string;
    failed_json: string | null;
    skipped_json: string | null;
  }> = [];
  try {
    partialityRows = db
      .prepare(
        `SELECT scope, failed_json, skipped_json
         FROM partiality
         WHERE revision = @rev`,
      )
      .all({ rev }) as typeof partialityRows;
  } catch {
    // partiality table may not exist yet
  }

  const grammarsUsed = Array.from(
    new Set(partialityRows.map((r) => r.scope)),
  ).sort();

  let partialityLevel: ExtractionQuality['partialityLevel'] = 'none';
  if (partialityRows.length > 0) {
    const hasFailed = partialityRows.some(
      (r) => r.failed_json !== null && r.failed_json !== '[]',
    );
    partialityLevel = hasFailed ? 'degraded' : 'partial';
  }

  return { backend, grammarsUsed, partialityLevel };
}

/**
 * Opens a fresh ReadHandle, invokes fn with a bound UnionHandle,
 * then closes the ReadHandle. Throws NoModelIndexedError if no
 * model has been indexed.
 */
function withRead<T>(
  store: ModelStore,
  readonlyDb: Database.Database | null,
  revision: string | undefined,
  fn: (handle: UnionHandle, rev: string) => T,
): T {
  if (!readonlyDb) {
    throw new NoModelIndexedError();
  }
  const rev = revision ?? latestRevision(readonlyDb);
  if (rev === '') {
    throw new NoModelIndexedError();
  }
  const readHandle: ReadHandle = store.read(rev);
  try {
    const unionHandle = bindHandle(readHandle, readonlyDb, rev);
    return fn(unionHandle, rev);
  } finally {
    readHandle.close();
  }
}

/**
 * Builds a VerificationModelHandle backed by a readonly db connection.
 *
 * This avoids the nested-transaction conflict that would occur if
 * store.read() (which opens a deferred txn on the store's db) were
 * used alongside store.beginSnapshot() (which also opens a deferred
 * txn on the same connection).  The readonly db is a separate
 * connection, so its reads can coexist with the write txn.
 */
function buildVerificationModelHandle(
  db: Database.Database,
): VerificationModelHandle {
  return {
    getClaim(id: string) {
      const row = db.prepare(
        `SELECT id, claim_type, statement, status, confidence_band,
                freshness_band, valid_from_revision, valid_to_revision,
                scope_json, supporting_evidence_ids_json,
                repository_id, verification_recipes_json, surfaced
         FROM claims
         WHERE id = @id AND valid_to_revision IS NULL`,
      ).get({ id }) as {
        id: string;
        claim_type: string;
        statement: string;
        status: string;
        confidence_band: string;
        freshness_band: string;
        valid_from_revision: string;
        valid_to_revision: string | null;
        scope_json: string;
        supporting_evidence_ids_json: string;
        repository_id: string;
        verification_recipes_json: string;
        surfaced: number;
      } | undefined;
      if (!row) return null;
      return {
        id: row.id,
        claimType: row.claim_type,
        statement: row.statement,
        status: row.status,
        confidenceBand: row.confidence_band,
        freshnessBand: row.freshness_band,
        validFromRevision: row.valid_from_revision,
        validToRevision: row.valid_to_revision,
        scopeJson: row.scope_json,
        supportingEvidenceIds: JSON.parse(row.supporting_evidence_ids_json) as string[],
        repositoryId: row.repository_id,
        verificationRecipesJson: row.verification_recipes_json,
        surfaced: row.surfaced,
      };
    },
    getNode(id: string) {
      return (db.prepare(
        `SELECT * FROM nodes WHERE id = @id AND valid_to_revision IS NULL`,
      ).get({ id }) as Record<string, unknown> | undefined) ?? null;
    },
    neighbors(id: string, kind?: string, maxDepth?: number) {
      const depth = maxDepth ?? 3;
      const kindFilter = kind != null ? 'AND kind = @kind' : '';
      const kindJoinFilter = kind != null ? 'AND e.kind = @kind' : '';
      const sql = `
        WITH RECURSIVE neighbor_cte(id, kind, from_node_id, to_node_id, depth) AS (
          SELECT id, kind, from_node_id, to_node_id, 1
          FROM edges
          WHERE (from_node_id = @id OR to_node_id = @id)
            ${kindFilter}
            AND valid_to_revision IS NULL
          UNION
          SELECT e.id, e.kind, e.from_node_id, e.to_node_id, nc.depth + 1
          FROM edges e
          JOIN neighbor_cte nc ON (e.from_node_id = nc.to_node_id OR e.to_node_id = nc.from_node_id)
          WHERE e.valid_to_revision IS NULL
            ${kindJoinFilter}
            AND nc.depth < @maxDepth
            AND e.id != nc.id
        )
        SELECT DISTINCT nc.id, nc.kind, nc.from_node_id, nc.to_node_id, nc.depth,
               e2.confidence_band, e2.epistemic, e2.evidence_ids_json
        FROM neighbor_cte nc
        JOIN edges e2 ON e2.id = nc.id
        ORDER BY nc.depth, nc.from_node_id, nc.kind, nc.to_node_id, nc.id
      `;
      const params: Record<string, unknown> = { id, maxDepth: depth };
      if (kind != null) params['kind'] = kind;
      const rows = db.prepare(sql).all(params) as Array<{
        id: string; kind: string; from_node_id: string; to_node_id: string; depth: number;
        confidence_band: string | null; epistemic: string | null; evidence_ids_json: string | null;
      }>;
      return rows.map(r => ({
        id: r.id, kind: r.kind, fromNodeId: r.from_node_id, toNodeId: r.to_node_id, depth: r.depth,
        confidenceBand: r.confidence_band, epistemic: r.epistemic, evidenceIdsJson: r.evidence_ids_json,
      }));
    },
  };
}

/** Mutable state shared across engine operations and the indexer callback. */
interface EngineState {
  readonlyDb: Database.Database | null;
  rulesEngine: RulesEngine;
}

/**
 * Opens the ModelStore and a readonly SQLite connection.
 */
function createPersistence(
  dataDir: string,
  config: ViewerConfig,
  readonlyMode: boolean,
): { store: ModelStore; readonlyDb: Database.Database | null } {
  const store = ModelStore.open(dataDir, {
    createIfMissing: !readonlyMode,
    sqliteConfig: config.indexing?.sqlite,
  });

  const dbPath = join(dataDir, 'model.sqlite');
  let readonlyDb: Database.Database | null = null;
  if (existsSync(dbPath)) {
    readonlyDb = new Database(dbPath, { readonly: true });
    readonlyDb.pragma('journal_mode = WAL');
    readonlyDb.pragma('foreign_keys = ON');
  }

  return { store, readonlyDb };
}

/**
 * Loads explicit rules, seeds custom claim types into kind_registry,
 * persists configured rules, and builds the RulesEngine + VerificationEngine.
 */
function createRuleRegistry(
  config: ViewerConfig,
  repositoryId: string,
  store: ModelStore,
  readonlyDb: Database.Database | null,
): { rulesEngine: RulesEngine; verificationEngine: VerificationEngine; engineWarnings: string[] } {
  const ruleDefs: RuleDef[] = config.rules ?? [];
  const ruleDefinitions: RuleDefinition[] = ruleDefs.map(rd => ({
    name: rd.name,
    type: rd.type,
    from: rd.from,
    to: rd.to,
    severity: rd.severity,
    enabled: rd.enabled,
  }));
  const explicitRules: EnforceableRule[] = loadExplicitRules(repositoryId, ruleDefinitions);

  const customClaimTypes = config.claimTypes ?? [];
  if (readonlyDb && customClaimTypes.length > 0) {
    for (const ct of customClaimTypes) {
      store.registerKind(ct.id, 'claim_type');
    }
  }

  const inferredCandidates: InferredCandidateRule[] = [];

  const engineWarnings: string[] = [];
  if (explicitRules.length > 0) {
    const latestRev = latestRevision(readonlyDb);
    if (latestRev !== '') {
      const txn = store.beginSnapshot(latestRev);
      try {
        const now = new Date().toISOString();
        for (const rule of explicitRules) {
          txn.promoteRule({
            id: rule.id,
            name: rule.name,
            ruleType: rule.ruleType,
            status: 'human_confirmed_explicit',
            source: 'explicit',
            repositoryId: rule.repositoryId,
            definitionJson: JSON.stringify(rule.definition),
            validFromRevision: latestRev,
            validToRevision: null,
            createdAt: now,
            updatedAt: now,
          });
        }
        txn.commit();
      } catch (err) {
        txn.abort();
        const msg = err instanceof Error ? err.message : String(err);
        engineWarnings.push(`Failed to persist configured rules: ${msg}`);
      }
    }
  }

  const verificationEngine = new VerificationEngine();
  const rulesEngine = new RulesEngine(explicitRules, inferredCandidates);

  return { rulesEngine, verificationEngine, engineWarnings };
}

/**
 * Wires all retrieval, verification, feedback, and indexer operations
 * into a ViewerEngine. Reads mutable state (readonlyDb, rulesEngine)
 * through the shared EngineState so the indexer callback can update them.
 */
function createOperationDispatcher(
  store: ModelStore,
  state: EngineState,
  verificationEngine: VerificationEngine,
  engineWarnings: string[],
  config: ViewerConfig,
  dataDir: string,
  repoRoot: string,
  logger: Logger,
): ViewerEngine {
  const embedderPromise = tryLoadEmbedder().catch(() => null);

  const gitignorePatterns = readGitignorePatterns(repoRoot);
  const excludeMatcher = buildExcludeSet(config, gitignorePatterns);
  const rawIndexer = new Indexer(store, {
    gitHistoryDepth: config.indexing.gitHistoryDepth,
    symbolBackend: config.indexing.symbolBackend,
    excludes: config.repository.exclude ?? [],
    topologyHints: config.topologyHints,
  }, excludeMatcher, logger);

  const indexer: IndexerLike = {
    async index(input) {
      const embedder = await embedderPromise;
      rawIndexer.setEmbedder(embedder);

      const targetRoot = input.repoRoot;
      const targetConfig = loadConfig(targetRoot);
      const targetGitignore = readGitignorePatterns(targetRoot);
      const targetMatcher = buildExcludeSet(targetConfig, targetGitignore);
      rawIndexer.setExcludeMatcher(targetMatcher);
      rawIndexer.setConfig({
        gitHistoryDepth: targetConfig.indexing.gitHistoryDepth,
        symbolBackend: targetConfig.indexing.symbolBackend,
        excludes: targetConfig.repository.exclude ?? [],
        topologyHints: targetConfig.topologyHints,
      });

      const result = await rawIndexer.index({
        ...input,
        workerCount: input.workerCount ?? targetConfig.indexing.workerCount,
        workerMinFiles: input.workerMinFiles ?? targetConfig.indexing.workerMinFiles,
      });

      const locatorPath = join(dataDir, 'workspace-locator.json');
      writeFileSync(locatorPath, JSON.stringify({ repoRoot: resolve(input.repoRoot) }));

      const targetRuleDefs: RuleDef[] = targetConfig.rules ?? [];
      const targetRuleDefinitions: RuleDefinition[] = targetRuleDefs.map(rd => ({
        name: rd.name,
        type: rd.type,
        from: rd.from,
        to: rd.to,
        severity: rd.severity,
        enabled: rd.enabled,
      }));
      const targetRepositoryId = deriveRepositoryId(targetRoot, targetConfig.repository.name);
      const targetExplicitRules = loadExplicitRules(targetRepositoryId, targetRuleDefinitions);
      const targetInferredCandidates: InferredCandidateRule[] = [];
      state.rulesEngine = new RulesEngine(targetExplicitRules, targetInferredCandidates);

      if (!state.readonlyDb) {
        const freshDbPath = join(dataDir, 'model.sqlite');
        if (existsSync(freshDbPath)) {
          state.readonlyDb = new Database(freshDbPath, { readonly: true });
          state.readonlyDb.pragma('journal_mode = WAL');
          state.readonlyDb.pragma('foreign_keys = ON');
        }
      }

      return result;
    },
  };

  const feedback: FeedbackOperations = createFeedbackOperations(store, state.readonlyDb);

  return {
    getRepositoryOverview(args: Record<string, unknown>) {
      return withTiming('getRepositoryOverview', logger, () =>
        withRead(store, state.readonlyDb, args['revision'] as string | undefined, (handle, rev) => {
          let repoNodeId = (args['repo'] as string) ?? rev;

          if (repoNodeId && looksLikePath(repoNodeId) && state.readonlyDb) {
            const derivedRepoId = deriveRepositoryId(resolve(repoNodeId));
            const found = state.readonlyDb.prepare(
              `SELECT id FROM nodes
               WHERE repository_id = @repoId AND kind = 'repository' AND valid_to_revision IS NULL
               ORDER BY rowid DESC LIMIT 1`,
            ).get({ repoId: derivedRepoId }) as { id: string } | undefined;
            if (found) {
              repoNodeId = found.id;
            }
          }

          let boundaryContexts: { declared: number; totalFiles: number; coveragePercent: number; violationCount: number } | undefined;
          if (config.moduleBoundaries && config.moduleBoundaries.length > 0 && state.readonlyDb) {
            const fileRows = state.readonlyDb.prepare(
              `SELECT path FROM nodes WHERE kind = 'file' AND valid_to_revision IS NULL AND path IS NOT NULL`,
            ).all() as Array<{ path: string }>;
            const filePaths = fileRows.map(r => r.path);
            const resolved = resolveBoundaryMembership(config.moduleBoundaries, filePaths);
            boundaryContexts = {
              declared: config.moduleBoundaries.length,
              totalFiles: filePaths.length,
              coveragePercent: filePaths.length > 0
                ? Math.round((resolved.fileToBoundary.size / filePaths.length) * 100)
                : 0,
              violationCount: 0,
            };
          }

          let eventTopology: { channels: number; edges: number; transports: string[]; unresolvedHints: number } | undefined;
          if (state.readonlyDb) {
            const efRows = state.readonlyDb.prepare(
              `SELECT metadata_json FROM edges WHERE kind = 'event-flow' AND valid_to_revision IS NULL`,
            ).all() as Array<{ metadata_json: string | null }>;
            if (efRows.length > 0) {
              const channels = new Set<string>();
              const transports = new Set<string>();
              for (const row of efRows) {
                if (row.metadata_json) {
                  try {
                    const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
                    if (typeof meta.channel === 'string') channels.add(meta.channel);
                    if (typeof meta.transport === 'string') transports.add(meta.transport);
                  } catch { /* ignore */ }
                }
              }
              eventTopology = {
                channels: channels.size,
                edges: efRows.length,
                transports: Array.from(transports).sort(),
                unresolvedHints: 0,
              };
            }
          }

          return getRepositoryOverview(handle, repoNodeId, {
            revision: rev,
            maxDepth: args['maxDepth'] as number | undefined,
            boundaryContexts,
            eventTopology,
          });
        }),
      );
    },

    findEntrypoints(args: Record<string, unknown>) {
      return withTiming('findEntrypoints', logger, () =>
        withRead(store, state.readonlyDb, args['revision'] as string | undefined, (handle, rev) => {
          return findEntrypoints(handle, args['query'] as string, {
            revision: rev,
            limit: args['limit'] as number | undefined,
            frameworkHints: config.frameworkHints ?? [...DEFAULT_FRAMEWORK_HINTS],
          });
        }),
      );
    },

    traceFlow(args: Record<string, unknown>) {
      return withTiming('traceFlow', logger, () =>
        withRead(store, state.readonlyDb, args['revision'] as string | undefined, (handle, rev) => {
          return traceFlow(handle, args['start'] as string, args['targetOrIntent'] as string, {
            revision: rev,
            maxDepth: args['maxDepth'] as number | undefined,
            prefer: args['prefer'] as 'tests' | 'docs' | undefined,
            edgeKinds: args['edgeKinds'] as string[] | undefined,
          });
        }),
      );
    },

    explainSubsystem(args: Record<string, unknown>) {
      return withTiming('explainSubsystem', logger, () =>
        withRead(store, state.readonlyDb, args['revision'] as string | undefined, (handle, rev) => {
          return explainSubsystem(handle, args['subsystemId'] as string, {
            revision: rev,
          });
        }),
      );
    },

    estimateBlastRadius(args: Record<string, unknown>) {
      return withTiming('estimateBlastRadius', logger, () =>
        withRead(store, state.readonlyDb, args['revision'] as string | undefined, (handle, rev) => {
          return estimateBlastRadius(handle, args['changeScope'] as string[], {
            revision: rev,
            maxDepth: args['maxDepth'] as number | undefined,
          });
        }),
      );
    },

    listClaims(args: Record<string, unknown>) {
      return withTiming('listClaims', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle) => {
          return listClaims(handle, {
            claimType: args['claimType'] as string | undefined,
            status: args['status'] as string | undefined,
            includeLowValue: args['includeLowValue'] as boolean | undefined,
            publicApiOnly: args['publicApiOnly'] as boolean | undefined,
          });
        }),
      );
    },

    listUncertainties(args: Record<string, unknown>) {
      return withTiming('listUncertainties', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle, rev) => {
          return listUncertainties(handle, {
            minSeverity: args['minSeverity'] as string | undefined,
            includeDiagnostic: args['includeDiagnostic'] as boolean | undefined,
            scope: args['scope'] as { repositoryId?: string; path?: string; subsystemId?: string } | undefined,
            revision: rev,
          });
        }),
      );
    },

    checkInvariants(args: Record<string, unknown>) {
      return withTiming('checkInvariants', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle) => {
          let boundaryContext: BoundaryContext | undefined;
          if (config.moduleBoundaries && config.moduleBoundaries.length > 0 && state.readonlyDb) {
            const fileRows = state.readonlyDb.prepare(
              `SELECT path FROM nodes WHERE kind = 'file' AND valid_to_revision IS NULL AND path IS NOT NULL`,
            ).all() as Array<{ path: string }>;
            const filePaths = fileRows.map(r => r.path);
            const resolved = resolveBoundaryMembership(config.moduleBoundaries, filePaths);
            const boundaries = new Map<string, { publicFiles: Set<string>; allowedDependencies?: string[] }>();
            for (const [name, info] of resolved.boundaries) {
              boundaries.set(name, {
                publicFiles: info.publicFiles,
                allowedDependencies: info.def.allowedDependencies,
              });
            }
            boundaryContext = { fileToBoundary: resolved.fileToBoundary, boundaries };
          }
          return verifyCheckInvariants(state.rulesEngine, handle, {
            scope: args['scope'] as { repositoryId?: string; path?: string; subsystemId?: string } | undefined,
            boundaryContext,
          });
        }),
      );
    },

    verifyClaim(args: Record<string, unknown>) {
      return withTiming('verifyClaim', logger, () => {
        if (!state.readonlyDb) {
          throw new NoModelIndexedError();
        }
        const db = state.readonlyDb;
        const rev = latestRevision(db);
        if (rev === '') {
          throw new NoModelIndexedError();
        }
        const claimId = args['claimId'] as string;
        const strategy = args['strategy'] as 'all' | 'cheapest' | undefined;

        const modelHandle = buildVerificationModelHandle(db);
        const txn = store.beginSnapshot(rev);
        const adapter = new WriteTxnAdapter(txn);
        try {
          const result = verificationEngine.verifyClaim(
            claimId,
            modelHandle,
            adapter,
            { strategy, revision: rev },
          );
          adapter.commit();

          return buildEnvelope({
            op: 'verifyClaim',
            args: { claimId, strategy },
            data: result,
            evidence: [],
            uncertainties: [],
            extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
            suggestedNextCalls: [],
            modelRevision: rev,
          });
        } catch (err) {
          adapter.abort();
          throw err;
        }
      });
    },

    buildClaimPayload(args: Record<string, unknown>) {
      return withTiming('buildClaimPayload', logger, () => withRead(store, state.readonlyDb, undefined, (handle, rev) => {
        const claimId = args['claimId'] as string;
        const payload = buildClaimPayload(handle, claimId);
        if (payload === null) {
          return buildEnvelope({
            op: 'buildClaimPayload',
            args: { claimId },
            data: null,
            evidence: [],
            uncertainties: [{
              id: `unc::claim_not_found::${claimId}`,
              kind: 'claim_not_found',
              severity: 'high',
              description: `The specified claim ID does not exist in the current model: ${claimId}. Use \`viewer.listClaims\` to see available claims.`,
              relatedClaimIds: [claimId],
              relatedNodeIds: [],
              recommendedAction: 'Use `viewer.listClaims` to see available claims.',
            }],
            extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
            suggestedNextCalls: [{
              op: 'listClaims',
              args: {},
              reason: 'List available claims',
            }],
            modelRevision: rev,
          });
        }
        return buildEnvelope({
          op: 'buildClaimPayload',
          args: { claimId },
          data: payload,
          evidence: [],
          uncertainties: [],
          extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
          suggestedNextCalls: [],
          modelRevision: rev,
        });
      }));
    },

    sampleEvidenceAgreement(args: Record<string, unknown>) {
      return withTiming('sampleEvidenceAgreement', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle, rev) => {
          const sampleSize = (args['sampleSize'] as number) ?? 10;
          const audit = sampleEvidenceAgreement(handle, sampleSize);
          return buildEnvelope({
            op: 'sampleEvidenceAgreement',
            args: { sampleSize },
            data: audit,
            evidence: [],
            uncertainties: [],
            extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
            suggestedNextCalls: [],
            modelRevision: rev,
          });
        }),
      );
    },

    getImportGraph(args: Record<string, unknown>) {
      return withTiming('getImportGraph', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle, rev) => {
          return getImportGraph(handle, {
            scope: (args['scope'] as string) ?? '*',
            detectCycles: args['detectCycles'] as boolean | undefined,
            transitiveDeps: args['transitiveDeps'] as boolean | undefined,
            maxCycles: (args['maxCycles'] as number | undefined) ?? 100,
          });
        }),
      );
    },

    feedback,

    indexer,

    resolveRef(input: { input: string; hint?: ReferenceKind }) {
      return withTiming('resolveRef', logger, () =>
        withRead(store, state.readonlyDb, undefined, (handle, rev) => {
          const resolver = new ReferenceResolver(handle);
          const result = resolver.resolve(input.input, input.hint);
          return buildEnvelope({
            op: 'resolveReference',
            args: { input: input.input, hint: input.hint },
            data: result,
            evidence: [],
            uncertainties: [],
            extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
            suggestedNextCalls: [],
            modelRevision: rev,
          });
        }),
      );
    },

    getClaimHistory(input: { claimId: string }) {
      return withTiming('getClaimHistory', logger, () =>
        withRead(store, state.readonlyDb, undefined, (_handle, rev) => {
          const result = getClaimHistoryImpl(input, state.readonlyDb!);
          return buildEnvelope({
            op: 'getClaimHistory',
            args: { claimId: input.claimId },
            data: result,
            evidence: [],
            uncertainties: [],
            extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
            suggestedNextCalls: [],
            modelRevision: rev,
          });
        }),
      );
    },

    compareRevisions(input: { revA: string; revB: string }) {
      return withTiming('compareRevisions', logger, () => {
        if (!state.readonlyDb) {
          throw new NoModelIndexedError();
        }
        const result = compareRevisionsImpl(input, state.readonlyDb);
        return buildEnvelope({
          op: 'compareRevisions',
          args: { revA: input.revA, revB: input.revB },
          data: result,
          evidence: [],
          uncertainties: [],
          extractionQuality: deriveExtractionQuality(state.readonlyDb, input.revB, config.indexing.symbolBackend),
          suggestedNextCalls: [],
          modelRevision: input.revB,
        });
      });
    },

    createCustomClaim(input: { claimType: string; statement: string; scope: Record<string, unknown>; actor: string }) {
      return withTiming('createCustomClaim', logger, () => {
        if (!state.readonlyDb) {
          throw new NoModelIndexedError();
        }
        const rev = latestRevision(state.readonlyDb);
        if (rev === '') {
          throw new NoModelIndexedError();
        }

        const now = new Date().toISOString();
        const claimId = `claim::custom::${randomUUID()}`;
        const evidenceId = `ev::custom::${randomUUID()}`;
        const repositoryId = deriveRepositoryId(repoRoot, config.repository.name);

        const txn = store.beginSnapshot(rev);
        try {
          txn.appendEvidence({
            id: evidenceId,
            kind: 'human_annotation',
            epistemic: 'observed',
            repositoryId,
            revision: rev,
            path: null,
            startLine: null,
            endLine: null,
            contentHash: null,
            extractor: 'cli::claim-create',
            derivationLocality: 'local',
            actor: input.actor,
            metadataJson: JSON.stringify({ source: 'createCustomClaim' }),
            createdAt: now,
          });

          txn.versionClaim({
            id: claimId,
            claimType: input.claimType,
            statement: input.statement,
            status: 'hypothesis',
            repositoryId,
            scopeJson: JSON.stringify(input.scope),
            confidenceBand: 'low',
            freshnessBand: 'fresh',
            supportingEvidenceIdsJson: JSON.stringify([evidenceId]),
            contradictingEvidenceIdsJson: '[]',
            verificationRecipesJson: '[]',
            derivationMethod: 'custom',
            generationId: `gen::custom::${randomUUID()}`,
            surfaced: 1,
            validFromRevision: rev,
            validToRevision: null,
            createdAt: now,
            updatedAt: now,
          });

          txn.commit();
        } catch (err) {
          txn.abort();
          throw err;
        }

        return buildEnvelope({
          op: 'createCustomClaim',
          args: { claimType: input.claimType, statement: input.statement, actor: input.actor },
          data: { claimId },
          evidence: [],
          uncertainties: [],
          extractionQuality: deriveExtractionQuality(state.readonlyDb, rev, config.indexing.symbolBackend),
          suggestedNextCalls: [
            {
              op: 'viewer.listClaims',
              args: { claimType: input.claimType },
              reason: 'View claims of this type',
            },
          ],
          modelRevision: rev,
        });
      });
    },

    async doctor() {
      let topologyResolvedCount = 0;
      let topologyUnresolvedCount = 0;
      const topologyTotal = config.topologyHints?.length ?? 0;
      if (topologyTotal > 0 && state.readonlyDb) {
        const rev = latestRevision(state.readonlyDb);
        if (rev) {
          const readH = store.read(rev);
          try {
            const partials = readH.partiality(rev);
            topologyUnresolvedCount = partials.filter(
              (p: { scope: string }) => p.scope.startsWith('topology_hint:'),
            ).length;
          } finally {
            readH.close();
          }
          topologyResolvedCount = topologyTotal - topologyUnresolvedCount;
        }
      }
      const report: DoctorReport = await buildDoctorReport({
        dataDir,
        repoRoot,
        frameworkHintCount: config.frameworkHints?.length ?? 0,
        defaultHintCount: config.frameworkHints ? 0 : DEFAULT_FRAMEWORK_HINTS.length,
        topologyHintCount: topologyTotal,
        topologyResolvedCount,
        topologyUnresolvedCount,
      });
      const data = engineWarnings.length > 0
        ? { ...report, engineWarnings }
        : report;
      const doctorRev = latestRevision(state.readonlyDb) || 'none';
      return buildEnvelope({
        op: 'doctor',
        args: {},
        data,
        evidence: [],
        uncertainties: [],
        extractionQuality: deriveExtractionQuality(state.readonlyDb, doctorRev, config.indexing.symbolBackend),
        suggestedNextCalls: [],
        modelRevision: doctorRev,
      });
    },

    status() {
      const report: StatusReport = buildStatusReport(dataDir);
      const data = engineWarnings.length > 0
        ? { ...report, engineWarnings }
        : report;
      const statusRev = report.modelRevision || 'none';
      return buildEnvelope({
        op: 'status',
        args: {},
        data,
        evidence: [],
        uncertainties: [],
        extractionQuality: deriveExtractionQuality(state.readonlyDb, statusRev, config.indexing.symbolBackend),
        suggestedNextCalls: [],
        modelRevision: statusRev,
      });
    },

    initConfig(input: { force?: boolean; noGitignore?: boolean }) {
      return runInit(repoRoot, { force: input.force, noGitignore: input.noGitignore });
    },

    mcpConfig(input: Record<string, unknown>) {
      return generateMcpConfig({
        package: input['package'] as string,
        target: input['target'] as string | undefined,
        name: input['name'] as string | undefined,
        force: input['force'] as boolean | undefined,
      });
    },

    close() {
      if (state.readonlyDb) state.readonlyDb.close();
      store.close();
    },
  };
}

/**
 * Creates the ViewerEngine -- the single production composition root.
 *
 * Orchestrates persistence, rule registry, and operation dispatcher.
 */
export function createViewerEngine(opts?: {
  dataDir?: string;
  repoRoot?: string;
  readonly?: boolean;
  logger?: Logger;
}): ViewerEngine {
  const dataDir = opts?.dataDir ?? DEFAULT_DATA_DIR;
  const readonlyMode = opts?.readonly ?? false;
  const logger: Logger = opts?.logger ?? NULL_LOGGER;

  // 1. Resolve repo root and load config
  const persistedRoot = resolveRepoRootAbs(dataDir);
  const repoRoot = opts?.repoRoot ?? persistedRoot ?? process.cwd();
  let config: ViewerConfig;
  try {
    config = loadConfig(repoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load configuration: ${msg}. Config file may be malformed. Run \`viewer init --force\` to regenerate.`,
      { cause: err },
    );
  }

  // 2. Open persistence layer (ModelStore + readonly SQLite connection)
  let store: ModelStore;
  let readonlyDb: Database.Database | null;
  try {
    ({ store, readonlyDb } = createPersistence(dataDir, config, readonlyMode));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to open model store: ${msg}. Check that the data directory is writable. Run \`viewer doctor\` for diagnostics.`,
      { cause: err },
    );
  }

  // 3. Load rules, seed kind registry, persist rules, build engines
  const repositoryId = deriveRepositoryId(repoRoot, config.repository.name);
  const { rulesEngine, verificationEngine, engineWarnings } =
    createRuleRegistry(config, repositoryId, store, readonlyDb);

  // 4. Shared mutable state for indexer callback updates
  const state: EngineState = { readonlyDb, rulesEngine };

  // 5. Wire all operations into the engine
  return createOperationDispatcher(
    store, state, verificationEngine, engineWarnings, config, dataDir, repoRoot, logger,
  );
}
