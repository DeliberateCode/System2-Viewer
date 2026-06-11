/**
 * Feedback operations: confirm/reject/annotate for claims and subsystems.
 *
 * Each operation:
 *   1. noProseEditGuard(args) -- rejects if `statement` field present
 *   2. Load claim from readonly db
 *   3. Open SnapshotTxn
 *   4. Re-score via viewer-core
 *   5. Create non-destructive successor (close interval + insert)
 *   6. Append human_annotation evidence
 *   7. Commit (or abort on failure)
 */

// IDs use randomUUID() intentionally rather than content-hashing.
// Content-hashing would create unstable IDs when the same verification
// runs at different times, breaking successor chain references.
import { randomUUID } from 'node:crypto';
import {
  computeConfidence,
  nextClaimStatus,
} from '@system2-viewer/viewer-core';
import type {
  EvidenceRef as CoreEvidenceRef,
  ConfidenceBand,
  FreshnessBand,
  ClaimStatus,
} from '@system2-viewer/viewer-core';
import type { ModelStore } from '@system2-viewer/viewer-store';
import type Database from 'better-sqlite3';
import type {
  FeedbackOperations,
  FeedbackSummary,
  FeedbackClaimRecord,
} from './types.js';

/**
 * Rejects any args object that contains a `statement` field.
 * Prevents prose editing of claim statements via feedback operations.
 */
export function noProseEditGuard(args: Record<string, unknown>): void {
  if ('statement' in args) {
    throw new Error(
      'Feedback operations cannot modify claim statements. The "statement" field is not allowed.',
    );
  }
}

/**
 * Loads a claim record suitable for feedback from the readonly db.
 * Returns null if the claim does not exist or is closed.
 */
function loadClaimForFeedback(
  db: Database.Database,
  claimId: string,
): FeedbackClaimRecord | null {
  const sql = `
    SELECT id, claim_type, statement, status, repository_id, scope_json,
           confidence_band, freshness_band, supporting_evidence_ids_json,
           contradicting_evidence_ids_json, verification_recipes_json,
           derivation_method, generation_id, surfaced, valid_from_revision
    FROM claims
    WHERE id = @claimId AND valid_to_revision IS NULL
  `;
  const row = db.prepare(sql).get({ claimId }) as {
    id: string;
    claim_type: string;
    statement: string;
    status: string;
    repository_id: string;
    scope_json: string;
    confidence_band: string;
    freshness_band: string;
    supporting_evidence_ids_json: string;
    contradicting_evidence_ids_json: string | null;
    verification_recipes_json: string;
    derivation_method: string;
    generation_id: string;
    surfaced: number;
    valid_from_revision: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    claimType: row.claim_type,
    statement: row.statement,
    status: row.status,
    repositoryId: row.repository_id,
    scopeJson: row.scope_json,
    confidenceBand: row.confidence_band,
    freshnessBand: row.freshness_band,
    supportingEvidenceIdsJson: row.supporting_evidence_ids_json,
    contradictingEvidenceIdsJson: row.contradicting_evidence_ids_json,
    verificationRecipesJson: row.verification_recipes_json,
    derivationMethod: row.derivation_method,
    generationId: row.generation_id,
    surfaced: row.surfaced,
    validFromRevision: row.valid_from_revision,
  };
}

/**
 * Performs the common feedback pattern:
 *   - Load claim, create evidence, re-score, derive status, close + successor, commit
 *
 * statusOverride: for reject, force 'rejected'; for confirm/annotate, derive from state machine
 */
