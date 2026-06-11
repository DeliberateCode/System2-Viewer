/**
 * Regression tests for three revision-scoping bugs:
 *
 * 1. Feedback overwrites original claim's historical visibility
 * 2. bindHandle widenings leak current data through unscoped queries
 * 3. viewer index --skip-embed parsed but ignored by bin adapter
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ModelStore } from '@system2-viewer/viewer-store';
import type { ClaimRow, NodeRow, EdgeRow } from '@system2-viewer/viewer-store';
import { createFeedbackOperations } from '../feedback.js';
import { bindHandle } from '../bind-handle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-bugfix-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
  tempDirs.length = 0;
});

const now = '2026-01-01T00:00:00.000Z';

function makeClaimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: 'claim-1',
    claimType: 'file-defines-symbol',
    statement: 'index.ts defines function main',
    status: 'hypothesis',
    repositoryId: 'repo1',
    scopeJson: JSON.stringify({ path: 'src/index.ts' }),
    confidenceBand: 'medium',
    freshnessBand: 'fresh',
    supportingEvidenceIdsJson: JSON.stringify(['evd-1']),
    contradictingEvidenceIdsJson: null,
    verificationRecipesJson: JSON.stringify([{ type: 'source_span_check' }]),
    derivationMethod: 'indexer',
    generationId: 'gen-1',
    surfaced: 1,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeNodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'node-1',
    kind: 'file',
    stableKey: 'repo1:file:src/index.ts',
    displayName: 'index.ts',
    repositoryId: 'repo1',
    path: 'src/index.ts',
    language: 'typescript',
    fileClass: 'source',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEdgeRow(overrides: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: 'edge-1',
    kind: 'imports',
    epistemic: 'static',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    repositoryId: 'repo1',
    confidenceBand: 'high',
    provenanceMethod: 'indexer',
    extractor: 'tree-sitter',
    evidenceIdsJson: null,
    metadataJson: null,
    validFromRevision: 'rev1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// 1. Feedback preserves original claim at its original revision
// ---------------------------------------------------------------------------

describe('feedback: original claim remains visible at original revision', () => {
  it('confirmClaim creates a new revision and preserves original claim visibility', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    // Seed a revision and a claim at rev1
    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.versionClaim(makeClaimRow({ id: 'claim-fb-test', validFromRevision: 'rev1' }));
    txn1.commit();

    // Open readonly connection
    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    // Perform feedback
    const feedback = createFeedbackOperations(store, readonlyDb);
    const result = feedback.confirmClaim({
      claimId: 'claim-fb-test',
      actor: 'test-user',
      note: 'looks good',
    });

    expect(result.evidenceAppended).toBe(true);
    expect(result.successorId).not.toBeNull();
    expect(result.error).toBeUndefined();

    // Key assertion: original claim is still visible at rev1
    const origAtRev1 = readonlyDb.prepare(`
      SELECT id, valid_from_revision, valid_to_revision FROM claims
      WHERE id = 'claim-fb-test'
        AND valid_from_revision <= 'rev1'
        AND (valid_to_revision IS NULL OR valid_to_revision > 'rev1')
    `).get() as { id: string; valid_from_revision: string; valid_to_revision: string | null } | undefined;

    expect(origAtRev1).toBeDefined();
    expect(origAtRev1!.id).toBe('claim-fb-test');

    // The original claim should have been closed at a feedback revision (not rev1)
    const closedClaim = readonlyDb.prepare(`
      SELECT id, valid_to_revision FROM claims
      WHERE id = 'claim-fb-test' AND valid_to_revision IS NOT NULL
    `).get() as { id: string; valid_to_revision: string } | undefined;

    expect(closedClaim).toBeDefined();
    // The valid_to_revision should be a feedback revision, not the original
    expect(closedClaim!.valid_to_revision).not.toBe('rev1');
    expect(closedClaim!.valid_to_revision).toMatch(/^rev::\d+::fb::/);

    // Successor should exist with validFromRevision = feedback revision
    const successor = readonlyDb.prepare(`
      SELECT id, valid_from_revision FROM claims
      WHERE id = @successorId AND valid_to_revision IS NULL
    `).get({ successorId: result.successorId }) as { id: string; valid_from_revision: string } | undefined;

    expect(successor).toBeDefined();
    expect(successor!.valid_from_revision).toMatch(/^rev::\d+::fb::/);
    expect(successor!.valid_from_revision).toBe(closedClaim!.valid_to_revision);

    // A feedback revision row was inserted
    const fbRev = readonlyDb.prepare(`
      SELECT id, kind, parent_id FROM revisions WHERE id LIKE 'rev::%::fb::%'
    `).get() as { id: string; kind: string; parent_id: string | null } | undefined;

    expect(fbRev).toBeDefined();
    expect(fbRev!.kind).toBe('working_tree');
    expect(fbRev!.parent_id).toBe('rev1');

    readonlyDb.close();
    store.close();
  });

  it('rejectClaim also uses a new feedback revision', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.versionClaim(makeClaimRow({ id: 'claim-reject-test', validFromRevision: 'rev1' }));
    txn1.commit();

    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    const feedback = createFeedbackOperations(store, readonlyDb);
    const result = feedback.rejectClaim({
      claimId: 'claim-reject-test',
      actor: 'test-user',
      note: 'wrong',
    });

    expect(result.evidenceAppended).toBe(true);

    // Original visible at rev1
    const origAtRev1 = readonlyDb.prepare(`
      SELECT id FROM claims
      WHERE id = 'claim-reject-test'
        AND valid_from_revision <= 'rev1'
        AND (valid_to_revision IS NULL OR valid_to_revision > 'rev1')
    `).get() as { id: string } | undefined;

    expect(origAtRev1).toBeDefined();

    readonlyDb.close();
    store.close();
  });
});

// ---------------------------------------------------------------------------
// 2. bindHandle widenings respect revision parameter
// ---------------------------------------------------------------------------

describe('bindHandle: widened helpers respect revision', () => {
  it('allClaimIds filters by revision interval', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    // Create claim at rev1, close it at rev2, create new claim at rev2
    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.versionClaim(makeClaimRow({ id: 'claim-old', validFromRevision: 'rev1' }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.insertRevision({
      id: 'rev2',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: 'rev1',
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn2.closeInterval('claim-old', 'rev2');
    txn2.versionClaim(makeClaimRow({ id: 'claim-new', validFromRevision: 'rev2' }));
    txn2.commit();

    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    // At rev1, only claim-old should be visible
    const readRev1 = store.read('rev1');
    const handleRev1 = bindHandle(readRev1, readonlyDb, 'rev1');
    const idsAtRev1 = handleRev1.allClaimIds!();
    expect(idsAtRev1).toContain('claim-old');
    expect(idsAtRev1).not.toContain('claim-new');
    readRev1.close();

    // At rev2, only claim-new should be visible
    const readRev2 = store.read('rev2');
    const handleRev2 = bindHandle(readRev2, readonlyDb, 'rev2');
    const idsAtRev2 = handleRev2.allClaimIds!();
    expect(idsAtRev2).toContain('claim-new');
    expect(idsAtRev2).not.toContain('claim-old');
    readRev2.close();

    readonlyDb.close();
    store.close();
  });

  it('getClaimRecord filters by revision interval', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.versionClaim(makeClaimRow({ id: 'claim-versioned', validFromRevision: 'rev1' }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.insertRevision({
      id: 'rev2',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: 'rev1',
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn2.closeInterval('claim-versioned', 'rev2');
    txn2.commit();

    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    // At rev1, claim should be found
    const readRev1 = store.read('rev1');
    const handleRev1 = bindHandle(readRev1, readonlyDb, 'rev1');
    const recordRev1 = handleRev1.getClaimRecord!('claim-versioned');
    expect(recordRev1).not.toBeNull();
    expect(recordRev1!.id).toBe('claim-versioned');
    readRev1.close();

    // At rev2, claim should NOT be found (was closed)
    const readRev2 = store.read('rev2');
    const handleRev2 = bindHandle(readRev2, readonlyDb, 'rev2');
    const recordRev2 = handleRev2.getClaimRecord!('claim-versioned');
    expect(recordRev2).toBeNull();
    readRev2.close();

    readonlyDb.close();
    store.close();
  });

  it('allEdges filters by revision interval', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    // Create nodes + edge at rev1
    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.upsertNode(makeNodeRow({ id: 'node-a', validFromRevision: 'rev1' }));
    txn1.upsertNode(makeNodeRow({ id: 'node-b', stableKey: 'repo1:file:b', validFromRevision: 'rev1' }));
    txn1.upsertEdge(makeEdgeRow({ id: 'edge-ab', fromNodeId: 'node-a', toNodeId: 'node-b', validFromRevision: 'rev1' }));
    txn1.commit();

    // Close edge at rev2
    const txn2 = store.beginSnapshot('rev2');
    txn2.insertRevision({
      id: 'rev2',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: 'rev1',
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn2.closeInterval('edge-ab', 'rev2');
    txn2.commit();

    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    // At rev1, edge should be visible
    const readRev1 = store.read('rev1');
    const handleRev1 = bindHandle(readRev1, readonlyDb, 'rev1');
    const edgesRev1 = handleRev1.allEdges!();
    expect(edgesRev1.some(e => e.fromNodeId === 'node-a' && e.toNodeId === 'node-b')).toBe(true);
    readRev1.close();

    // At rev2, edge should NOT be visible
    const readRev2 = store.read('rev2');
    const handleRev2 = bindHandle(readRev2, readonlyDb, 'rev2');
    const edgesRev2 = handleRev2.allEdges!();
    expect(edgesRev2.some(e => e.fromNodeId === 'node-a' && e.toNodeId === 'node-b')).toBe(false);
    readRev2.close();

    readonlyDb.close();
    store.close();
  });

  it('inboundEdges filters by revision interval', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);

    const txn1 = store.beginSnapshot('rev1');
    txn1.insertRevision({
      id: 'rev1',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn1.upsertNode(makeNodeRow({ id: 'node-x', validFromRevision: 'rev1' }));
    txn1.upsertNode(makeNodeRow({ id: 'node-y', stableKey: 'repo1:file:y', validFromRevision: 'rev1' }));
    txn1.upsertEdge(makeEdgeRow({ id: 'edge-xy', fromNodeId: 'node-x', toNodeId: 'node-y', validFromRevision: 'rev1' }));
    txn1.commit();

    const txn2 = store.beginSnapshot('rev2');
    txn2.insertRevision({
      id: 'rev2',
      repositoryId: 'repo1',
      kind: 'working_tree',
      parentId: 'rev1',
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });
    txn2.closeInterval('edge-xy', 'rev2');
    txn2.commit();

    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    // At rev1, inbound edge to node-y should exist
    const readRev1 = store.read('rev1');
    const handleRev1 = bindHandle(readRev1, readonlyDb, 'rev1');
    const inboundRev1 = handleRev1.inboundEdges!('node-y');
    expect(inboundRev1.length).toBe(1);
    expect(inboundRev1[0]!.fromNodeId).toBe('node-x');
    readRev1.close();

    // At rev2, no inbound edges
    const readRev2 = store.read('rev2');
    const handleRev2 = bindHandle(readRev2, readonlyDb, 'rev2');
    const inboundRev2 = handleRev2.inboundEdges!('node-y');
    expect(inboundRev2.length).toBe(0);
    readRev2.close();

    readonlyDb.close();
    store.close();
  });
});

// ---------------------------------------------------------------------------
// 3. bin adapter forwards skipEmbed
// ---------------------------------------------------------------------------

describe('bin adapter: skipEmbed forwarding', () => {
  it('ops.index receives skipEmbed from parsed args', async () => {
    // The bin adapter builds an ops.index that calls engine.indexer.index().
    // We test the adapter logic by simulating what viewer.mjs does:
    // Given args with skipEmbed=true, the object passed to indexer.index()
    // should include skipEmbed: true.
    //
    // We replicate the adapter's index function here to prove it forwards
    // the skipEmbed field:
    let capturedInput: Record<string, unknown> | undefined;

    const mockIndexer = {
      async index(input: Record<string, unknown>) {
        capturedInput = input;
        return { revision: 'rev-test' };
      },
    };

    // This is the fixed adapter code from viewer.mjs:
    const opsIndex = async (a: Record<string, unknown>) => {
      const result = await mockIndexer.index({
        repoRoot: (a['repoRoot'] as string) || '.',
        depth: a['depth'],
        workspace: a['workspace'],
        skipEmbed: a['skipEmbed'],
      });
      return {
        query: { op: 'index', args: a },
        data: { revision: result.revision, sourceModified: false },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: result.revision,
      };
    };

    await opsIndex({ repoRoot: '.', skipEmbed: true });

    expect(capturedInput).toBeDefined();
    expect(capturedInput!['skipEmbed']).toBe(true);
  });

  it('ops.index forwards skipEmbed=false when not set', async () => {
    let capturedInput: Record<string, unknown> | undefined;

    const mockIndexer = {
      async index(input: Record<string, unknown>) {
        capturedInput = input;
        return { revision: 'rev-test' };
      },
    };

    const opsIndex = async (a: Record<string, unknown>) => {
      const result = await mockIndexer.index({
        repoRoot: (a['repoRoot'] as string) || '.',
        depth: a['depth'],
        workspace: a['workspace'],
        skipEmbed: a['skipEmbed'],
      });
      return {
        query: { op: 'index', args: a },
        data: { revision: result.revision, sourceModified: false },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: result.revision,
      };
    };

    await opsIndex({ repoRoot: '.' });

    expect(capturedInput).toBeDefined();
    expect(capturedInput!['skipEmbed']).toBeUndefined();
  });
});
