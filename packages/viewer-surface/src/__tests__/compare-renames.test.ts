/**
 * Tests for rename_candidate edges in compareRevisions.
 *
 * Verifies that rename_candidate edges are included in the
 * comparison result's renames field.
 */
import { describe, it, expect } from 'vitest';
import { compareRevisions } from '../compare.js';
import type { CompareReadHandle } from '../compare.js';

function mkDb(
  renameEdges: Array<{ metadata_json: string | null }> = [],
): CompareReadHandle {
  return {
    prepare(sql: string) {
      return {
        all(_params?: Record<string, unknown>) {
          // Detect which query is being run by checking for rename_candidate
          if (sql.includes('rename_candidate')) {
            return renameEdges;
          }
          // Return empty arrays for all other queries (nodes, edges, claims)
          return [];
        },
      };
    },
  };
}

describe('compareRevisions: renames field', () => {
  it('includes rename candidates in the result', () => {
    const db = mkDb([
      {
        metadata_json: JSON.stringify({
          oldPath: 'src/old.ts',
          newPath: 'src/new.ts',
          confidence: 0.95,
        }),
      },
    ]);

    const result = compareRevisions({ revA: 'rev-1', revB: 'rev-2' }, db);

    expect(result.renames).toHaveLength(1);
    expect(result.renames[0]).toEqual({
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      confidence: 0.95,
    });
  });

  it('returns empty renames when no rename_candidate edges exist', () => {
    const db = mkDb([]);

    const result = compareRevisions({ revA: 'rev-1', revB: 'rev-2' }, db);

    expect(result.renames).toEqual([]);
  });

  it('skips entries with null metadata_json', () => {
    const db = mkDb([{ metadata_json: null }]);

    const result = compareRevisions({ revA: 'rev-1', revB: 'rev-2' }, db);

    expect(result.renames).toEqual([]);
  });

  it('skips entries with malformed metadata_json', () => {
    const db = mkDb([{ metadata_json: '{ bad json' }]);

    const result = compareRevisions({ revA: 'rev-1', revB: 'rev-2' }, db);

    expect(result.renames).toEqual([]);
  });

  it('defaults confidence to 0 when missing from metadata', () => {
    const db = mkDb([
      {
        metadata_json: JSON.stringify({
          oldPath: 'a.ts',
          newPath: 'b.ts',
        }),
      },
    ]);

    const result = compareRevisions({ revA: 'rev-1', revB: 'rev-2' }, db);

    expect(result.renames).toHaveLength(1);
    expect(result.renames[0]!.confidence).toBe(0);
  });
});
