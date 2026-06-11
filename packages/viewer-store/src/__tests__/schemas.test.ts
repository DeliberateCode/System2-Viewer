/**
 * Tests for Zod runtime validation schemas on ClaimReadRow and NodeRow.
 *
 * Verifies that safeParse catches malformed data at the store->retrieval boundary.
 */
import { describe, it, expect } from 'vitest';
import { ClaimReadRowSchema, NodeRowRawSchema } from '../schemas.js';

describe('ClaimReadRowSchema', () => {
  const validClaim = {
    id: 'claim-001',
    claimType: 'exported-symbol',
    statement: 'Module X exports function Y',
    status: 'hypothesis',
    confidenceBand: 'medium',
    freshnessBand: 'fresh',
    validFromRevision: 'rev-abc',
    validToRevision: null,
    scopeJson: '{"path":"src/x.ts"}',
    supportingEvidenceIds: ['ev-1', 'ev-2'],
    repositoryId: 'repo1',
    verificationRecipesJson: '[]',
    surfaced: 1,
  };

  it('accepts a valid ClaimReadRow', () => {
    const result = ClaimReadRowSchema.safeParse(validClaim);
    expect(result.success).toBe(true);
  });

  it('accepts ClaimReadRow without optional fields', () => {
    const { repositoryId, verificationRecipesJson, surfaced, ...minimal } = validClaim;
    const result = ClaimReadRowSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const { id, ...missing } = validClaim;
    const result = ClaimReadRowSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('rejects when supportingEvidenceIds is not an array', () => {
    const bad = { ...validClaim, supportingEvidenceIds: 'not-an-array' };
    const result = ClaimReadRowSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects when status is not a string', () => {
    const bad = { ...validClaim, status: 42 };
    const result = ClaimReadRowSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects when validToRevision is not string or null', () => {
    const bad = { ...validClaim, validToRevision: 123 };
    const result = ClaimReadRowSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('NodeRowRawSchema', () => {
  const validNode = {
    id: 'node-001',
    kind: 'file',
    stable_key: 'repo1:file:src/x.ts',
    display_name: 'x.ts',
    repository_id: 'repo1',
    path: 'src/x.ts',
    language: 'typescript',
    file_class: 'source',
    provenance_method: 'indexer',
    extractor: 'tree-sitter',
    metadata_json: null,
    valid_from_revision: 'rev-abc',
    valid_to_revision: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid raw node row', () => {
    const result = NodeRowRawSchema.safeParse(validNode);
    expect(result.success).toBe(true);
  });

  it('accepts node row with nullable fields set to null', () => {
    const withNulls = {
      ...validNode,
      display_name: null,
      path: null,
      language: null,
      file_class: null,
      metadata_json: null,
      valid_to_revision: null,
    };
    const result = NodeRowRawSchema.safeParse(withNulls);
    expect(result.success).toBe(true);
  });

  it('passes through extra columns from SELECT *', () => {
    const withExtra = { ...validNode, some_extra_column: 'value' };
    const result = NodeRowRawSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const { id, ...missing } = validNode;
    const result = NodeRowRawSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('rejects when kind is not a string', () => {
    const bad = { ...validNode, kind: 42 };
    const result = NodeRowRawSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects when required field is null', () => {
    const bad = { ...validNode, id: null };
    const result = NodeRowRawSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects when created_at is missing', () => {
    const { created_at, ...missing } = validNode;
    const result = NodeRowRawSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });
});
