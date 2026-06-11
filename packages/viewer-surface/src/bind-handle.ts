/**
 * UnionHandle binding for the composition root.
 *
 * Constructs a UnionHandle by delegating base accessors to the real
 * ReadHandle and adding optional widenings as SELECT-only queries on
 * the readonly db connection.
 *
 * The UnionHandle type is the intersection of ALL retrieval operation
 * handle types. TypeScript compilation proves that the constructed
 * object satisfies every operation's structural handle.
 */

import type Database from 'better-sqlite3';
import type { ReadHandle, ClaimReadRow, SimilarityHit } from '@system2-viewer/viewer-store';
import type {
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
} from '@system2-viewer/viewer-retrieval';

/**
 * UnionHandle is the intersection of all retrieval operation handle types,
 * plus optional semantic search and embedding coverage closures.
 */
export type UnionHandle = ReadView &
  EntrypointReadHandle &
  FlowReadHandle &
  SubsystemReadHandle &
  BlastReadHandle &
  ListClaimsReadHandle &
  ListUncertaintiesReadHandle &
  ClaimPayloadReadHandle &
  EvidenceAgreementReadHandle & {
    semanticSearch?: (queryVector: Float32Array, limit?: number) => SimilarityHit[];
    embeddingCoverage?: () => { totalNodes: number; embeddedNodes: number };
  };

/**
 * Constructs a UnionHandle from a real ReadHandle and a readonly db.
 *
 * Base accessors delegate to the ReadHandle. Optional widenings are
 * implemented as SELECT-only queries on the readonly db connection,
 * providing richer data access without mutating state.
 */
/**
 * Returns the SQL interval filter fragment and bind params for the given revision.
 * Mirrors the pattern in ReadHandleImpl.intervalFilter().
 */
function intervalFilter(revision: string, alias?: string): { sql: string; params: Record<string, string> } {
  const col = alias ? `${alias}.` : '';
  return {
    sql: `${col}valid_from_revision <= @_rev AND (${col}valid_to_revision IS NULL OR ${col}valid_to_revision > @_rev)`,
    params: { _rev: revision },
  };
}

