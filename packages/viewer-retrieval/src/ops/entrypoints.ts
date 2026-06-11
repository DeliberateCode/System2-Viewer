/**
 * findEntrypoints operation.
 *
 * Free-text intent via pipeline with FTS5-safe search.
 * Returns ranked candidates with evidence refs.
 */

import type { EntrypointReadHandle } from '../handles.js';
import type {
  ResultEnvelope,
  EntrypointResult,
  EvidenceRef,
  UncertaintyItem,
} from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';
import { runRetrievalPipeline } from '../pipeline.js';

export function findEntrypoints(
  handle: EntrypointReadHandle,
  query: string,
  opts?: { revision?: string; limit?: number },
): ResultEnvelope<EntrypointResult> {
  const revision = opts?.revision ?? 'latest';
  const limit = opts?.limit ?? 20;

  // Run pipeline with text query (FTS5-safe quoting happens inside the lexical stage)
  const pipelineResult = runRetrievalPipeline(handle, {
    text: query,
    revision,
  });

  const candidates: EntrypointResult['candidates'] = [];
  const evidence: EvidenceRef[] = [];
  const uncertainties: UncertaintyItem[] = [];
  const seen = new Set<string>();

  // Seed with known entrypoint claims so declared entrypoints always surface.
  if (handle.claimsByPrefix) {
    const entrypointClaims = handle.claimsByPrefix('claim::')
      .filter((c) => c.claimType === 'likely-entrypoint');
    for (const claim of entrypointClaims) {
      if (candidates.length >= limit) break;
      const scope = claim.scopeJson ? JSON.parse(claim.scopeJson) as Record<string, unknown> : null;
      const path = scope?.['path'] as string | undefined;
      if (!path) continue;

      // Resolve the file node: claim:: prefix → node:: prefix, strip ::entrypoint suffix
      const nodeId = 'node' + claim.id.slice('claim'.length).replace(/::entrypoint$/, '');
      const node = handle.getNode(nodeId);
      if (!node) continue;

      const displayName =
        (node['display_name'] as string) ?? path;

      const claimEvidence: EvidenceRef[] = [{
        evidenceId: claim.id,
        kind: 'claim',
        path,
        revision,
        extractor: 'indexer::classify',
      }];

      candidates.push({
        nodeId,
        displayName,
        score: 90,
        evidence: claimEvidence,
      });
      evidence.push(...claimEvidence);
      seen.add(nodeId);
    }
  }

  for (const anchor of pipelineResult.anchors) {
    if (candidates.length >= limit) break;
    if (seen.has(anchor.id)) continue;

    const node = handle.getNode(anchor.id);
    if (!node) continue;

    const kind = node['kind'] as string | undefined;
    if (kind !== 'file' && kind !== 'symbol') continue;

    const displayName =
      (node['display_name'] as string) ??
      (node['path'] as string) ??
      anchor.id;

    const candidateEvidence: EvidenceRef[] = [];
    if (anchor.data['text']) {
      candidateEvidence.push({
        evidenceId: `fts:${anchor.id}`,
        kind: 'grep_hit',
        path: (anchor.data['path'] as string) ?? null,
        revision,
        extractor: anchor.source,
      });
    }

    candidates.push({
      nodeId: anchor.id,
      displayName,
      score: anchor.rank,
      evidence: candidateEvidence,
    });

    evidence.push(...candidateEvidence);
    seen.add(anchor.id);
  }

  // If no candidates found and query was non-empty, note the uncertainty
  if (candidates.length === 0 && query.length > 0) {
    uncertainties.push({
      id: `uncertainty:no-entrypoints:${query}`,
      kind: 'low-confidence',
      severity: 'medium',
      description: `No entrypoint candidates found for query "${query}"`,
      relatedClaimIds: [],
      relatedNodeIds: [],
      recommendedAction: 'Try a broader query or verify the index is up to date',
    });
  }

  const data: EntrypointResult = { candidates };

  const envelope = buildEnvelope<EntrypointResult>({
    op: 'findEntrypoints',
    args: { query, revision, limit },
    data,
    evidence,
    uncertainties,
    modelRevision: revision,
    suggestedNextCalls: candidates.length > 0
      ? [
          {
            op: 'viewer.traceFlow',
            args: { start: candidates[0].nodeId, targetOrIntent: query },
            reason: 'Trace the flow from the top entrypoint candidate',
          },
          {
            op: 'viewer.estimateBlastRadius',
            args: { changeScope: [candidates[0].nodeId] },
            reason: 'Estimate the blast radius of the top candidate',
          },
        ]
      : [
          {
            op: 'viewer.getRepositoryOverview',
            args: {},
            reason: 'Get an overview to find relevant starting points',
          },
        ],
  });

  assertStructured<EntrypointResult>(envelope);
  return envelope;
}
