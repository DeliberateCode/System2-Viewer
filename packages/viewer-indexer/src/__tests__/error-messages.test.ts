import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Tests that indexer stage error messages include actionable hints.
 *
 * We trigger real stage failures by providing a store whose
 * transaction methods throw at specific points.
 */

import { Indexer } from '../indexer.js';

function makeFailingStore(overrides: Record<string, () => void>): any {
  return {
    beginSnapshot: () => ({
      insertRevision: () => {},
      upsertNode: () => {},
      upsertEdge: () => {},
      insertFtsText: () => {},
      clearFtsForRepository: () => {},
      deleteFtsForFile: () => {},
      versionClaim: () => {},
      appendEvidence: () => {},
      upsertFileHash: () => {},
      upsertPartiality: () => {},
      closeInterval: () => {},
      closeStaleIntervals: () => {},
      promoteRule: () => {},
      commit: () => {},
      abort: () => {},
      ...overrides,
    }),
    read: () => ({
      getFileHash: () => null,
      close: () => {},
    }),
    close: () => {},
  };
}

describe('Indexer stage error messages', () => {
  it('Symbol Extraction failure includes grammar hint', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'viewer-err-test-'));
    writeFileSync(join(tmp, 'test.ts'), 'export const x = 1;');

    // insertFtsText is called during symbol extraction (processFileSymbols)
    const store = makeFailingStore({
      insertFtsText: () => { throw new Error('simulated fts failure'); },
    });

    const indexer = new Indexer(store);

    try {
      await indexer.index({ repoRoot: tmp });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('Symbol Extraction');
      expect(err.message).toContain('viewer doctor');
      expect(err.message).toContain('grammar availability');
      expect(err.cause).toBeDefined();
    }
  });

  it('File Node Creation failure wraps without a stage-specific hint', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'viewer-err-test-'));
    writeFileSync(join(tmp, 'test.ts'), 'export const x = 1;');

    // upsertEdge is called during createFileNodes for 'contains' edges.
    // The repo upsertNode calls succeed (initializeTransaction), then
    // createFileNodes calls upsertEdge which will throw.
    const store = makeFailingStore({
      upsertEdge: () => { throw new Error('simulated edge failure'); },
    });

    const indexer = new Indexer(store);

    try {
      await indexer.index({ repoRoot: tmp });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('File Node Creation');
      expect(err.message).toContain('simulated edge failure');
      // No stage-specific hint for File Node Creation
      expect(err.message).not.toContain('viewer doctor');
      expect(err.cause).toBeDefined();
    }
  });

  it('error message format includes stage name in quotes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'viewer-err-test-'));
    writeFileSync(join(tmp, 'test.ts'), 'export const x = 1;');

    const store = makeFailingStore({
      upsertEdge: () => { throw new Error('boom'); },
    });

    const indexer = new Indexer(store);

    try {
      await indexer.index({ repoRoot: tmp });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/Indexing failed at stage "[^"]+"/);
    }
  });
});
