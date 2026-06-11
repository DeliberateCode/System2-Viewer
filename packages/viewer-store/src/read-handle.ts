import type Database from 'better-sqlite3';
import type {
  RevisionId,
  NeighborEdge,
  ClaimReadRow,
  EvidenceReadRow,
  PartialityRow,
  VerificationHistoryRow,
  FtsHit,
  SimilarityHit,
  FileHashRow,
} from './types.js';
import { ClaimReadRowSchema, NodeRowRawSchema } from './schemas.js';

export interface ReadHandle {
  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[];
  ftsSearch(q: string): FtsHit[];
  getNode(id: string): Record<string, unknown> | null;
  getClaim(id: string): ClaimReadRow | null;
  claimsByPrefix(prefix: string, limit?: number): ClaimReadRow[];
  listOpenClaims(generationId?: string): ClaimReadRow[];
  getEvidence(id: string): EvidenceReadRow | null;
  partiality(rev: RevisionId): PartialityRow[];
  verificationHistory(claimId: string): VerificationHistoryRow[];
  semanticSearch(queryVector: Float32Array, limit?: number): SimilarityHit[];
  embeddingCoverage(): { totalNodes: number; embeddedNodes: number };
  getFileHash(path: string, repositoryId: string): FileHashRow | null;
  close(): void;
}

export class ReadHandleImpl implements ReadHandle {
  private readonly db: Database.Database;
  private readonly rev: RevisionId | undefined;
  private closed = false;

  constructor(db: Database.Database, rev?: RevisionId) {
    this.db = db;
    this.rev = rev;
    this.db.exec('BEGIN DEFERRED');
  }

  /**
   * Returns the SQL fragment for interval filtering and associated bind parameters.
   * If a specific revision was requested, filters entities valid at that revision.
   * Otherwise, returns only current (non-closed) entities.
   */
  private intervalFilter(alias?: string): { sql: string; params: Record<string, string> } {
    const col = alias ? `${alias}.` : '';
    if (this.rev) {
      return {
        sql: `${col}valid_from_revision <= @_rev AND (${col}valid_to_revision IS NULL OR ${col}valid_to_revision > @_rev)`,
        params: { _rev: this.rev },
      };
    }
    return {
      sql: `${col}valid_to_revision IS NULL`,
      params: {},
    };
  }

