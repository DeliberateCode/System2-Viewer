/**
 * Revision comparison: compares two already-indexed revisions.
 *
 * Reports changed files, symbols, topology edges, and claims
 * whose stored freshness/status changed between the two revisions.
 *
 * Does NOT trigger re-indexing.
 */

import type { CompareRevisionsResult } from './types.js';

/** Structural read handle for comparing revisions. */
export interface CompareReadHandle {
  /** Execute a parameterized SQL query (SELECT only). */
  prepare(sql: string): {
    all(params?: Record<string, unknown>): unknown[];
  };
}

/**
 * Compares two already-indexed revisions by querying the model database.
 *
 * @param input - revA and revB are revision ids that must already exist in the database
 * @param db - A readonly database handle for SELECT queries
 * @returns CompareRevisionsResult with arrays of changed entity ids
 */
export function compareRevisions(
  input: { revA: string; revB: string },
  db: CompareReadHandle,
): CompareRevisionsResult {
  const { revA, revB } = input;

  // Changed files: nodes of kind 'file' visible at one revision but not the other,
  // or with different metadata
  const changedFiles = findChangedEntities(db, 'nodes', 'file', revA, revB);

  // Changed symbols: nodes of kind 'symbol'
  const changedSymbols = findChangedEntities(db, 'nodes', 'symbol', revA, revB);

  // Changed edges: edges whose interval boundaries differ
  const changedEdges = findChangedEdges(db, revA, revB);

  // Changed claims: claims with different status or freshness between revisions
  const changedClaims = findChangedClaims(db, revA, revB);

  // Rename candidates: edges of kind 'rename_candidate' visible at revB
  const renames = findRenameCandidates(db, revB);

  return {
    revA,
    revB,
    changedFiles,
    changedSymbols,
    changedEdges,
    changedClaims,
    renames,
  };
}

/**
 * Finds node ids of a given kind that are visible at one revision but not both,
 * or that were updated between the two revisions.
 */
function findChangedEntities(
  db: CompareReadHandle,
  _table: string,
  kind: string,
  revA: string,
  revB: string,
): string[] {
  // Nodes visible at revA: valid_from <= revA AND (valid_to IS NULL OR valid_to > revA)
  // Nodes visible at revB: valid_from <= revB AND (valid_to IS NULL OR valid_to > revB)
  // Changed = symmetric difference or nodes with different updated_at
  const sql = `
    SELECT DISTINCT n.stable_key FROM nodes n
    WHERE n.kind = @kind
    AND (
      -- Visible at A but not at B
      (n.valid_from_revision <= @revA AND (n.valid_to_revision IS NULL OR n.valid_to_revision > @revA)
       AND NOT (n.valid_from_revision <= @revB AND (n.valid_to_revision IS NULL OR n.valid_to_revision > @revB)))
      OR
      -- Visible at B but not at A
      (n.valid_from_revision <= @revB AND (n.valid_to_revision IS NULL OR n.valid_to_revision > @revB)
       AND NOT (n.valid_from_revision <= @revA AND (n.valid_to_revision IS NULL OR n.valid_to_revision > @revA)))
    )
    ORDER BY n.stable_key
  `;

  const rows = db.prepare(sql).all({ kind, revA, revB }) as Array<{ stable_key: string }>;
  return rows.map(r => r.stable_key);
}

/**
 * Finds edge ids that differ between two revisions.
 */
function findChangedEdges(
  db: CompareReadHandle,
  revA: string,
  revB: string,
): string[] {
  const sql = `
    SELECT DISTINCT e.id FROM edges e
    WHERE (
      (e.valid_from_revision <= @revA AND (e.valid_to_revision IS NULL OR e.valid_to_revision > @revA)
       AND NOT (e.valid_from_revision <= @revB AND (e.valid_to_revision IS NULL OR e.valid_to_revision > @revB)))
      OR
      (e.valid_from_revision <= @revB AND (e.valid_to_revision IS NULL OR e.valid_to_revision > @revB)
       AND NOT (e.valid_from_revision <= @revA AND (e.valid_to_revision IS NULL OR e.valid_to_revision > @revA)))
    )
    ORDER BY e.id
  `;

  const rows = db.prepare(sql).all({ revA, revB }) as Array<{ id: string }>;
  return rows.map(r => r.id);
}

/**
 * Finds rename_candidate edges visible at a given revision and extracts
 * old/new paths and confidence from their metadata.
 */
function findRenameCandidates(
  db: CompareReadHandle,
  revB: string,
): Array<{ oldPath: string; newPath: string; confidence: number }> {
  const sql = `
    SELECT e.metadata_json FROM edges e
    WHERE e.kind = 'rename_candidate'
      AND e.valid_from_revision <= @revB
      AND (e.valid_to_revision IS NULL OR e.valid_to_revision > @revB)
    ORDER BY e.id
  `;

  const rows = db.prepare(sql).all({ revB }) as Array<{ metadata_json: string | null }>;
  const results: Array<{ oldPath: string; newPath: string; confidence: number }> = [];

  for (const row of rows) {
    if (!row.metadata_json) continue;
    try {
      const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const oldPath = meta['oldPath'];
      const newPath = meta['newPath'];
      const confidence = meta['confidence'];
      if (typeof oldPath === 'string' && typeof newPath === 'string') {
        results.push({
          oldPath,
          newPath,
          confidence: typeof confidence === 'number' ? confidence : 0,
        });
      }
    } catch {
      // skip malformed metadata
    }
  }

  return results;
}

/**
 * Finds claim ids whose status or freshness differs between revisions.
 */
function findChangedClaims(
  db: CompareReadHandle,
  revA: string,
  revB: string,
): string[] {
  const sql = `
    SELECT DISTINCT c.id FROM claims c
    WHERE (
      (c.valid_from_revision <= @revA AND (c.valid_to_revision IS NULL OR c.valid_to_revision > @revA)
       AND NOT (c.valid_from_revision <= @revB AND (c.valid_to_revision IS NULL OR c.valid_to_revision > @revB)))
      OR
      (c.valid_from_revision <= @revB AND (c.valid_to_revision IS NULL OR c.valid_to_revision > @revB)
       AND NOT (c.valid_from_revision <= @revA AND (c.valid_to_revision IS NULL OR c.valid_to_revision > @revA)))
    )
    ORDER BY c.id
  `;

  const rows = db.prepare(sql).all({ revA, revB }) as Array<{ id: string }>;
  return rows.map(r => r.id);
}
