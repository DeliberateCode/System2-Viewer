/**
 * Golden retrieval result tests for complex queries.
 *
 * Indexes the sample-monorepo fixture, then runs retrieval operations
 * (blast radius, trace flow, find entrypoints) and verifies minimum
 * result counts to catch accuracy regressions.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '@system2-viewer/viewer-store';
import { Indexer } from '@system2-viewer/viewer-indexer';
import { deriveRepositoryId } from '@system2-viewer/viewer-core';
import {
  estimateBlastRadius,
  findEntrypoints,
  traceFlow,
} from '@system2-viewer/viewer-retrieval';
import {
  GOLDEN_QUERY_FIXTURES,
  type GoldenQueryResult,
} from '../golden-fixture.js';

const SAMPLE_MONOREPO = join(__dirname, '..', '..', '..', '..', 'test-fixtures', 'sample-monorepo');

describe('golden retrieval results', () => {
  let dataDir: string;
  let store: ModelStore;
  let revision: string;
  let repositoryId: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'golden-retrieval-'));
    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({
      repoRoot: SAMPLE_MONOREPO,
      depth: 50,
      skipEmbed: true,
    });
    revision = result.revision;
    repositoryId = deriveRepositoryId(SAMPLE_MONOREPO);
  }, 30_000);

  afterAll(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('exports GOLDEN_QUERY_FIXTURES array with expected entries', () => {
    expect(GOLDEN_QUERY_FIXTURES.length).toBeGreaterThanOrEqual(3);
    const ops = GOLDEN_QUERY_FIXTURES.map((f) => f.op);
    expect(ops).toContain('estimateBlastRadius');
    expect(ops).toContain('traceFlow');
    expect(ops).toContain('findEntrypoints');
  });

  it('estimateBlastRadius finds affected files for core/index.ts', () => {
    const fixture = GOLDEN_QUERY_FIXTURES.find(
      (f) => f.op === 'estimateBlastRadius',
    )!;

    const readHandle = store.read(revision);
    try {
      // Resolve the file path to a node ID
      const filePath = (fixture.args.changeScope as string[])[0];
      const fileNodeId = `node::file::${repositoryId}::${filePath}`;

      const result = estimateBlastRadius(readHandle, [fileNodeId], {
        revision,
        maxDepth: 5,
      });

      expect(result.data.affectedNodes.length).toBeGreaterThanOrEqual(
        fixture.expectedMinResults,
      );

      if (fixture.expectedContains) {
        const nodeIds = result.data.affectedNodes.map((n) => n.nodeId);
        for (const expected of fixture.expectedContains) {
          expect(
            nodeIds.some((id) => id.includes(expected)),
            `expected affectedNodes to contain a node matching "${expected}"`,
          ).toBe(true);
        }
      }
    } finally {
      readHandle.close();
    }
  });

  it('traceFlow finds path segments from api/index.ts toward core', () => {
    const fixture = GOLDEN_QUERY_FIXTURES.find(
      (f) => f.op === 'traceFlow',
    )!;

    const readHandle = store.read(revision);
    try {
      const startPath = fixture.args.start as string;
      const startNodeId = `node::file::${repositoryId}::${startPath}`;
      const targetOrIntent = fixture.args.targetOrIntent as string;

      const result = traceFlow(readHandle, startNodeId, targetOrIntent, {
        revision,
        maxDepth: 10,
      });

      expect(result.data.segments.length).toBeGreaterThanOrEqual(
        fixture.expectedMinResults,
      );
    } finally {
      readHandle.close();
    }
  });

  it('findEntrypoints finds server-related candidates', () => {
    const fixture = GOLDEN_QUERY_FIXTURES.find(
      (f) => f.op === 'findEntrypoints',
    )!;

    const readHandle = store.read(revision);
    try {
      const query = fixture.args.query as string;
      const result = findEntrypoints(readHandle, query, { revision });

      expect(result.data.candidates.length).toBeGreaterThanOrEqual(
        fixture.expectedMinResults,
      );

      if (fixture.expectedContains) {
        const names = result.data.candidates.map((c) =>
          c.displayName.toLowerCase(),
        );
        for (const expected of fixture.expectedContains) {
          expect(
            names.some((n) => n.includes(expected.toLowerCase())),
            `expected candidates to contain one matching "${expected}"`,
          ).toBe(true);
        }
      }
    } finally {
      readHandle.close();
    }
  });
}, 60_000);
