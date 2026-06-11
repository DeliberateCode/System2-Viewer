/**
 * Claim history: returns human annotations, verification history,
 * and the non-destructive successor chain for a claim.
 */

/** Structural read handle for claim history queries (SELECT only). */
export interface ClaimHistoryReadHandle {
  prepare(sql: string): {
    all(params?: Record<string, unknown>): unknown[];
    get(params?: Record<string, unknown>): unknown | undefined;
  };
}

/** A single entry in the claim's successor chain. */
export interface ClaimSuccessorEntry {
  id: string;
  status: string;
  confidenceBand: string;
  freshnessBand: string;
  validFromRevision: string;
  validToRevision: string | null;
  derivationMethod: string;
}

/** A single verification history row. */
export interface VerificationHistoryEntry {
  id: string;
  claimId: string;
  recipesJson: string;
  priorConfidence: string | null;
  newConfidence: string | null;
  priorFreshness: string | null;
  newFreshness: string | null;
  priorStatus: string | null;
  newStatus: string | null;
  unresolvedReason: string | null;
  ranAt: string;
}

/** A human annotation evidence record for the claim. */
export interface HumanAnnotationEntry {
  id: string;
  actor: string | null;
  metadataJson: string | null;
  createdAt: string;
}

/** Full claim history result. */
export interface ClaimHistoryResult {
  claimId: string;
  annotations: HumanAnnotationEntry[];
  verificationHistory: VerificationHistoryEntry[];
  successorChain: ClaimSuccessorEntry[];
}

/**
 * Returns the full history for a claim:
 *   - Human annotations (evidence records of kind 'human_annotation' referencing this claim)
 *   - Verification history rows
 *   - Non-destructive successor chain (all versions of this claim by generation_id)
 *
 * @param input - claimId to look up
 * @param db - Readonly database handle for SELECT queries
 */
export function getClaimHistory(
  input: { claimId: string },
  db: ClaimHistoryReadHandle,
): ClaimHistoryResult {
  const { claimId } = input;

  // Find the claim's generation_id for the successor chain
  const claimRow = db.prepare(`
    SELECT generation_id FROM claims WHERE id = @claimId
  `).get({ claimId }) as { generation_id: string } | undefined;

  const generationId = claimRow?.generation_id ?? claimId;

  // Successor chain: all claims with the same generation_id, ordered by creation
  const successorRows = db.prepare(`
    SELECT id, status, confidence_band, freshness_band,
           valid_from_revision, valid_to_revision, derivation_method
    FROM claims
    WHERE generation_id = @generationId
    ORDER BY rowid
  `).all({ generationId }) as Array<{
    id: string;
    status: string;
    confidence_band: string;
    freshness_band: string;
    valid_from_revision: string;
    valid_to_revision: string | null;
    derivation_method: string;
  }>;

  const successorChain: ClaimSuccessorEntry[] = successorRows.map(r => ({
    id: r.id,
    status: r.status,
    confidenceBand: r.confidence_band,
    freshnessBand: r.freshness_band,
    validFromRevision: r.valid_from_revision,
    validToRevision: r.valid_to_revision,
    derivationMethod: r.derivation_method,
  }));

  // Verification history
  const vhRows = db.prepare(`
    SELECT id, claim_id, recipes_json, prior_confidence, new_confidence,
           prior_freshness, new_freshness, prior_status, new_status,
           unresolved_reason, ran_at
    FROM verification_history
    WHERE claim_id = @claimId
    ORDER BY ran_at, id
  `).all({ claimId }) as Array<{
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

  const verificationHistory: VerificationHistoryEntry[] = vhRows.map(r => ({
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

  // Human annotations: evidence records of kind 'human_annotation'
  // whose metadata_json references this claim
  const annotationRows = db.prepare(`
    SELECT id, actor, metadata_json, created_at
    FROM evidence
    WHERE kind = 'human_annotation'
    AND metadata_json LIKE @pattern
    ORDER BY created_at, id
  `).all({ pattern: `%${claimId}%` }) as Array<{
    id: string;
    actor: string | null;
    metadata_json: string | null;
    created_at: string;
  }>;

  const annotations: HumanAnnotationEntry[] = annotationRows.map(r => ({
    id: r.id,
    actor: r.actor,
    metadataJson: r.metadata_json,
    createdAt: r.created_at,
  }));

  return {
    claimId,
    annotations,
    verificationHistory,
    successorChain,
  };
}
