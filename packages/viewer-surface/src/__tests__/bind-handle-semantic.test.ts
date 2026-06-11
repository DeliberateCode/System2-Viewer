/**
 * Tests bind-handle semantic search and embedding coverage wiring.
 *
 * Verifies that bindHandle constructs a UnionHandle that:
 *   - Includes semanticSearch closure
 *   - Includes embeddingCoverage closure
 *   - Delegates both to the ReadHandle
 */
import { describe, it, expect, vi } from 'vitest';
import { bindHandle } from '../bind-handle.js';
import type { ReadHandle } from '@system2-viewer/viewer-store';

function createMockReadHandle(): ReadHandle {
  return {
    neighbors: vi.fn(() => []),
    ftsSearch: vi.fn(() => []),
    getNode: vi.fn(() => null),
    getClaim: vi.fn(() => null),
    claimsByPrefix: vi.fn(() => []),
    listOpenClaims: vi.fn(() => []),
    getEvidence: vi.fn(() => null),
    partiality: vi.fn(() => []),
    verificationHistory: vi.fn(() => []),
    semanticSearch: vi.fn(() => [
      { nodeId: 'node-1', score: 0.95 },
      { nodeId: 'node-2', score: 0.80 },
    ]),
    embeddingCoverage: vi.fn(() => ({ totalNodes: 100, embeddedNodes: 42 })),
    getFileHash: vi.fn(() => null),
    close: vi.fn(),
  };
}

function createMockDb(): any {
  const mockStmt = {
    all: vi.fn(() => []),
    get: vi.fn(() => undefined),
  };
  return {
    prepare: vi.fn(() => mockStmt),
  };
}

describe('bindHandle -- semanticSearch', () => {
  it('returns an object with semanticSearch function', () => {
    const readHandle = createMockReadHandle();
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');
    expect(typeof handle.semanticSearch).toBe('function');
  });

  it('delegates semanticSearch to readHandle', () => {
    const readHandle = createMockReadHandle();
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    const queryVec = new Float32Array([0.1, 0.2, 0.3]);
    const result = handle.semanticSearch!(queryVec, 5);

    expect(readHandle.semanticSearch).toHaveBeenCalledWith(queryVec, 5);
    expect(result).toEqual([
      { nodeId: 'node-1', score: 0.95 },
      { nodeId: 'node-2', score: 0.80 },
    ]);
  });

  it('semanticSearch works with default limit', () => {
    const readHandle = createMockReadHandle();
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    handle.semanticSearch!(new Float32Array([0.5]));
    expect(readHandle.semanticSearch).toHaveBeenCalledWith(
      new Float32Array([0.5]),
      undefined,
    );
  });
});

describe('bindHandle -- embeddingCoverage', () => {
  it('returns an object with embeddingCoverage function', () => {
    const readHandle = createMockReadHandle();
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');
    expect(typeof handle.embeddingCoverage).toBe('function');
  });

  it('delegates embeddingCoverage to readHandle', () => {
    const readHandle = createMockReadHandle();
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    const result = handle.embeddingCoverage!();

    expect(readHandle.embeddingCoverage).toHaveBeenCalled();
    expect(result).toEqual({ totalNodes: 100, embeddedNodes: 42 });
  });
});
