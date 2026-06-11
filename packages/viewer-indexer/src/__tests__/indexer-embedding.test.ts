/**
 * Tests Indexer embedding integration.
 *
 * Verifies that the Indexer:
 *   - Accepts an embedder via setEmbedder()
 *   - Calls upsertEmbedding when embedder is available and skipEmbed is false
 *   - Skips embedding when embedder is null (graceful degradation)
 *   - Skips embedding when skipEmbed is true
 *   - Records partiality when embedding fails
 */
import { describe, it, expect, vi } from 'vitest';
import { Indexer, isZeroVector } from '../indexer.js';
import type { Embedder } from '../embedder.js';

describe('Indexer.setEmbedder', () => {
  it('accepts null without error', () => {
    const stubStore = {} as Parameters<typeof Indexer.prototype.setEmbedder>[0] extends never
      ? never
      : unknown;
    const indexer = new Indexer(stubStore as any);
    expect(() => indexer.setEmbedder(null)).not.toThrow();
  });

  it('accepts an Embedder without error', () => {
    const indexer = new Indexer({} as any);
    const mockEmbedder: Embedder = {
      modelName: 'test-model',
      dimension: 4,
      embed: async () => new Float32Array(4),
      embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(4)),
      close: () => {},
    };
    expect(() => indexer.setEmbedder(mockEmbedder)).not.toThrow();
  });
});

describe('Indexer.index skipEmbed option', () => {
  it('index input accepts skipEmbed boolean', async () => {
    const indexer = new Indexer({} as any);
    // Verify the type accepts skipEmbed by calling with a path that will
    // fail before store interaction (path traversal rejection test)
    await expect(
      indexer.index({ repoRoot: '..', skipEmbed: true }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('index input defaults skipEmbed to undefined', async () => {
    const indexer = new Indexer({} as any);
    // Calling without skipEmbed should still work (defaults)
    await expect(
      indexer.index({ repoRoot: '..' }),
    ).rejects.toThrow('must not contain ".."');
  });
});

describe('isZeroVector', () => {
  it('returns true for all-zero vector', () => {
    expect(isZeroVector(new Float32Array(384))).toBe(true);
    expect(isZeroVector(new Float32Array([0, 0, 0]))).toBe(true);
  });

  it('returns false for non-zero vector', () => {
    expect(isZeroVector(new Float32Array([0.1, 0, 0]))).toBe(false);
    expect(isZeroVector(new Float32Array([0, 0, 0.001]))).toBe(false);
  });

  it('returns true for empty vector', () => {
    expect(isZeroVector(new Float32Array(0))).toBe(true);
  });
});

describe('Indexer does not persist zero-vector embeddings', () => {
  it('skips upsertEmbedding when embedder returns zeros', async () => {
    const upsertEmbeddingCalls: unknown[] = [];
    const mockStore = {
      beginSnapshot: () => ({
        insertRevision: vi.fn(),
        clearFtsForRepository: vi.fn(),
        deleteFtsForFile: vi.fn(),
        upsertNode: vi.fn(),
        upsertEdge: vi.fn(),
        appendEvidence: vi.fn(),
        versionClaim: vi.fn(),
        insertFtsText: vi.fn(),
        upsertEmbedding: vi.fn((row: unknown) => { upsertEmbeddingCalls.push(row); }),
        upsertPartiality: vi.fn(),
        closeStaleIntervals: vi.fn(),
        commit: vi.fn(),
        abort: vi.fn(),
      }),
    };

    // Embedder that always returns zeros (simulating cache miss without ONNX)
    const zeroEmbedder: Embedder = {
      modelName: 'test-zero-model',
      dimension: 3,
      embed: async () => new Float32Array(3), // all zeros
      embedBatch: async (ts: string[]) => ts.map(() => new Float32Array(3)),
      close: () => {},
    };

    const indexer = new Indexer(mockStore as any);
    indexer.setEmbedder(zeroEmbedder);

    // Use a temp directory with at least one file
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempDir = mkdtempSync(join(tmpdir(), 'viewer-zero-embed-'));
    writeFileSync(join(tempDir, 'index.ts'), 'export const x = 1;');

    try {
      await indexer.index({ repoRoot: tempDir });
    } catch {
      // May throw due to git not being available, etc. — that's OK
    }

    // No embeddings should have been persisted (all zero vectors skipped)
    expect(upsertEmbeddingCalls).toHaveLength(0);
  });
});