function applyFeedback(
  store: ModelStore,
  db: Database.Database,
  claimId: string,
  actor: string,
  note: string | undefined,
  mode: 'confirm' | 'reject' | 'annotate',
): FeedbackSummary {
  const claim = loadClaimForFeedback(db, claimId);
  if (!claim) {
    return {
      claimId,
      priorStatus: 'unknown',
      newStatus: 'unknown',
      evidenceAppended: false,
      successorId: null,
      error: `The specified claim ID does not exist in the current model: ${claimId}. Use \`viewer.listClaims\` to see available claims.`,
    };
  }

  const now = new Date().toISOString();
  const feedbackRevision = `rev::${Date.now()}::fb::${randomUUID()}`;
  const evidenceId = `ev::human::${randomUUID()}`;
  const successorId = `${claimId}-fb-${randomUUID()}`;
  const priorStatus = claim.status;

  // Parse existing evidence IDs
  let supportingIds: string[] = [];
  try {
    supportingIds = JSON.parse(claim.supportingEvidenceIdsJson) as string[];
  } catch {
    // empty
  }

  let contradictingIds: string[] = [];
  try {
    if (claim.contradictingEvidenceIdsJson) {
      contradictingIds = JSON.parse(claim.contradictingEvidenceIdsJson) as string[];
    }
  } catch {
    // empty
  }

  // Build evidence refs for scoring
  const supportingRefs: CoreEvidenceRef[] = supportingIds.map(id => ({
    evidenceId: id,
    kind: 'static_analysis_result' as const,
  }));

  // Add the new human_annotation evidence to supporting
  const newEvidenceRef: CoreEvidenceRef = {
    evidenceId,
    kind: 'human_annotation',
  };

  const contradictingRefs: CoreEvidenceRef[] = contradictingIds.map(id => ({
    evidenceId: id,
    kind: 'static_analysis_result' as const,
  }));

  // For reject: add to contradictions
  if (mode === 'reject') {
    contradictingRefs.push(newEvidenceRef);
  } else {
    supportingRefs.push(newEvidenceRef);
  }

  // Re-score
  const newConfidence = computeConfidence(
    supportingRefs,
    contradictingRefs,
    {
      confidence: claim.confidenceBand as ConfidenceBand,
      freshness: claim.freshnessBand as 'stale' | 'aging' | 'fresh',
    },
  );

  // Derive new status
  let newStatus: ClaimStatus;
  if (mode === 'reject') {
    newStatus = 'rejected';
  } else if (mode === 'annotate') {
    // Annotate does not change status directly, but we still run state machine
    const claimProjection = {
      id: claimId,
      status: priorStatus as ClaimStatus,
      confidence: newConfidence,
      supportingEvidence: supportingRefs,
      contradictingEvidence: contradictingRefs,
      verificationRecipeCount: 0,
    };
    newStatus = nextClaimStatus(claimProjection, supportingRefs, contradictingRefs);
  } else {
    // confirm
    const claimProjection = {
      id: claimId,
      status: priorStatus as ClaimStatus,
      confidence: newConfidence,
      supportingEvidence: supportingRefs,
      contradictingEvidence: contradictingRefs,
      verificationRecipeCount: 0,
    };
    newStatus = nextClaimStatus(claimProjection, supportingRefs, contradictingRefs);
  }

  // Open write transaction
  const txn = store.beginSnapshot(feedbackRevision);
  try {
    // Insert feedback revision into revisions table
    txn.insertRevision({
      id: feedbackRevision,
      repositoryId: claim.repositoryId,
      kind: 'working_tree',
      parentId: claim.validFromRevision,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });

    // Append human_annotation evidence
    txn.appendEvidence({
      id: evidenceId,
      kind: 'human_annotation',
      epistemic: 'inferred',
      repositoryId: claim.repositoryId,
      revision: feedbackRevision,
      path: null,
      startLine: null,
      endLine: null,
      contentHash: null,
      extractor: 'viewer-surface::feedback',
      derivationLocality: 'local' as const,
      actor,
      metadataJson: JSON.stringify({
        mode,
        note: note ?? null,
        claimId,
      }),
      createdAt: now,
    });

    // Close interval on prior claim at the NEW feedback revision
    txn.closeInterval(claimId, feedbackRevision);

    // Create successor claim
    const updatedSupportingIds = mode === 'reject'
      ? supportingIds
      : [...supportingIds, evidenceId];
    const updatedContradictingIds = mode === 'reject'
      ? [...contradictingIds, evidenceId]
      : contradictingIds;

    txn.versionClaim({
      id: successorId,
      claimType: claim.claimType,
      statement: claim.statement,
      status: newStatus,
      repositoryId: claim.repositoryId,
      scopeJson: claim.scopeJson,
      confidenceBand: newConfidence,
      freshnessBand: claim.freshnessBand as FreshnessBand,
      supportingEvidenceIdsJson: JSON.stringify(updatedSupportingIds),
      contradictingEvidenceIdsJson: updatedContradictingIds.length > 0
        ? JSON.stringify(updatedContradictingIds)
        : null,
      verificationRecipesJson: claim.verificationRecipesJson,
      derivationMethod: `feedback::${mode}`,
      generationId: claim.generationId,
      surfaced: claim.surfaced,
      validFromRevision: feedbackRevision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });

    txn.commit();
  } catch (err) {
    txn.abort();
    return {
      claimId,
      priorStatus,
      newStatus: priorStatus,
      evidenceAppended: false,
      successorId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    claimId,
    priorStatus,
    newStatus,
    evidenceAppended: true,
    successorId,
  };
}

/**
 * Returns an error summary indicating no model is indexed.
 */
function noModelError(claimId: string): FeedbackSummary {
  return {
    claimId,
    priorStatus: 'unknown',
    newStatus: 'unknown',
    evidenceAppended: false,
    successorId: null,
    error: 'No model indexed -- cannot perform feedback operation',
  };
}

/**
 * Resolves a subsystem node ID to its associated hypothesis claim ID.
 * Returns null if no matching claim exists.
 */
function resolveSubsystemClaim(
  db: Database.Database,
  subsystemNodeId: string,
): string | null {
  const sql = `
    SELECT id FROM claims
    WHERE claim_type = 'directory-derived-subsystem-hypothesis'
      AND scope_json LIKE @pattern
      AND valid_to_revision IS NULL
    LIMIT 1
  `;
  const pattern = `%"subsystemId":"${subsystemNodeId}"%`;
  const row = db.prepare(sql).get({ pattern }) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Creates the 6 feedback operations bound to a ModelStore and readonly db.
 */
export function createFeedbackOperations(
  store: ModelStore,
  readonlyDb: Database.Database | null,
): FeedbackOperations {
  return {
    confirmClaim(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.claimId);
      return applyFeedback(store, readonlyDb, input.claimId, input.actor, input.note, 'confirm');
    },

    rejectClaim(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.claimId);
      return applyFeedback(store, readonlyDb, input.claimId, input.actor, input.note, 'reject');
    },

    annotateClaim(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.claimId);
      return applyFeedback(store, readonlyDb, input.claimId, input.actor, input.annotation, 'annotate');
    },

    confirmSubsystem(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.targetId);
      const claimId = resolveSubsystemClaim(readonlyDb, input.targetId);
      if (!claimId) {
        return {
          claimId: input.targetId,
          priorStatus: 'unknown',
          newStatus: 'unknown',
          evidenceAppended: false,
          successorId: null,
          error: `No hypothesis claim found for subsystem: ${input.targetId}. Verify the subsystem ID is correct. Use \`viewer.listClaims\` to see available claims.`,
        };
      }
      return applyFeedback(store, readonlyDb, claimId, input.actor, input.note, 'confirm');
    },

    rejectSubsystem(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.targetId);
      const claimId = resolveSubsystemClaim(readonlyDb, input.targetId);
      if (!claimId) {
        return {
          claimId: input.targetId,
          priorStatus: 'unknown',
          newStatus: 'unknown',
          evidenceAppended: false,
          successorId: null,
          error: `No hypothesis claim found for subsystem: ${input.targetId}. Verify the subsystem ID is correct. Use \`viewer.listClaims\` to see available claims.`,
        };
      }
      return applyFeedback(store, readonlyDb, claimId, input.actor, input.note, 'reject');
    },

    annotateSubsystem(input) {
      noProseEditGuard(input as unknown as Record<string, unknown>);
      if (!readonlyDb) return noModelError(input.targetId);
      const claimId = resolveSubsystemClaim(readonlyDb, input.targetId);
      if (!claimId) {
        return {
          claimId: input.targetId,
          priorStatus: 'unknown',
          newStatus: 'unknown',
          evidenceAppended: false,
          successorId: null,
          error: `No hypothesis claim found for subsystem: ${input.targetId}. Verify the subsystem ID is correct. Use \`viewer.listClaims\` to see available claims.`,
        };
      }
      return applyFeedback(store, readonlyDb, claimId, input.actor, input.annotation, 'annotate');
    },
  };
}
