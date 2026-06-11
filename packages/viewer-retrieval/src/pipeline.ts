/**
 * 5-stage retrieval pipeline.
 *
 * Stages execute in fixed order:
 *   1. symbolic  -- resolve node ids / stable keys
 *   2. lexical   -- FTS5 full-text search
 *   3. semantic  -- embedding-based similarity search
 *   4. graph     -- transitive neighbor traversal (bounded depth)
 *   5. claim     -- relevant claims for anchored nodes
 *
 * Each stage produces RetrievalAnchor objects with rank tiers.
 * The pipeline merges anchors by id, keeping the highest-rank source.
 */

import type { PipelineReadHandle } from './handles.js';
import type { RetrievalAnchor, RetrievalQuery, RetrievalResult } from './types.js';

/** Fixed-order pipeline stage names. */
export const PIPELINE_STAGES = [
  'symbolic',
  'lexical',
  'semantic',
  'graph',
  'claim',
] as const;

const DEFAULT_MAX_DEPTH = 3;

/**
 * Stage 1: Symbolic resolution.
 * Resolves explicit node ids and stable keys to anchors.
 */
function runSymbolicStage(
  handle: PipelineReadHandle,
  query: RetrievalQuery,
): RetrievalAnchor[] {
  const anchors: RetrievalAnchor[] = [];
  if (!query.nodeIds || query.nodeIds.length === 0) return anchors;

  for (const nodeId of query.nodeIds) {
    const node = handle.getNode(nodeId);
    if (node) {
      anchors.push({
        id: nodeId,
        kind: (node['kind'] as string) ?? 'unknown',
        source: 'symbolic',
        rank: 100,
        data: node,
      });
    }
  }
  return anchors;
}

/**
 * Stage 2: Lexical search via FTS5.
 * Quotes the query as a phrase literal for FTS5 safety.
 */
function runLexicalStage(
  handle: PipelineReadHandle,
  query: RetrievalQuery,
): RetrievalAnchor[] {
  const anchors: RetrievalAnchor[] = [];
  if (!query.text) return anchors;

  const hits = handle.ftsSearch(query.text);

  for (const hit of hits) {
    anchors.push({
      id: hit.objectId,
      kind: hit.objectType,
      source: 'lexical',
      rank: 80 + Math.min(Math.abs(hit.rank), 20),
      data: {
        text: hit.text,
        path: hit.path,
        ftsRank: hit.rank,
      },
    });
  }
  return anchors;
}

const DEFAULT_SEMANTIC_LIMIT = 10;

/**
 * Stage 3: Semantic search via embeddings.
 * Delegates to handle.semanticSearch when both the method and a query
 * embedding are available; degrades gracefully to [] otherwise.
 */
function runSemanticStage(
  handle: PipelineReadHandle,
  query: RetrievalQuery,
): RetrievalAnchor[] {
  if (!handle.semanticSearch) return [];
  if (!query.queryEmbedding) return [];

  const hits = handle.semanticSearch(query.queryEmbedding, DEFAULT_SEMANTIC_LIMIT);
  const anchors: RetrievalAnchor[] = [];

  for (const hit of hits) {
    anchors.push({
      id: hit.nodeId,
      kind: 'node',
      source: 'semantic',
      rank: 60 + Math.round(hit.score * 20),
      data: { score: hit.score },
    });
  }
  return anchors;
}

/**
 * Stage 4: Graph expansion.
 * Transitive neighbor traversal bounded by maxDepth.
 */
function runGraphStage(
  handle: PipelineReadHandle,
  query: RetrievalQuery,
  existingAnchorIds: Set<string>,
): RetrievalAnchor[] {
  const anchors: RetrievalAnchor[] = [];
  const maxDepth = query.maxDepth ?? DEFAULT_MAX_DEPTH;

  for (const anchorId of existingAnchorIds) {
    const neighbors = handle.neighbors(anchorId, undefined, maxDepth);
    for (const edge of neighbors) {
      const targetId =
        edge.toNodeId === anchorId ? edge.fromNodeId : edge.toNodeId;
      anchors.push({
        id: targetId,
        kind: edge.kind,
        source: 'graph',
        rank: Math.max(60 - edge.depth * 10, 10),
        data: {
          edgeId: edge.id,
          edgeKind: edge.kind,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          depth: edge.depth,
        },
      });
    }
  }
  return anchors;
}

/**
 * Stage 5: Claim resolution.
 * Finds relevant claims for anchored nodes.
 */
function runClaimStage(
  handle: PipelineReadHandle,
  _query: RetrievalQuery,
  existingAnchorIds: Set<string>,
): RetrievalAnchor[] {
  const anchors: RetrievalAnchor[] = [];

  for (const anchorId of existingAnchorIds) {
    const claim = handle.getClaim(anchorId);
    if (claim) {
      anchors.push({
        id: claim.id,
        kind: 'claim',
        source: 'claim',
        rank: 50,
        data: {
          claimType: claim.claimType,
          statement: claim.statement,
          status: claim.status,
          confidenceBand: claim.confidenceBand,
        },
      });
    }
  }
  return anchors;
}

/**
 * Merges anchors by id, keeping the highest-rank source for each id.
 */
function mergeAnchors(anchors: RetrievalAnchor[]): RetrievalAnchor[] {
  const byId = new Map<string, RetrievalAnchor>();

  for (const anchor of anchors) {
    const existing = byId.get(anchor.id);
    if (!existing || anchor.rank > existing.rank) {
      byId.set(anchor.id, anchor);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.rank - a.rank);
}

/**
 * Runs the 5-stage retrieval pipeline.
 *
 * @param handle - A structural read handle (satisfied by viewer-store ReadHandle)
 * @param query  - The retrieval query specifying text, node ids, revision, and depth
 * @returns Merged and ranked retrieval anchors
 */
export function runRetrievalPipeline(
  handle: PipelineReadHandle,
  query: RetrievalQuery,
): RetrievalResult {
  // Stage 1: Symbolic
  const symbolicAnchors = runSymbolicStage(handle, query);

  // Stage 2: Lexical
  const lexicalAnchors = runLexicalStage(handle, query);

  // Stage 3: Semantic
  const semanticAnchors = runSemanticStage(handle, query);

  // Collect anchor ids from stages 1-3 for graph expansion
  const preGraphAnchors = [
    ...symbolicAnchors,
    ...lexicalAnchors,
    ...semanticAnchors,
  ];
  const anchorIds = new Set(preGraphAnchors.map((a) => a.id));

  // Stage 4: Graph expansion
  const graphAnchors = runGraphStage(handle, query, anchorIds);

  // Expand anchor set for claim stage
  const allPreClaimAnchors = [...preGraphAnchors, ...graphAnchors];
  const allAnchorIds = new Set(allPreClaimAnchors.map((a) => a.id));

  // Stage 5: Claim
  const claimAnchors = runClaimStage(handle, query, allAnchorIds);

  // Merge all anchors by id, keeping highest rank
  const allAnchors = [...allPreClaimAnchors, ...claimAnchors];
  const merged = mergeAnchors(allAnchors);

  return {
    anchors: merged,
    revision: query.revision,
  };
}
