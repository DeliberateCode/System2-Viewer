/**
 * Tests for rename_candidate edges surfaced in listUncertainties.
 *
 * Verifies that rename_candidate edges are consumed and presented
 * as uncertainty items rather than being write-only.
 */
import { describe, it, expect, vi } from 'vitest';
import { listUncertainties } from '../ops/uncertainties.js';
import type {
  ListUncertaintiesReadHandle,
  ClaimReadRow,
} from '../handles.js';

function mkHandle(
  overrides: Partial<ListUncertaintiesReadHandle> = {},
): ListUncertaintiesReadHandle {
  return {
    getNode: vi.fn().mockReturnValue(null),
    neighbors: vi.fn().mockReturnValue([]),
    ftsSearch: vi.fn().mockReturnValue([]),
    getClaim: vi.fn().mockReturnValue(null),
    partiality: vi.fn().mockReturnValue([]),
    allClaimIds: vi.fn().mockReturnValue([]),
    getClaimRecord: vi.fn().mockReturnValue(null),
    allEdges: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

describe('listUncertainties: rename candidates', () => {
  it('surfaces rename_candidate edges as uncertainty items', () => {
    const handle = mkHandle({
      allEdges: vi.fn().mockImplementation((kind?: string) => {
        if (kind === 'rename_candidate') {
          return [
            {
              fromNodeId: 'node::file::old',
              toNodeId: 'node::file::new',
              kind: 'rename_candidate',
            },
          ];
        }
        return [];
      }),
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node::file::old') return { id, path: 'src/old-name.ts' };
        if (id === 'node::file::new') return { id, path: 'src/new-name.ts' };
        return null;
      }),
    });

    const result = listUncertainties(handle);
    const renameItems = result.data.filter((item) => item.kind === 'rename-candidate');

    expect(renameItems).toHaveLength(1);
    expect(renameItems[0]!.description).toContain('src/old-name.ts');
    expect(renameItems[0]!.description).toContain('src/new-name.ts');
    expect(renameItems[0]!.severity).toBe('medium');
    expect(renameItems[0]!.relatedNodeIds).toEqual(['node::file::old', 'node::file::new']);
  });

  it('returns empty when no rename_candidate edges exist', () => {
    const handle = mkHandle();

    const result = listUncertainties(handle);
    const renameItems = result.data.filter((item) => item.kind === 'rename-candidate');

    expect(renameItems).toHaveLength(0);
  });

  it('respects minSeverity filter for rename candidates', () => {
    const handle = mkHandle({
      allEdges: vi.fn().mockImplementation((kind?: string) => {
        if (kind === 'rename_candidate') {
          return [
            { fromNodeId: 'a', toNodeId: 'b', kind: 'rename_candidate' },
          ];
        }
        return [];
      }),
    });

    // Rename candidates are severity 'medium'; filtering to 'high' should exclude them
    const result = listUncertainties(handle, { minSeverity: 'high' });
    const renameItems = result.data.filter((item) => item.kind === 'rename-candidate');

    expect(renameItems).toHaveLength(0);
  });

  it('falls back to node IDs when getNode returns null', () => {
    const handle = mkHandle({
      allEdges: vi.fn().mockImplementation((kind?: string) => {
        if (kind === 'rename_candidate') {
          return [
            { fromNodeId: 'old-id', toNodeId: 'new-id', kind: 'rename_candidate' },
          ];
        }
        return [];
      }),
    });

    const result = listUncertainties(handle);
    const renameItems = result.data.filter((item) => item.kind === 'rename-candidate');

    expect(renameItems).toHaveLength(1);
    expect(renameItems[0]!.description).toContain('old-id');
    expect(renameItems[0]!.description).toContain('new-id');
  });
});
