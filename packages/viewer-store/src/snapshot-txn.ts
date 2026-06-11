import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type {
  NodeRow,
  EdgeRow,
  EvidenceRow,
  ClaimRow,
  RuleRow,
  VerificationHistoryRow,
  EmbeddingRow,
  PartialityWriteRow,
  FileHashRow,
} from './types.js';

export interface RevisionRow {
  id: string;
  repositoryId: string;
  kind: 'commit' | 'working_tree';
  parentId: string | null;
  committedAt: string | null;
  indexedAt: string;
  historyBounded: number;
}

export interface FtsTextRow {
  objectId: string;
  objectType: string;
  text: string;
  path: string | null;
}

export interface SnapshotTxn {
  insertRevision(row: RevisionRow): void;
  insertFtsText(row: FtsTextRow): void;
  upsertNode(row: NodeRow): void;
  upsertEdge(row: EdgeRow): void;
  appendEvidence(row: EvidenceRow): void;
  versionClaim(row: ClaimRow): void;
  appendVerificationHistory(row: VerificationHistoryRow): void;
  promoteRule(row: RuleRow): void;
  upsertEmbedding(row: EmbeddingRow): void;
  upsertPartiality(row: PartialityWriteRow): void;
  upsertFileHash(row: FileHashRow): void;
  closeInterval(id: string, revision: string): void;
  closeStaleIntervals(revision: string, repositoryId: string, batchTimestamp?: string): void;
  clearFtsForRepository(repositoryId: string): void;
  deleteFtsForFile(filePath: string): void;
  commit(): void;
  abort(): void;
}

/**
 * Cached prepared statements for batch insert performance.
 * Avoids re-parsing SQL on every insert within the same transaction.
 */
interface PreparedStatements {
  insertRevision: Statement;
  insertFtsText: Statement;
  insertNodeIgnore: Statement;
  getNodeForCompare: Statement;
  insertNodeHistory: Statement;
  updateNodeFull: Statement;
  touchNodeUpdatedAt: Statement;
  insertEdgeIgnore: Statement;
  getEdgeForCompare: Statement;
  insertEdgeHistory: Statement;
  updateEdgeFull: Statement;
  touchEdgeUpdatedAt: Statement;
  appendEvidence: Statement;
  versionClaim: Statement;
  appendVerificationHistory: Statement;
  promoteRule: Statement;
  upsertEmbedding: Statement;
  upsertPartiality: Statement;
  upsertFileHash: Statement;
  closeNodes: Statement;
  closeEdges: Statement;
  closeClaims: Statement;
  closeRules: Statement;
  closeStaleNodes: Statement;
  closeStaleEdges: Statement;
  closeStaleClaims: Statement;
  closeStaleNodesByTimestamp: Statement;
  closeStaleEdgesByTimestamp: Statement;
  closeStaleClaimsByTimestamp: Statement;
  deleteStaleFts: Statement;
  clearFtsForRepo: Statement;
  deleteFtsForFile: Statement;
}