  neighbors(id: string, kind?: string, maxDepth?: number): NeighborEdge[] {
    this.assertOpen();
    const depth = maxDepth ?? 3;
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();
    const { sql: eIntervalSql } = this.intervalFilter('e');

    if (kind != null) {
      const sql = `
        WITH RECURSIVE neighbor_cte(id, kind, from_node_id, to_node_id, depth) AS (
          SELECT id, kind, from_node_id, to_node_id, 1
          FROM edges
          WHERE (from_node_id = @id OR to_node_id = @id)
            AND kind = @kind
            AND ${intervalSql}
          UNION
          SELECT e.id, e.kind, e.from_node_id, e.to_node_id, nc.depth + 1
          FROM edges e
          JOIN neighbor_cte nc ON (e.from_node_id = nc.to_node_id OR e.to_node_id = nc.from_node_id)
          WHERE ${eIntervalSql}
            AND e.kind = @kind
            AND nc.depth < @maxDepth
            AND e.id != nc.id
        )
        SELECT DISTINCT nc.id, nc.kind, nc.from_node_id, nc.to_node_id, nc.depth,
               e2.confidence_band, e2.epistemic, e2.evidence_ids_json
        FROM neighbor_cte nc
        JOIN edges e2 ON e2.id = nc.id
        ORDER BY nc.depth, nc.from_node_id, nc.kind, nc.to_node_id, nc.id
      `;
      const stmt = this.db.prepare(sql);
      const rows = stmt.all({ id, kind, maxDepth: depth, ...intervalParams }) as Array<{
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
    }

    const sql = `
      WITH RECURSIVE neighbor_cte(id, kind, from_node_id, to_node_id, depth) AS (
        SELECT id, kind, from_node_id, to_node_id, 1
        FROM edges
        WHERE (from_node_id = @id OR to_node_id = @id)
          AND ${intervalSql}
        UNION
        SELECT e.id, e.kind, e.from_node_id, e.to_node_id, nc.depth + 1
        FROM edges e
        JOIN neighbor_cte nc ON (e.from_node_id = nc.to_node_id OR e.to_node_id = nc.from_node_id)
        WHERE ${eIntervalSql}
          AND nc.depth < @maxDepth
          AND e.id != nc.id
      )
      SELECT DISTINCT nc.id, nc.kind, nc.from_node_id, nc.to_node_id, nc.depth,
             e2.confidence_band, e2.epistemic, e2.evidence_ids_json
      FROM neighbor_cte nc
      JOIN edges e2 ON e2.id = nc.id
      ORDER BY nc.depth, nc.from_node_id, nc.kind, nc.to_node_id, nc.id
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ id, maxDepth: depth, ...intervalParams }) as Array<{
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
  }

  ftsSearch(q: string): FtsHit[] {
    this.assertOpen();
    const quoted = `"${q.replace(/"/g, '""')}"`;
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter('n');
    const sql = `
      SELECT f.object_id, f.object_type, f.text, f.path, f.rank
      FROM fts_text f
      INNER JOIN nodes n ON f.object_id = n.id AND ${intervalSql}
      WHERE fts_text MATCH @query
      ORDER BY f.rank
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ query: quoted, ...intervalParams }) as Array<{
      object_id: string;
      object_type: string;
      text: string;
      path: string | null;
      rank: number;
    }>;
    return rows.map(r => ({
      objectId: r.object_id,
      objectType: r.object_type,
      text: r.text,
      path: r.path,
      rank: r.rank,
    }));
  }

  getNode(id: string): Record<string, unknown> | null {
    this.assertOpen();
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();
    const sql = `
      SELECT * FROM nodes
      WHERE id = @id AND ${intervalSql}
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ id, ...intervalParams }) as Record<string, unknown> | undefined;
    if (row) return this.validateNodeRow(row);

    // Fallback: when reading at a specific revision, the original row may have
    // been updated (valid_from advanced). Search by stable_key to find the
    // historical version row that covers the requested revision.
    if (this.rev) {
      const stableKeySql = `
        SELECT * FROM nodes
        WHERE stable_key = (SELECT stable_key FROM nodes WHERE id = @id LIMIT 1)
          AND ${intervalSql}
        LIMIT 1
      `;
      const stableKeyStmt = this.db.prepare(stableKeySql);
      const stableRow = stableKeyStmt.get({ id, ...intervalParams }) as Record<string, unknown> | undefined;
      if (!stableRow) return null;
      return this.validateNodeRow(stableRow);
    }

    return null;
  }

  private validateNodeRow(row: Record<string, unknown>): Record<string, unknown> {
    const result = NodeRowRawSchema.safeParse(row);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`NodeRow validation failed: ${issues}`);
    }
    return row;
  }

  getClaim(id: string): ClaimReadRow | null {
    this.assertOpen();
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();
    const sql = `
      SELECT id, claim_type, statement, status, confidence_band,
             freshness_band, valid_from_revision, valid_to_revision,
             scope_json, supporting_evidence_ids_json,
             repository_id, verification_recipes_json, surfaced
      FROM claims
      WHERE id = @id AND ${intervalSql}
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ id, ...intervalParams }) as {
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
    const mapped: ClaimReadRow = {
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
    const validation = ClaimReadRowSchema.safeParse(mapped);
    if (!validation.success) {
      const issues = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`ClaimReadRow validation failed for claim ${row.id}: ${issues}`);
    }
    return mapped;
  }

  claimsByPrefix(prefix: string, limit?: number): ClaimReadRow[] {
    this.assertOpen();
    const n = limit ?? 10;
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();
    const sql = `
      SELECT id, claim_type, statement, status, confidence_band,
             freshness_band, valid_from_revision, valid_to_revision,
             scope_json, supporting_evidence_ids_json,
             repository_id, verification_recipes_json, surfaced
      FROM claims
      WHERE id LIKE @prefix || '%' AND ${intervalSql}
      ORDER BY id
      LIMIT @limit
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ prefix, limit: n, ...intervalParams }) as Array<{
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
    }>;
    return rows.map(r => ({
      id: r.id,
      claimType: r.claim_type,
      statement: r.statement,
      status: r.status,
      confidenceBand: r.confidence_band,
      freshnessBand: r.freshness_band,
      validFromRevision: r.valid_from_revision,
      validToRevision: r.valid_to_revision,
      scopeJson: r.scope_json,
      supportingEvidenceIds: JSON.parse(r.supporting_evidence_ids_json) as string[],
      repositoryId: r.repository_id,
      verificationRecipesJson: r.verification_recipes_json,
      surfaced: r.surfaced,
    }));
  }

  listOpenClaims(generationId?: string): ClaimReadRow[] {
    this.assertOpen();
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();

    if (generationId != null) {
      const sql = `
        SELECT id, claim_type, statement, status, confidence_band,
               freshness_band, valid_from_revision, valid_to_revision,
               scope_json, supporting_evidence_ids_json,
               repository_id, verification_recipes_json, surfaced
        FROM claims
        WHERE ${intervalSql} AND generation_id = @generationId
        ORDER BY id
      `;
      const stmt = this.db.prepare(sql);
      const rows = stmt.all({ generationId, ...intervalParams }) as Array<{
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
      }>;
      return rows.map(r => ({
        id: r.id,
        claimType: r.claim_type,
        statement: r.statement,
        status: r.status,
        confidenceBand: r.confidence_band,
        freshnessBand: r.freshness_band,
        validFromRevision: r.valid_from_revision,
        validToRevision: r.valid_to_revision,
        scopeJson: r.scope_json,
        supportingEvidenceIds: JSON.parse(r.supporting_evidence_ids_json) as string[],
        repositoryId: r.repository_id,
        verificationRecipesJson: r.verification_recipes_json,
        surfaced: r.surfaced,
      }));
    }

    const sql = `
      SELECT id, claim_type, statement, status, confidence_band,
             freshness_band, valid_from_revision, valid_to_revision,
             scope_json, supporting_evidence_ids_json,
             repository_id, verification_recipes_json, surfaced
      FROM claims
      WHERE ${intervalSql}
      ORDER BY id
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ ...intervalParams }) as Array<{
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
    }>;
    return rows.map(r => ({
      id: r.id,
      claimType: r.claim_type,
      statement: r.statement,
      status: r.status,
      confidenceBand: r.confidence_band,
      freshnessBand: r.freshness_band,
      validFromRevision: r.valid_from_revision,
      validToRevision: r.valid_to_revision,
      scopeJson: r.scope_json,
      supportingEvidenceIds: JSON.parse(r.supporting_evidence_ids_json) as string[],
      repositoryId: r.repository_id,
      verificationRecipesJson: r.verification_recipes_json,
      surfaced: r.surfaced,
    }));
  }

  getEvidence(id: string): EvidenceReadRow | null {
    this.assertOpen();
    const sql = `
      SELECT id, kind, content_hash, revision, path
      FROM evidence
      WHERE id = @id
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ id }) as {
      id: string;
      kind: string;
      content_hash: string | null;
      revision: string;
      path: string | null;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      contentHash: row.content_hash,
      revision: row.revision,
      path: row.path,
    };
  }

  partiality(rev: RevisionId): PartialityRow[] {
    this.assertOpen();
    const sql = `
      SELECT id, revision, scope, extracted_json, failed_json, skipped_json
      FROM partiality
      WHERE revision = @rev
      ORDER BY id
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ rev }) as Array<{
      id: string;
      revision: string;
      scope: string;
      extracted_json: string | null;
      failed_json: string | null;
      skipped_json: string | null;
    }>;
    return rows.map(r => ({
      id: r.id,
      revision: r.revision,
      scope: r.scope,
      extractedJson: r.extracted_json,
      failedJson: r.failed_json,
      skippedJson: r.skipped_json,
    }));
  }

  verificationHistory(claimId: string): VerificationHistoryRow[] {
    this.assertOpen();
    const sql = `
      SELECT id, claim_id, recipes_json, prior_confidence, new_confidence,
             prior_freshness, new_freshness, prior_status, new_status,
             unresolved_reason, ran_at
      FROM verification_history
      WHERE claim_id = @claimId
      ORDER BY ran_at, id
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ claimId }) as Array<{
      id: string;
      claim_id: string;
      recipes_json: string;
      prior_confidence: string | null;
      new_confidence: string | null;
      prior_freshness: string | null;
      new_freshness: string | null;
      prior_status: string | null;
      new_status: string | null;
      unresolved_reason: string | null;
      ran_at: string;
    }>;
    return rows.map(r => ({
      id: r.id,
      claimId: r.claim_id,
      recipesJson: r.recipes_json,
      priorConfidence: r.prior_confidence,
      newConfidence: r.new_confidence,
      priorFreshness: r.prior_freshness,
      newFreshness: r.new_freshness,
      priorStatus: r.prior_status,
      newStatus: r.new_status,
      unresolvedReason: r.unresolved_reason,
      ranAt: r.ran_at,
    }));
  }

  semanticSearch(queryVector: Float32Array, limit?: number): SimilarityHit[] {
    this.assertOpen();
    const n = limit ?? 10;
    if (n <= 0) return [];

    const { sql: intervalSql, params: intervalParams } = this.intervalFilter('n');
    const sql = `
      SELECT e.node_id, e.dimension, e.vector FROM embeddings e
      INNER JOIN nodes n ON e.node_id = n.id
      WHERE ${intervalSql}
    `;
    const rows = this.db.prepare(sql).all({ ...intervalParams }) as Array<{
      node_id: string;
      dimension: number;
      vector: Buffer;
    }>;

    if (rows.length === 0) return [];

    const hits: SimilarityHit[] = [];
    for (const row of rows) {
      const stored = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.dimension,
      );
      const score = cosineSimilarity(queryVector, stored);
      hits.push({ nodeId: row.node_id, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, n);
  }

  embeddingCoverage(): { totalNodes: number; embeddedNodes: number } {
    this.assertOpen();
    const { sql: intervalSql, params: intervalParams } = this.intervalFilter();
    const { sql: nIntervalSql, params: nIntervalParams } = this.intervalFilter('n');
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM nodes WHERE kind IN ('file','symbol') AND ${intervalSql}`,
      )
      .get({ ...intervalParams }) as { cnt: number };
    const embeddedRow = this.db
      .prepare(
        `SELECT COUNT(DISTINCT e.node_id) AS cnt FROM embeddings e INNER JOIN nodes n ON e.node_id = n.id WHERE ${nIntervalSql}`,
      )
      .get({ ...nIntervalParams }) as { cnt: number };
    return {
      totalNodes: totalRow.cnt,
      embeddedNodes: embeddedRow.cnt,
    };
  }

  getFileHash(path: string, repositoryId: string): FileHashRow | null {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT path, repository_id, hash, revision, updated_at, mtime_ms, size FROM file_hashes WHERE path = @path AND repository_id = @repositoryId')
      .get({ path, repositoryId }) as {
        path: string;
        repository_id: string;
        hash: string;
        revision: string;
        updated_at: string;
        mtime_ms: number | null;
        size: number | null;
      } | undefined;
    if (!row) return null;
    return {
      path: row.path,
      repositoryId: row.repository_id,
      hash: row.hash,
      revision: row.revision,
      updatedAt: row.updated_at,
      mtimeMs: row.mtime_ms,
      size: row.size,
    };
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.exec('COMMIT');
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('ReadHandle is closed');
    }
  }
}

/**
 * A ReadHandle that returns empty results for all operations.
 * Used when the database does not yet exist (deferred creation).
 */
export class EmptyReadHandle implements ReadHandle {
  neighbors(): NeighborEdge[] { return []; }
  ftsSearch(): FtsHit[] { return []; }
  getNode(): Record<string, unknown> | null { return null; }
  getClaim(): ClaimReadRow | null { return null; }
  claimsByPrefix(): ClaimReadRow[] { return []; }
  listOpenClaims(): ClaimReadRow[] { return []; }
  getEvidence(): EvidenceReadRow | null { return null; }
  partiality(): PartialityRow[] { return []; }
  verificationHistory(): VerificationHistoryRow[] { return []; }
  semanticSearch(): SimilarityHit[] { return []; }
  embeddingCoverage(): { totalNodes: number; embeddedNodes: number } { return { totalNodes: 0, embeddedNodes: 0 }; }
  getFileHash(): FileHashRow | null { return null; }
  close(): void { /* no-op */ }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const dim = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < dim; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
