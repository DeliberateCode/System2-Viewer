/**
 * findEntrypoints operation.
 *
 * Free-text intent via pipeline with FTS5-safe search.
 * Returns ranked candidates with evidence refs.
 */

import picomatch from 'picomatch';
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

interface FrameworkHintInput {
  pattern: string;
  framework: string;
  entrypointKind: string;
  excludePaths?: string[];
}

// Intentional duplication of viewer-config's extractDecoratorNames —
// viewer-retrieval does not depend on viewer-config.
function extractDecoratorNames(metadataJson: string | null): string[] {
  if (!metadataJson) return [];
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    const names: string[] = [];
    if (Array.isArray(meta.decorators)) {
      for (const d of meta.decorators) if (typeof d === 'string') names.push(d);
    }
    if (Array.isArray(meta.attributes)) {
      for (const a of meta.attributes) if (typeof a === 'string') names.push(a);
    }
    if (Array.isArray(meta.annotations)) {
      for (const a of meta.annotations) if (typeof a === 'string') names.push(a);
    }
    return names;
  } catch {
    return [];
  }
}

function matchesHintPattern(pattern: string, decoratorName: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return decoratorName.startsWith(prefix);
  }
  return decoratorName === pattern;
}

export function findEntrypoints(
  handle: EntrypointReadHandle,
  query: string,
  opts?: { revision?: string; limit?: number; frameworkHints?: FrameworkHintInput[] },
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

  // Framework-hint matching stage: scan decorated symbol nodes for pattern matches.
  if (opts?.frameworkHints && opts.frameworkHints.length > 0) {
    const excludeMatcherCache = new Map<FrameworkHintInput, ReturnType<typeof picomatch>>();
    for (const hint of opts.frameworkHints) {
      if (hint.excludePaths) {
        excludeMatcherCache.set(hint, picomatch(hint.excludePaths, { dot: true }));
      }
    }

    // Use decoratedSymbols() when available for efficient scanning.
    // Falls back to FTS-based discovery.
    const symbolEntries: Array<{ id: string; metadataJson: string; path: string | null }> = [];
    if (handle.decoratedSymbols) {
      symbolEntries.push(...handle.decoratedSymbols());
    } else {
      const ftsHits = handle.ftsSearch(query);
      for (const hit of ftsHits) {
        const node = handle.getNode(hit.objectId);
        if (!node || node['kind'] !== 'symbol') continue;
        const mj = (node['metadata_json'] as string) ?? null;
        if (mj) symbolEntries.push({ id: hit.objectId, metadataJson: mj, path: (node['path'] as string) ?? null });
      }
    }

    for (const entry of symbolEntries) {
      if (candidates.length >= limit) break;
      if (seen.has(entry.id)) continue;

      const decorators = extractDecoratorNames(entry.metadataJson);
      if (decorators.length === 0) continue;

      const filePath = entry.path ?? '';

      for (const hint of opts.frameworkHints) {
        const excludeMatcher = excludeMatcherCache.get(hint);
        if (excludeMatcher && excludeMatcher(filePath)) continue;

        const matched = decorators.some((d) => matchesHintPattern(hint.pattern, d));
        if (matched) {
          const node = handle.getNode(entry.id);
          const hintEvidence: EvidenceRef[] = [{
            evidenceId: `fwk-hint:${entry.id}:${hint.pattern}`,
            kind: 'symbol_index_hit',
            path: filePath,
            revision,
            extractor: `framework-hint:${hint.framework}`,
          }];

          candidates.push({
            nodeId: entry.id,
            displayName: node ? ((node['display_name'] as string) ?? filePath) : filePath,
            score: 70,
            evidence: hintEvidence,
            source: 'framework-hint',
            entrypointKind: hint.entrypointKind,
          });
          evidence.push(...hintEvidence);
          seen.add(entry.id);
          break;
        }
      }
    }
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
