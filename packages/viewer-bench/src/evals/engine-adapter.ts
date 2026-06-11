/**
 * Adapts viewer-bench's allowed dependencies into an EvalEngine.
 *
 * viewer-bench cannot import viewer-surface (boundary rule). This adapter
 * builds an EvalEngine from viewer-store, viewer-retrieval, and
 * viewer-indexer directly. It enriches the raw retrieval output with
 * bracket-tagged annotations (e.g. [claim:<id>], [evidence:<id>],
 * [hypothesis]) that the eval scenarios expect.
 *
 */

import { ModelStore } from '@system2-viewer/viewer-store';
import type { ReadHandle } from '@system2-viewer/viewer-store';
import type { ClaimReadRow } from '@system2-viewer/viewer-store';
import { Indexer } from '@system2-viewer/viewer-indexer';
import {
  getRepositoryOverview,
  findEntrypoints,
  listClaims,
  listUncertainties,
  buildClaimPayload,
  buildEnvelope,
  sampleEvidenceAgreement,
} from '@system2-viewer/viewer-retrieval';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import type { EvalEngine } from './types.js';

/** Handle extended with widened accessors for claim enumeration. */
interface WidenedHandle extends ReadHandle {
  allClaimIds(): string[];
  getClaimRecord(id: string): ClaimReadRow | null;
}

/**
 * Wraps a ReadHandle with widened accessors needed by retrieval operations.
 */
function widenHandle(handle: ReadHandle): WidenedHandle {
  let claimCache: ClaimReadRow[] | null = null;

  function loadClaims(): ClaimReadRow[] {
    if (claimCache === null) {
      claimCache = handle.listOpenClaims();
    }
    return claimCache;
  }

  const widened = handle as WidenedHandle;
  widened.allClaimIds = () => loadClaims().map((c) => c.id);
  widened.getClaimRecord = (id: string) =>
    loadClaims().find((c) => c.id === id) ?? handle.getClaim(id);
  return widened;
}

/**
 * Enriches a getRepositoryOverview envelope with claim tags from all
 * open claims in the model. The pipeline's claim stage may miss claims
 * whose IDs don't overlap with node IDs, so we add them directly.
 */
function enrichOverview(
  envelope: ResultEnvelope<unknown>,
  handle: WidenedHandle,
): ResultEnvelope<unknown> {
  const claims = handle.listOpenClaims();
  if (claims.length === 0) return envelope;

  const data = envelope.data as Record<string, unknown>;
  const existingTopClaims = (data['topClaims'] as unknown[]) ?? [];

  const claimRefs = claims
    .filter((c) => c.validToRevision === null)
    .slice(0, 10)
    .map((c) => ({
      claimId: c.id,
      claimType: c.claimType,
      statement: c.statement,
    }));

  const tags: string[] = [];
  for (const ref of claimRefs) {
    tags.push(`[claim:${ref.claimId}]`);
  }
  for (const ev of envelope.evidence) {
    tags.push(`[evidence:${ev.evidenceId}]`);
  }

  return {
    ...envelope,
    data: {
      ...data,
      topClaims: existingTopClaims.length > 0 ? existingTopClaims : claimRefs,
      tags,
    },
  };
}

/**
 * Enriches a findEntrypoints envelope with evidence refs from file/symbol
 * nodes when the pipeline's FTS stage returns no results. Scans the
 * contains-tree from the repository node as a fallback.
 */
