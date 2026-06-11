/**
 * Zod schemas for runtime validation of critical stored data.
 *
 * Used at the store->retrieval boundary (getClaim, getNode) to catch
 * data corruption or schema drift before it propagates upstream.
 */

import { z } from 'zod';

/**
 * Schema for ClaimReadRow -- the shape returned by getClaim() after
 * mapping from snake_case SQLite columns to camelCase TypeScript fields.
 */
export const ClaimReadRowSchema = z.object({
  id: z.string(),
  claimType: z.string(),
  statement: z.string(),
  status: z.string(),
  confidenceBand: z.string(),
  freshnessBand: z.string(),
  validFromRevision: z.string(),
  validToRevision: z.string().nullable(),
  scopeJson: z.string(),
  supportingEvidenceIds: z.array(z.string()),
  repositoryId: z.string().optional(),
  verificationRecipesJson: z.string().optional(),
  surfaced: z.number().optional(),
});

/**
 * Schema for the raw node row returned by getNode().
 *
 * getNode() returns Record<string, unknown> from `SELECT * FROM nodes`.
 * This schema validates the raw snake_case columns to ensure the row
 * has the minimum expected structure.
 */
export const NodeRowRawSchema = z.object({
  id: z.string(),
  kind: z.string(),
  stable_key: z.string(),
  display_name: z.string().nullable(),
  repository_id: z.string(),
  path: z.string().nullable(),
  language: z.string().nullable(),
  file_class: z.string().nullable(),
  provenance_method: z.string(),
  extractor: z.string(),
  metadata_json: z.string().nullable(),
  valid_from_revision: z.string(),
  valid_to_revision: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();