function prepareStatements(db: Database.Database): PreparedStatements {
  return {
    insertRevision: db.prepare(`
      INSERT OR IGNORE INTO revisions
        (id, repository_id, kind, parent_id, committed_at, indexed_at, history_bounded)
      VALUES
        (@id, @repositoryId, @kind, @parentId, @committedAt, @indexedAt, @historyBounded)
    `),
    insertFtsText: db.prepare(`
      INSERT INTO fts_text (object_id, object_type, text, path)
      VALUES (@objectId, @objectType, @text, @path)
    `),
    insertNodeIgnore: db.prepare(`
      INSERT OR IGNORE INTO nodes
        (id, kind, stable_key, display_name, repository_id, path, language,
         file_class, provenance_method, extractor, metadata_json,
         valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @kind, @stableKey, @displayName, @repositoryId, @path, @language,
         @fileClass, @provenanceMethod, @extractor, @metadataJson,
         @validFromRevision, @validToRevision, @createdAt, @updatedAt)
    `),
    getNodeForCompare: db.prepare(`
      SELECT display_name, path, language, file_class, metadata_json,
             valid_from_revision, kind, stable_key, repository_id,
             provenance_method, extractor, created_at
      FROM nodes WHERE id = @id
    `),
    insertNodeHistory: db.prepare(`
      INSERT OR IGNORE INTO nodes
        (id, kind, stable_key, display_name, repository_id, path, language,
         file_class, provenance_method, extractor, metadata_json,
         valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @kind, @stableKey, @displayName, @repositoryId, @path, @language,
         @fileClass, @provenanceMethod, @extractor, @metadataJson,
         @validFromRevision, @validToRevision, @createdAt, @updatedAt)
    `),
    updateNodeFull: db.prepare(`
      UPDATE nodes SET
        display_name = @displayName,
        path = @path,
        language = @language,
        file_class = @fileClass,
        metadata_json = @metadataJson,
        valid_from_revision = @validFromRevision,
        updated_at = @updatedAt
      WHERE id = @id
    `),
    touchNodeUpdatedAt: db.prepare(`
      UPDATE nodes SET updated_at = @updatedAt WHERE id = @id
    `),
    insertEdgeIgnore: db.prepare(`
      INSERT OR IGNORE INTO edges
        (id, kind, epistemic, from_node_id, to_node_id, repository_id,
         confidence_band, provenance_method, extractor, evidence_ids_json,
         metadata_json, valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @kind, @epistemic, @fromNodeId, @toNodeId, @repositoryId,
         @confidenceBand, @provenanceMethod, @extractor, @evidenceIdsJson,
         @metadataJson, @validFromRevision, @validToRevision, @createdAt, @updatedAt)
    `),
    getEdgeForCompare: db.prepare(`
      SELECT from_node_id, to_node_id, confidence_band, evidence_ids_json,
             metadata_json, valid_from_revision, kind, epistemic, repository_id,
             provenance_method, extractor, created_at
      FROM edges WHERE id = @id
    `),
    insertEdgeHistory: db.prepare(`
      INSERT OR IGNORE INTO edges
        (id, kind, epistemic, from_node_id, to_node_id, repository_id,
         confidence_band, provenance_method, extractor, evidence_ids_json,
         metadata_json, valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @kind, @epistemic, @fromNodeId, @toNodeId, @repositoryId,
         @confidenceBand, @provenanceMethod, @extractor, @evidenceIdsJson,
         @metadataJson, @validFromRevision, @validToRevision, @createdAt, @updatedAt)
    `),
    updateEdgeFull: db.prepare(`
      UPDATE edges SET
        from_node_id = @fromNodeId,
        to_node_id = @toNodeId,
        confidence_band = @confidenceBand,
        evidence_ids_json = @evidenceIdsJson,
        metadata_json = @metadataJson,
        valid_from_revision = @validFromRevision,
        updated_at = @updatedAt
      WHERE id = @id
    `),
    touchEdgeUpdatedAt: db.prepare(`
      UPDATE edges SET updated_at = @updatedAt WHERE id = @id
    `),
    appendEvidence: db.prepare(`
      INSERT OR IGNORE INTO evidence
        (id, kind, epistemic, repository_id, revision, path, start_line,
         end_line, content_hash, extractor, derivation_locality, actor,
         metadata_json, created_at)
      VALUES
        (@id, @kind, @epistemic, @repositoryId, @revision, @path, @startLine,
         @endLine, @contentHash, @extractor, @derivationLocality, @actor,
         @metadataJson, @createdAt)
    `),
    versionClaim: db.prepare(`
      INSERT INTO claims
        (id, claim_type, statement, status, repository_id, scope_json,
         confidence_band, freshness_band, supporting_evidence_ids_json,
         contradicting_evidence_ids_json, verification_recipes_json,
         derivation_method, generation_id, surfaced,
         valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @claimType, @statement, @status, @repositoryId, @scopeJson,
         @confidenceBand, @freshnessBand, @supportingEvidenceIdsJson,
         @contradictingEvidenceIdsJson, @verificationRecipesJson,
         @derivationMethod, @generationId, @surfaced,
         @validFromRevision, @validToRevision, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        claim_type = excluded.claim_type,
        statement = excluded.statement,
        status = excluded.status,
        repository_id = excluded.repository_id,
        scope_json = excluded.scope_json,
        confidence_band = excluded.confidence_band,
        freshness_band = excluded.freshness_band,
        supporting_evidence_ids_json = excluded.supporting_evidence_ids_json,
        contradicting_evidence_ids_json = excluded.contradicting_evidence_ids_json,
        verification_recipes_json = excluded.verification_recipes_json,
        derivation_method = excluded.derivation_method,
        generation_id = excluded.generation_id,
        surfaced = excluded.surfaced,
        valid_to_revision = excluded.valid_to_revision,
        updated_at = excluded.updated_at
    `),
    appendVerificationHistory: db.prepare(`
      INSERT OR IGNORE INTO verification_history
        (id, claim_id, recipes_json, prior_confidence, new_confidence,
         prior_freshness, new_freshness, prior_status, new_status,
         unresolved_reason, ran_at)
      VALUES
        (@id, @claimId, @recipesJson, @priorConfidence, @newConfidence,
         @priorFreshness, @newFreshness, @priorStatus, @newStatus,
         @unresolvedReason, @ranAt)
    `),
    promoteRule: db.prepare(`
      INSERT OR IGNORE INTO rules
        (id, name, rule_type, status, source, repository_id, definition_json,
         valid_from_revision, valid_to_revision, created_at, updated_at)
      VALUES
        (@id, @name, @ruleType, @status, @source, @repositoryId, @definitionJson,
         @validFromRevision, @validToRevision, @createdAt, @updatedAt)
    `),
    upsertEmbedding: db.prepare(`
      INSERT OR REPLACE INTO embeddings
        (node_id, model_name, dimension, vector, created_at)
      VALUES
        (@nodeId, @modelName, @dimension, @vector, @createdAt)
    `),
    upsertPartiality: db.prepare(`
      INSERT OR REPLACE INTO partiality
        (id, revision, scope, extracted_json, failed_json, skipped_json, created_at)
      VALUES
        (@id, @revision, @scope, @extractedJson, @failedJson, @skippedJson, @createdAt)
    `),
    upsertFileHash: db.prepare(`
      INSERT OR REPLACE INTO file_hashes
        (path, repository_id, hash, revision, updated_at, mtime_ms, size)
      VALUES
        (@path, @repositoryId, @hash, @revision, @updatedAt, @mtimeMs, @size)
    `),
    closeNodes: db.prepare(
      'UPDATE nodes SET valid_to_revision = @revision, updated_at = @updatedAt WHERE id = @id AND valid_to_revision IS NULL',
    ),
    closeEdges: db.prepare(
      'UPDATE edges SET valid_to_revision = @revision, updated_at = @updatedAt WHERE id = @id AND valid_to_revision IS NULL',
    ),
    closeClaims: db.prepare(
      'UPDATE claims SET valid_to_revision = @revision, updated_at = @updatedAt WHERE id = @id AND valid_to_revision IS NULL',
    ),
    closeRules: db.prepare(
      'UPDATE rules SET valid_to_revision = @revision, updated_at = @updatedAt WHERE id = @id AND valid_to_revision IS NULL',
    ),
    closeStaleNodes: db.prepare(`
      UPDATE nodes SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND valid_from_revision != @revision
        AND repository_id = @repositoryId
    `),
    closeStaleEdges: db.prepare(`
      UPDATE edges SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND valid_from_revision != @revision
        AND repository_id = @repositoryId
    `),
    closeStaleClaims: db.prepare(`
      UPDATE claims SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND valid_from_revision != @revision
        AND repository_id = @repositoryId
    `),
    closeStaleNodesByTimestamp: db.prepare(`
      UPDATE nodes SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND updated_at != @batchTimestamp
        AND repository_id = @repositoryId
    `),
    closeStaleEdgesByTimestamp: db.prepare(`
      UPDATE edges SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND updated_at != @batchTimestamp
        AND repository_id = @repositoryId
    `),
    closeStaleClaimsByTimestamp: db.prepare(`
      UPDATE claims SET valid_to_revision = @revision, updated_at = @updatedAt
      WHERE valid_to_revision IS NULL
        AND updated_at != @batchTimestamp
        AND repository_id = @repositoryId
    `),
    deleteStaleFts: db.prepare(`
      DELETE FROM fts_text WHERE object_id IN (
        SELECT id FROM nodes
        WHERE valid_to_revision IS NOT NULL
          AND repository_id = @repositoryId
      )
    `),
    clearFtsForRepo: db.prepare(`
      DELETE FROM fts_text WHERE object_id IN (
        SELECT id FROM nodes
        WHERE repository_id = @repositoryId
      )
    `),
    deleteFtsForFile: db.prepare(`
      DELETE FROM fts_text WHERE path = @filePath
    `),
  };
}