export function bindHandle(
  readHandle: ReadHandle,
  db: Database.Database,
  revision: string,
): UnionHandle {
  const handle: UnionHandle = {
    // Base PipelineReadHandle accessors -- delegate to real ReadHandle
    neighbors: (id: string, kind?: string, maxDepth?: number) =>
      readHandle.neighbors(id, kind, maxDepth),

    ftsSearch: (q: string) => readHandle.ftsSearch(q),

    getNode: (id: string) => readHandle.getNode(id),

    getClaim: (id: string) => readHandle.getClaim(id),

    claimsByPrefix: (prefix: string, limit?: number) =>
      readHandle.claimsByPrefix(prefix, limit),

    partiality: (rev: string) => readHandle.partiality(rev),

    // ReadView widenings
    enumerateContainedNodes: (rootId: string): Array<Record<string, unknown>> => {
      const { sql: edgeFilter, params: edgeParams } = intervalFilter(revision);
      const { sql: eFilter } = intervalFilter(revision, 'e');
      const { sql: nFilter } = intervalFilter(revision, 'n');
      const sql = `
        WITH RECURSIVE contained(id) AS (
          SELECT to_node_id FROM edges
          WHERE from_node_id = @rootId AND (kind = 'contains' OR kind = 'owns') AND ${edgeFilter}
          UNION
          SELECT e.to_node_id FROM edges e
          JOIN contained c ON e.from_node_id = c.id
          WHERE (e.kind = 'contains' OR e.kind = 'owns') AND ${eFilter}
        )
        SELECT n.* FROM nodes n
        JOIN contained c ON n.id = c.id
        WHERE ${nFilter}
        ORDER BY n.id
      `;
      return db.prepare(sql).all({ rootId, ...edgeParams }) as Array<Record<string, unknown>>;
    },

    allEdges: (kind?: string): Array<{ fromNodeId: string; toNodeId: string; kind: string }> => {
      const { sql: filter, params: filterParams } = intervalFilter(revision);
      if (kind != null) {
        const sql = `
          SELECT from_node_id, to_node_id, kind
          FROM edges
          WHERE kind = @kind AND ${filter}
          ORDER BY from_node_id, to_node_id
        `;
        const rows = db.prepare(sql).all({ kind, ...filterParams }) as Array<{
          from_node_id: string;
          to_node_id: string;
          kind: string;
        }>;
        return rows.map(r => ({
          fromNodeId: r.from_node_id,
          toNodeId: r.to_node_id,
          kind: r.kind,
        }));
      }
      const sql = `
        SELECT from_node_id, to_node_id, kind
        FROM edges
        WHERE ${filter}
        ORDER BY from_node_id, to_node_id
      `;
      const rows = db.prepare(sql).all({ ...filterParams }) as Array<{
        from_node_id: string;
        to_node_id: string;
        kind: string;
      }>;
      return rows.map(r => ({
        fromNodeId: r.from_node_id,
        toNodeId: r.to_node_id,
        kind: r.kind,
      }));
    },

    // FlowReadHandle widening
    inboundEdges: (nodeId: string, kind?: string): NeighborEdge[] => {
      const { sql: filter, params: filterParams } = intervalFilter(revision);
      const sql = kind != null
        ? `
          SELECT id, kind, from_node_id, to_node_id, 1 as depth,
                 confidence_band, epistemic, evidence_ids_json
          FROM edges
          WHERE to_node_id = @nodeId AND kind = @kind AND ${filter}
          ORDER BY from_node_id, kind, id
        `
        : `
          SELECT id, kind, from_node_id, to_node_id, 1 as depth,
                 confidence_band, epistemic, evidence_ids_json
          FROM edges
          WHERE to_node_id = @nodeId AND ${filter}
          ORDER BY from_node_id, kind, id
        `;
      const params: Record<string, string> = { nodeId, ...filterParams };
      if (kind != null) params['kind'] = kind;
      const rows = db.prepare(sql).all(params) as Array<{
        id: string;
        kind: string;
        from_node_id: string;
        to_node_id: string;
        depth: number;
        confidence_band: string | null;
        epistemic: string | null;
        evidence_ids_json: string | null;
      }>;
      return rows.map(r => ({
        id: r.id,
        kind: r.kind,
        fromNodeId: r.from_node_id,
        toNodeId: r.to_node_id,
        depth: r.depth,
        confidenceBand: r.confidence_band,
        epistemic: r.epistemic,
        evidenceIdsJson: r.evidence_ids_json,
      }));
    },

    // ListClaimsReadHandle / ListUncertaintiesReadHandle / EvidenceAgreementReadHandle widenings
    allClaimIds: (): string[] => {
      const { sql: filter, params: filterParams } = intervalFilter(revision);
      const sql = `
        SELECT id FROM claims
        WHERE ${filter}
        ORDER BY id
      `;
      const rows = db.prepare(sql).all({ ...filterParams }) as Array<{ id: string }>;
      return rows.map(r => r.id);
    },

    getClaimRecord: (id: string): ClaimReadRow | null => {
      const { sql: filter, params: filterParams } = intervalFilter(revision);
      const sql = `
        SELECT id, claim_type, statement, status, confidence_band,
               freshness_band, valid_from_revision, valid_to_revision,
               scope_json, supporting_evidence_ids_json,
               repository_id, verification_recipes_json, surfaced
        FROM claims
        WHERE id = @id AND ${filter}
      `;
      const row = db.prepare(sql).get({ id, ...filterParams }) as {
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

    // Semantic search widening (delegates to ReadHandle)
    semanticSearch: (queryVector: Float32Array, limit?: number): SimilarityHit[] => {
      return readHandle.semanticSearch(queryVector, limit);
    },

    // Embedding coverage widening (delegates to ReadHandle)
    embeddingCoverage: (): { totalNodes: number; embeddedNodes: number } => {
      return readHandle.embeddingCoverage();
    },
  };

  return handle;
}
