/**
 * Regression tests for three bug fixes:
 *   1. mcpConfig wired in CLI ops adapter
 *   2. Subsystem feedback resolves to hypothesis claim
 *   3. Readonly mode does not create model.sqlite
 *
 * Category: regression
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import { createFeedbackOperations } from '../feedback.js';
import { runCli } from '../cli.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-bugfix3-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Finding 1: mcpConfig available in CLI dispatch
// ---------------------------------------------------------------------------

describe('Finding 1: mcpConfig command availability', () => {
  function makeEnvelope(op: string, data: unknown = {}): ResultEnvelope<unknown> {
    return {
      query: { op, args: {} },
      data,
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'test-rev',
    };
  }

  it('mcp-config command dispatches to ops.mcpConfig when available', async () => {
    const resolveResult: ResolveResult = {
      status: 'resolved',
      id: 'node-123',
      kind: 'path',
      displayName: 'test/file.ts',
    };

    const ops: CliOps = {
      getRepositoryOverview: vi.fn(() => makeEnvelope('getRepositoryOverview')),
      findEntrypoints: vi.fn(() => makeEnvelope('findEntrypoints')),
      traceFlow: vi.fn(() => makeEnvelope('traceFlow')),
      explainSubsystem: vi.fn(() => makeEnvelope('explainSubsystem')),
      estimateBlastRadius: vi.fn(() => makeEnvelope('estimateBlastRadius')),
      listClaims: vi.fn(() => makeEnvelope('listClaims')),
      listUncertainties: vi.fn(() => makeEnvelope('listUncertainties')),
      checkInvariants: vi.fn(() => makeEnvelope('checkInvariants')),
      verifyClaim: vi.fn(() => makeEnvelope('verifyClaim')),
      buildClaimPayload: vi.fn(() => makeEnvelope('buildClaimPayload')),
      sampleEvidenceAgreement: vi.fn(() => makeEnvelope('sampleEvidenceAgreement')),
      feedback: {
        confirmClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 'c1-fb' })),
        rejectClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 'c1-fb' })),
        annotateClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 'c1-fb' })),
        confirmSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 's1-fb' })),
        rejectSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 's1-fb' })),
        annotateSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 's1-fb' })),
      },
      index: vi.fn(async () => makeEnvelope('index')),
      resolveRef: vi.fn(() => makeEnvelope('resolveReference', resolveResult) as ResultEnvelope<ResolveResult>),
      getClaimHistory: vi.fn(() => makeEnvelope('getClaimHistory')),
      compareRevisions: vi.fn(() => makeEnvelope('compareRevisions')),
      doctor: vi.fn(async () => makeEnvelope('doctor')),
      status: vi.fn(() => makeEnvelope('status')),
      initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
      mcpConfig: vi.fn(() => ({ targetPath: '/tmp/.mcp.json', created: true })),
    } as unknown as CliOps;

    const output: string[] = [];
    const exitCode = await runCli(
      ['mcp-config', '--package', '/tmp/my-pkg'],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(0);
    expect(ops.mcpConfig).toHaveBeenCalledWith(
      expect.objectContaining({ package: '/tmp/my-pkg' }),
    );
  });

  it('mcp-config exits 1 when ops.mcpConfig is not provided', async () => {
    const ops: CliOps = {
      getRepositoryOverview: vi.fn(() => makeEnvelope('getRepositoryOverview')),
      findEntrypoints: vi.fn(() => makeEnvelope('findEntrypoints')),
      traceFlow: vi.fn(() => makeEnvelope('traceFlow')),
      explainSubsystem: vi.fn(() => makeEnvelope('explainSubsystem')),
      estimateBlastRadius: vi.fn(() => makeEnvelope('estimateBlastRadius')),
      listClaims: vi.fn(() => makeEnvelope('listClaims')),
      listUncertainties: vi.fn(() => makeEnvelope('listUncertainties')),
      checkInvariants: vi.fn(() => makeEnvelope('checkInvariants')),
      verifyClaim: vi.fn(() => makeEnvelope('verifyClaim')),
      buildClaimPayload: vi.fn(() => makeEnvelope('buildClaimPayload')),
      sampleEvidenceAgreement: vi.fn(() => makeEnvelope('sampleEvidenceAgreement')),
      feedback: {
        confirmClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 'c1-fb' })),
        rejectClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 'c1-fb' })),
        annotateClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 'c1-fb' })),
        confirmSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 's1-fb' })),
        rejectSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 's1-fb' })),
        annotateSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 's1-fb' })),
      },
      index: vi.fn(async () => makeEnvelope('index')),
      resolveRef: vi.fn(() => makeEnvelope('resolveReference', { status: 'resolved', id: 'x', kind: 'path', displayName: 'x' }) as ResultEnvelope<ResolveResult>),
      getClaimHistory: vi.fn(() => makeEnvelope('getClaimHistory')),
      compareRevisions: vi.fn(() => makeEnvelope('compareRevisions')),
      doctor: vi.fn(async () => makeEnvelope('doctor')),
      status: vi.fn(() => makeEnvelope('status')),
      initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
      // mcpConfig intentionally NOT provided
    } as unknown as CliOps;

    const output: string[] = [];
    const exitCode = await runCli(
      ['mcp-config', '--package', '/tmp/my-pkg'],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(1);
    expect(output.some(l => l.includes('not available'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 2: Subsystem feedback resolves to hypothesis claim
// ---------------------------------------------------------------------------

describe('Finding 2: subsystem feedback targets hypothesis claim', () => {
  it('confirmSubsystem resolves subsystem node to hypothesis claim', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    try {
      // Setup: create a subsystem node and a hypothesis claim referencing it
      const txn = store.beginSnapshot('rev1');
      const now = new Date().toISOString();

      txn.insertRevision({
        id: 'rev1',
        repositoryId: 'repo1',
        kind: 'working_tree',
        parentId: null,
        committedAt: null,
        indexedAt: now,
        historyBounded: 0,
      });

      txn.appendEvidence({
        id: 'ev-1',
        kind: 'source_span',
        epistemic: 'static',
        repositoryId: 'repo1',
        revision: 'rev1',
        path: 'src/',
        startLine: null,
        endLine: null,
        contentHash: null,
        extractor: 'indexer',
        derivationLocality: 'local',
        actor: null,
        metadataJson: null,
        createdAt: now,
      });

      txn.upsertNode({
        id: 'subsystem-node-1',
        kind: 'subsystem',
        stableKey: 'repo1:subsystem:src',
        displayName: 'src subsystem',
        repositoryId: 'repo1',
        path: 'src/',
        language: null,
        fileClass: null,
        provenanceMethod: 'indexer',
        extractor: 'tree-sitter',
        metadataJson: null,
        validFromRevision: 'rev1',
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });

      txn.versionClaim({
        id: 'claim-hyp-1',
        claimType: 'directory-derived-subsystem-hypothesis',
        statement: 'The src directory forms a cohesive subsystem',
        status: 'hypothesis',
        repositoryId: 'repo1',
        scopeJson: JSON.stringify({ subsystemId: 'subsystem-node-1', path: 'src/' }),
        confidenceBand: 'medium',
        freshnessBand: 'fresh',
        supportingEvidenceIdsJson: JSON.stringify(['ev-1']),
        contradictingEvidenceIdsJson: null,
        verificationRecipesJson: JSON.stringify([]),
        derivationMethod: 'indexer',
        generationId: 'gen-1',
        surfaced: 1,
        validFromRevision: 'rev1',
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });

      txn.commit();

      // Re-open readonly to see committed data
      readonlyDb.close();
      const freshReadonlyDb = new Database(dbPath, { readonly: true });
      freshReadonlyDb.pragma('journal_mode = WAL');

      try {
        const feedback = createFeedbackOperations(store, freshReadonlyDb);

        // Act: confirm the subsystem by its node ID
        const result = feedback.confirmSubsystem({
          targetId: 'subsystem-node-1',
          actor: 'test-user',
          note: 'Looks correct',
        });

        // Assert: the operation succeeded and targeted the hypothesis claim
        expect(result.error).toBeUndefined();
        expect(result.evidenceAppended).toBe(true);
        expect(result.claimId).toBe('claim-hyp-1');
        expect(result.priorStatus).toBe('hypothesis');
      } finally {
        freshReadonlyDb.close();
      }
    } finally {
      store.close();
    }
  });

  it('confirmSubsystem returns error when no hypothesis claim exists', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    const dbPath = join(dataDir, 'model.sqlite');
    const readonlyDb = new Database(dbPath, { readonly: true });

    try {
      const feedback = createFeedbackOperations(store, readonlyDb);

      const result = feedback.confirmSubsystem({
        targetId: 'nonexistent-subsystem',
        actor: 'test-user',
      });

      expect(result.error).toContain('No hypothesis claim found for subsystem');
      expect(result.evidenceAppended).toBe(false);
    } finally {
      readonlyDb.close();
      store.close();
    }
  });

  it('rejectSubsystem resolves and rejects the hypothesis claim', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    const dbPath = join(dataDir, 'model.sqlite');

    try {
      const txn = store.beginSnapshot('rev1');
      const now = new Date().toISOString();

      txn.insertRevision({
        id: 'rev1',
        repositoryId: 'repo1',
        kind: 'working_tree',
        parentId: null,
        committedAt: null,
        indexedAt: now,
        historyBounded: 0,
      });

      txn.appendEvidence({
        id: 'ev-r1',
        kind: 'source_span',
        epistemic: 'static',
        repositoryId: 'repo1',
        revision: 'rev1',
        path: 'lib/',
        startLine: null,
        endLine: null,
        contentHash: null,
        extractor: 'indexer',
        derivationLocality: 'local',
        actor: null,
        metadataJson: null,
        createdAt: now,
      });

      txn.versionClaim({
        id: 'claim-hyp-reject',
        claimType: 'directory-derived-subsystem-hypothesis',
        statement: 'The lib directory forms a subsystem',
        status: 'hypothesis',
        repositoryId: 'repo1',
        scopeJson: JSON.stringify({ subsystemId: 'sub-reject-node', path: 'lib/' }),
        confidenceBand: 'medium',
        freshnessBand: 'fresh',
        supportingEvidenceIdsJson: JSON.stringify(['ev-r1']),
        contradictingEvidenceIdsJson: null,
        verificationRecipesJson: JSON.stringify([]),
        derivationMethod: 'indexer',
        generationId: 'gen-1',
        surfaced: 1,
        validFromRevision: 'rev1',
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });

      txn.commit();

      const freshDb = new Database(dbPath, { readonly: true });
      freshDb.pragma('journal_mode = WAL');

      try {
        const feedback = createFeedbackOperations(store, freshDb);
        const result = feedback.rejectSubsystem({
          targetId: 'sub-reject-node',
          actor: 'reviewer',
          note: 'Not a real subsystem',
        });

        expect(result.error).toBeUndefined();
        expect(result.evidenceAppended).toBe(true);
        expect(result.newStatus).toBe('rejected');
      } finally {
        freshDb.close();
      }
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Finding 3: readonly diagnostics do not create model.sqlite
// ---------------------------------------------------------------------------

describe('Finding 3: readonly diagnostics do not create model.sqlite', () => {
  it('createViewerEngine with readonly=true does not create model.sqlite', () => {
    const dataDir = join(makeTempDir(), 'nonexistent-subdir');
    // dataDir does not exist yet

    const engine = createViewerEngine({ dataDir, readonly: true });
    try {
      const dbPath = join(dataDir, 'model.sqlite');
      expect(existsSync(dbPath)).toBe(false);
      // The directory itself should not be created either
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('status works in readonly mode without creating files', () => {
    const dataDir = join(makeTempDir(), 'fresh-status');

    const engine = createViewerEngine({ dataDir, readonly: true });
    try {
      const result = engine.status();
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      const data = result.data as unknown as Record<string, unknown>;
      // No model => appropriate readiness state
      expect(data['readinessState']).toBe('no-model');

      // Verify no file was created
      expect(existsSync(join(dataDir, 'model.sqlite'))).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('doctor works in readonly mode without creating files', async () => {
    const dataDir = join(makeTempDir(), 'fresh-doctor');

    const engine = createViewerEngine({ dataDir, readonly: true });
    try {
      const result = await engine.doctor();
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();

      // Verify no file was created
      expect(existsSync(join(dataDir, 'model.sqlite'))).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('non-readonly engine still creates model.sqlite eagerly', () => {
    const dataDir = makeTempDir();

    const engine = createViewerEngine({ dataDir });
    try {
      const dbPath = join(dataDir, 'model.sqlite');
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      engine.close();
    }
  });
});