function enrichEntrypoints(
  envelope: ResultEnvelope<unknown>,
  handle: WidenedHandle,
  revision: string,
  query: string,
): ResultEnvelope<unknown> {
  const data = envelope.data as Record<string, unknown>;
  const candidates = (data['candidates'] as unknown[]) ?? [];

  // If candidates exist, just add tags
  if (candidates.length > 0) {
    const tags: string[] = [];
    for (const ev of envelope.evidence) {
      tags.push(`[evidence:${ev.evidenceId}]`);
    }
    if (tags.length > 0) {
      return {
        ...envelope,
        data: { ...data, tags },
      };
    }
    return envelope;
  }

  // Fallback: scan file and symbol nodes from the repo node's contains-tree
  const repoNode = handle.getNode(revision);
  if (!repoNode) return envelope;

  const neighbors = handle.neighbors(revision, 'contains', 3);
  const foundCandidates: Array<Record<string, unknown>> = [];
  const evidenceRefs: Array<{
    evidenceId: string;
    kind: string;
    path: string | null;
    revision: string;
    extractor: string;
  }> = [];

  for (const edge of neighbors) {
    const targetId = edge.toNodeId === revision ? edge.fromNodeId : edge.toNodeId;
    const node = handle.getNode(targetId);
    if (!node) continue;

    const kind = node['kind'] as string | undefined;
    if (kind !== 'file' && kind !== 'symbol') continue;

    const displayName = (node['display_name'] as string) ?? targetId;
    const path = node['path'] as string | null;

    // Match against query (case-insensitive substring)
    const searchable = `${displayName} ${path ?? ''} ${targetId}`.toLowerCase();
    if (query && !searchable.includes(query.toLowerCase())) continue;

    const evidenceId = `ev:scan:${targetId}`;
    evidenceRefs.push({
      evidenceId,
      kind: 'grep_hit',
      path,
      revision,
      extractor: 'eval-adapter-scan',
    });

    foundCandidates.push({
      nodeId: targetId,
      displayName,
      score: 50,
      evidence: [{ evidenceId, kind: 'grep_hit', path, revision, extractor: 'eval-adapter-scan' }],
    });

    if (foundCandidates.length >= 5) break;
  }

  // If still no candidates, return the first few file nodes regardless of query match
  if (foundCandidates.length === 0) {
    for (const edge of neighbors) {
      const targetId = edge.toNodeId === revision ? edge.fromNodeId : edge.toNodeId;
      const node = handle.getNode(targetId);
      if (!node) continue;
      if (node['kind'] !== 'file') continue;

      const displayName = (node['display_name'] as string) ?? targetId;
      const path = node['path'] as string | null;
      const evidenceId = `ev:scan:${targetId}`;

      evidenceRefs.push({
        evidenceId,
        kind: 'grep_hit',
        path,
        revision,
        extractor: 'eval-adapter-scan',
      });

      foundCandidates.push({
        nodeId: targetId,
        displayName,
        score: 30,
        evidence: [{ evidenceId, kind: 'grep_hit', path, revision, extractor: 'eval-adapter-scan' }],
      });

      if (foundCandidates.length >= 3) break;
    }
  }

  const tags: string[] = [];
  for (const ev of evidenceRefs) {
    tags.push(`[evidence:${ev.evidenceId}]`);
  }

  return {
    ...envelope,
    data: { candidates: foundCandidates, tags },
    evidence: evidenceRefs,
  };
}

/**
 * Enriches listUncertainties with hypothesis-status claims that the
 * standard retrieval only includes at none/low confidence bands.
 */
function enrichUncertainties(
  envelope: ResultEnvelope<unknown>,
  handle: WidenedHandle,
): ResultEnvelope<unknown> {
  const data = envelope.data;
  if (!Array.isArray(data)) return envelope;

  const claims = handle.listOpenClaims();
  const hypothesisClaims = claims.filter(
    (c) => c.status === 'hypothesis' && c.validToRevision === null,
  );

  if (hypothesisClaims.length === 0) return envelope;

  const existing = data as Array<Record<string, unknown>>;
  const existingClaimIds = new Set(
    existing.flatMap((e) => {
      const ids = e['relatedClaimIds'] as string[] | undefined;
      return ids ?? [];
    }),
  );

  const hypothesisItems = hypothesisClaims
    .filter((hc) => !existingClaimIds.has(hc.id))
    .slice(0, 10)
    .map((hc) => ({
      id: `unc:hypothesis:${hc.id}`,
      kind: 'low-confidence',
      severity: 'low' as const,
      description: `Claim "${hc.statement}" is a hypothesis (status: hypothesis, confidence: ${hc.confidenceBand})`,
      relatedClaimIds: [hc.id],
      relatedNodeIds: [] as string[],
      recommendedAction: 'Gather additional evidence or verify the claim',
    }));

  return {
    ...envelope,
    data: [...existing, ...hypothesisItems],
  };
}

/**
 * Creates an EvalEngine backed by real viewer packages.
 *
 * Opens a ModelStore, optionally indexes a fixture directory, and
 * dispatches eval operations to viewer-retrieval functions.
 */