export class SnapshotTxnImpl implements SnapshotTxn {
  private readonly db: Database.Database;
  private readonly releaseLease: () => void;
  private readonly stmts: PreparedStatements;
  private finished = false;

  constructor(db: Database.Database, releaseLease: () => void) {
    this.db = db;
    this.releaseLease = releaseLease;
    this.db.exec('BEGIN DEFERRED');
    this.stmts = prepareStatements(db);
  }

  insertRevision(row: RevisionRow): void {
    this.assertOpen();
    this.stmts.insertRevision.run({
      id: row.id,
      repositoryId: row.repositoryId,
      kind: row.kind,
      parentId: row.parentId,
      committedAt: row.committedAt,
      indexedAt: row.indexedAt,
      historyBounded: row.historyBounded,
    });
  }

  insertFtsText(row: FtsTextRow): void {
    this.assertOpen();
    this.stmts.insertFtsText.run({
      objectId: row.objectId,
      objectType: row.objectType,
      text: row.text,
      path: row.path,
    });
  }

  upsertNode(row: NodeRow): void {
    this.assertOpen();
    const params = {
      id: row.id,
      kind: row.kind,
      stableKey: row.stableKey,
      displayName: row.displayName,
      repositoryId: row.repositoryId,
      path: row.path,
      language: row.language,
      fileClass: row.fileClass,
      provenanceMethod: row.provenanceMethod,
      extractor: row.extractor,
      metadataJson: row.metadataJson,
      validFromRevision: row.validFromRevision,
      validToRevision: row.validToRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Try insert first (succeeds for new rows)
    const result = this.stmts.insertNodeIgnore.run(params);
    if (result.changes > 0) return;

    // Row already exists - check if mutable content changed
    const existing = this.stmts.getNodeForCompare.get({ id: row.id }) as {
      display_name: string | null;
      path: string | null;
      language: string | null;
      file_class: string | null;
      metadata_json: string | null;
      valid_from_revision: string;
      kind: string;
      stable_key: string;
      repository_id: string;
      provenance_method: string;
      extractor: string;
      created_at: string;
    } | undefined;

    if (!existing) return; // Should not happen after INSERT OR IGNORE with 0 changes

    const contentChanged =
      existing.display_name !== row.displayName ||
      existing.path !== row.path ||
      existing.language !== row.language ||
      existing.file_class !== row.fileClass ||
      existing.metadata_json !== row.metadataJson;

    if (!contentChanged) {
      // No content change - just bump updated_at for stale detection
      this.stmts.touchNodeUpdatedAt.run({ id: row.id, updatedAt: row.updatedAt });
      return;
    }

    // Content changed: create history row with old content, then update original
    const historyId = `${row.id}::v${existing.valid_from_revision}`;
    this.stmts.insertNodeHistory.run({
      id: historyId,
      kind: existing.kind,
      stableKey: existing.stable_key,
      displayName: existing.display_name,
      repositoryId: existing.repository_id,
      path: existing.path,
      language: existing.language,
      fileClass: existing.file_class,
      provenanceMethod: existing.provenance_method,
      extractor: existing.extractor,
      metadataJson: existing.metadata_json,
      validFromRevision: existing.valid_from_revision,
      validToRevision: row.validFromRevision,
      createdAt: existing.created_at,
      updatedAt: row.updatedAt,
    });

    // Update the original row with new content and new valid_from
    this.stmts.updateNodeFull.run({
      id: row.id,
      displayName: row.displayName,
      path: row.path,
      language: row.language,
      fileClass: row.fileClass,
      metadataJson: row.metadataJson,
      validFromRevision: row.validFromRevision,
      updatedAt: row.updatedAt,
    });
  }

  upsertEdge(row: EdgeRow): void {
    this.assertOpen();
    const params = {
      id: row.id,
      kind: row.kind,
      epistemic: row.epistemic,
      fromNodeId: row.fromNodeId,
      toNodeId: row.toNodeId,
      repositoryId: row.repositoryId,
      confidenceBand: row.confidenceBand,
      provenanceMethod: row.provenanceMethod,
      extractor: row.extractor,
      evidenceIdsJson: row.evidenceIdsJson,
      metadataJson: row.metadataJson,
      validFromRevision: row.validFromRevision,
      validToRevision: row.validToRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Try insert first (succeeds for new rows)
    const result = this.stmts.insertEdgeIgnore.run(params);
    if (result.changes > 0) return;

    // Row already exists - check if mutable content changed
    const existing = this.stmts.getEdgeForCompare.get({ id: row.id }) as {
      from_node_id: string;
      to_node_id: string;
      confidence_band: string;
      evidence_ids_json: string | null;
      metadata_json: string | null;
      valid_from_revision: string;
      kind: string;
      epistemic: string;
      repository_id: string;
      provenance_method: string;
      extractor: string;
      created_at: string;
    } | undefined;

    if (!existing) return;

    const contentChanged =
      existing.from_node_id !== row.fromNodeId ||
      existing.to_node_id !== row.toNodeId ||
      existing.confidence_band !== row.confidenceBand ||
      existing.evidence_ids_json !== row.evidenceIdsJson ||
      existing.metadata_json !== row.metadataJson;

    if (!contentChanged) {
      // No content change - just bump updated_at for stale detection
      this.stmts.touchEdgeUpdatedAt.run({ id: row.id, updatedAt: row.updatedAt });
      return;
    }

    // Content changed: create history row with old content, then update original
    const historyId = `${row.id}::v${existing.valid_from_revision}`;
    this.stmts.insertEdgeHistory.run({
      id: historyId,
      kind: existing.kind,
      epistemic: existing.epistemic,
      fromNodeId: existing.from_node_id,
      toNodeId: existing.to_node_id,
      repositoryId: existing.repository_id,
      confidenceBand: existing.confidence_band,
      provenanceMethod: existing.provenance_method,
      extractor: existing.extractor,
      evidenceIdsJson: existing.evidence_ids_json,
      metadataJson: existing.metadata_json,
      validFromRevision: existing.valid_from_revision,
      validToRevision: row.validFromRevision,
      createdAt: existing.created_at,
      updatedAt: row.updatedAt,
    });

    // Update the original row with new content and new valid_from
    this.stmts.updateEdgeFull.run({
      id: row.id,
      fromNodeId: row.fromNodeId,
      toNodeId: row.toNodeId,
      confidenceBand: row.confidenceBand,
      evidenceIdsJson: row.evidenceIdsJson,
      metadataJson: row.metadataJson,
      validFromRevision: row.validFromRevision,
      updatedAt: row.updatedAt,
    });
  }

  appendEvidence(row: EvidenceRow): void {
    this.assertOpen();
    this.stmts.appendEvidence.run({
      id: row.id,
      kind: row.kind,
      epistemic: row.epistemic,
      repositoryId: row.repositoryId,
      revision: row.revision,
      path: row.path,
      startLine: row.startLine,
      endLine: row.endLine,
      contentHash: row.contentHash,
      extractor: row.extractor,
      derivationLocality: row.derivationLocality,
      actor: row.actor,
      metadataJson: row.metadataJson,
      createdAt: row.createdAt,
    });
  }

  versionClaim(row: ClaimRow): void {
    this.assertOpen();
    this.stmts.versionClaim.run({
      id: row.id,
      claimType: row.claimType,
      statement: row.statement,
      status: row.status,
      repositoryId: row.repositoryId,
      scopeJson: row.scopeJson,
      confidenceBand: row.confidenceBand,
      freshnessBand: row.freshnessBand,
      supportingEvidenceIdsJson: row.supportingEvidenceIdsJson,
      contradictingEvidenceIdsJson: row.contradictingEvidenceIdsJson,
      verificationRecipesJson: row.verificationRecipesJson,
      derivationMethod: row.derivationMethod,
      generationId: row.generationId,
      surfaced: row.surfaced,
      validFromRevision: row.validFromRevision,
      validToRevision: row.validToRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  appendVerificationHistory(row: VerificationHistoryRow): void {
    this.assertOpen();
    this.stmts.appendVerificationHistory.run({
      id: row.id,
      claimId: row.claimId,
      recipesJson: row.recipesJson,
      priorConfidence: row.priorConfidence,
      newConfidence: row.newConfidence,
      priorFreshness: row.priorFreshness,
      newFreshness: row.newFreshness,
      priorStatus: row.priorStatus,
      newStatus: row.newStatus,
      unresolvedReason: row.unresolvedReason,
      ranAt: row.ranAt,
    });
  }

  promoteRule(row: RuleRow): void {
    this.assertOpen();
    this.stmts.promoteRule.run({
      id: row.id,
      name: row.name,
      ruleType: row.ruleType,
      status: row.status,
      source: row.source,
      repositoryId: row.repositoryId,
      definitionJson: row.definitionJson,
      validFromRevision: row.validFromRevision,
      validToRevision: row.validToRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  upsertEmbedding(row: EmbeddingRow): void {
    this.assertOpen();
    this.stmts.upsertEmbedding.run({
      nodeId: row.nodeId,
      modelName: row.modelName,
      dimension: row.dimension,
      vector: row.vector,
      createdAt: row.createdAt,
    });
  }

  upsertPartiality(row: PartialityWriteRow): void {
    this.assertOpen();
    this.stmts.upsertPartiality.run({
      id: row.id,
      revision: row.revision,
      scope: row.scope,
      extractedJson: row.extractedJson,
      failedJson: row.failedJson,
      skippedJson: row.skippedJson,
      createdAt: row.createdAt,
    });
  }

  upsertFileHash(row: FileHashRow): void {
    this.assertOpen();
    this.stmts.upsertFileHash.run({
      path: row.path,
      repositoryId: row.repositoryId,
      hash: row.hash,
      revision: row.revision,
      updatedAt: row.updatedAt,
      mtimeMs: row.mtimeMs ?? null,
      size: row.size ?? null,
    });
  }

  closeInterval(id: string, revision: string): void {
    this.assertOpen();
    const updatedAt = new Date().toISOString();
    const params = { id, revision, updatedAt };

    const nodesResult = this.stmts.closeNodes.run(params);
    if (nodesResult.changes > 0) return;

    const edgesResult = this.stmts.closeEdges.run(params);
    if (edgesResult.changes > 0) return;

    const claimsResult = this.stmts.closeClaims.run(params);
    if (claimsResult.changes > 0) return;

    this.stmts.closeRules.run(params);
  }

  closeStaleIntervals(revision: string, repositoryId: string, batchTimestamp?: string): void {
    this.assertOpen();
    const updatedAt = new Date().toISOString();

    if (batchTimestamp) {
      const tsParams = { revision, repositoryId, updatedAt, batchTimestamp };
      this.stmts.closeStaleNodesByTimestamp.run(tsParams);
      this.stmts.closeStaleEdgesByTimestamp.run(tsParams);
      this.stmts.closeStaleClaimsByTimestamp.run(tsParams);
    } else {
      const params = { revision, repositoryId, updatedAt };
      this.stmts.closeStaleNodes.run(params);
      this.stmts.closeStaleEdges.run(params);
      this.stmts.closeStaleClaims.run(params);
    }
    this.stmts.deleteStaleFts.run({ repositoryId });
  }

  clearFtsForRepository(repositoryId: string): void {
    this.assertOpen();
    this.stmts.clearFtsForRepo.run({ repositoryId });
  }

  deleteFtsForFile(filePath: string): void {
    this.assertOpen();
    this.stmts.deleteFtsForFile.run({ filePath });
  }

  commit(): void {
    if (this.finished) return;
    this.finished = true;
    this.db.exec('COMMIT');
    this.releaseLease();
  }

  abort(): void {
    if (this.finished) return;
    this.finished = true;
    this.db.exec('ROLLBACK');
    this.releaseLease();
  }

  private assertOpen(): void {
    if (this.finished) {
      throw new Error('SnapshotTxn is already finished');
    }
  }
}