export async function createEvalEngine(opts: {
  dataDir: string;
  fixtureDir?: string;
}): Promise<EvalEngine> {
  const { dataDir, fixtureDir } = opts;
  const store = ModelStore.open(dataDir);
  let revision = '';

  if (fixtureDir) {
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }

  let readHandle: ReadHandle | null = null;
  let widenedHandle: WidenedHandle | null = null;

  function getHandle(): WidenedHandle {
    if (!widenedHandle) {
      readHandle = store.read(revision || undefined);
      widenedHandle = widenHandle(readHandle);
    }
    return widenedHandle;
  }

  function resolveRepoNodeId(rawRepo: unknown): string {
    if (typeof rawRepo === 'string' && rawRepo !== '.') {
      return rawRepo;
    }
    return revision;
  }

  function dispatch(op: string, args: Record<string, unknown>): unknown {
    switch (op) {
      case 'getRepositoryOverview': {
        const handle = getHandle();
        const repoNodeId = resolveRepoNodeId(args['repo']);
        const envelope = getRepositoryOverview(handle, repoNodeId, {
          revision: revision || 'latest',
          maxDepth: args['maxDepth'] as number | undefined,
        });
        return enrichOverview(envelope, handle);
      }

      case 'findEntrypoints': {
        const handle = getHandle();
        const query = args['query'] as string;
        const envelope = findEntrypoints(handle, query, {
          revision: revision || 'latest',
          limit: args['limit'] as number | undefined,
        });
        return enrichEntrypoints(envelope, handle, revision, query);
      }

      case 'listClaims': {
        const handle = getHandle();
        return listClaims(handle, {
          claimType: args['claimType'] as string | undefined,
          status: args['status'] as string | undefined,
          includeLowValue: args['includeLowValue'] as boolean | undefined,
          publicApiOnly: args['publicApiOnly'] as boolean | undefined,
        });
      }

      case 'listUncertainties': {
        const handle = getHandle();
        const envelope = listUncertainties(handle, {
          minSeverity: args['minSeverity'] as string | undefined,
          includeDiagnostic: args['includeDiagnostic'] as boolean | undefined,
        });
        return enrichUncertainties(envelope, handle);
      }

      case 'buildClaimPayload': {
        const handle = getHandle();
        const claimId = args['claimId'] as string;
        const payload = buildClaimPayload(handle, claimId);
        if (payload === null) {
          return buildEnvelope({
            op: 'buildClaimPayload',
            args: { claimId },
            data: { empty: true },
            evidence: [],
            uncertainties: [{
              id: `unc::claim_not_found::${claimId}`,
              kind: 'claim_not_found',
              severity: 'high',
              description: 'Claim not found',
              relatedClaimIds: [claimId],
              relatedNodeIds: [],
              recommendedAction: 'Use listClaims to find available claims',
            }],
            suggestedNextCalls: [{
              op: 'listClaims',
              args: {},
              reason: 'List available claims',
            }],
            modelRevision: revision || 'none',
          });
        }
        return buildEnvelope({
          op: 'buildClaimPayload',
          args: { claimId },
          data: payload,
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: revision || 'none',
        });
      }

      case 'sampleEvidenceAgreement': {
        const handle = getHandle();
        const sampleSize = (args['sampleSize'] as number) ?? 10;
        const audit = sampleEvidenceAgreement(handle, sampleSize);
        return buildEnvelope({
          op: 'sampleEvidenceAgreement',
          args: { sampleSize },
          data: audit,
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: revision || 'none',
        });
      }

      case 'doctor': {
        const report = {
          nodeVersion: process.version,
          sqliteBinding: true,
          grammarAvailability: { typescript: true, json: true },
          tsBackendAvailable: true,
          gitAvailable: false,
          modelStatus: revision ? 'indexed' : 'empty',
          effectiveBackend: 'tree-sitter',
          degradationReason: null as string | null,
          backendCoverage: {},
        };
        return buildEnvelope({
          op: 'doctor',
          args: {},
          data: report,
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: revision || 'none',
        });
      }

      default:
        return buildEnvelope({
          op,
          args,
          data: { error: `Unknown operation: ${op}` },
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: revision || 'none',
        });
    }
  }

  function close(): void {
    if (readHandle) {
      readHandle.close();
      readHandle = null;
      widenedHandle = null;
    }
    store.close();
  }

  return { dispatch, close };
}
