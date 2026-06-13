/**
 * Tests for the composition root: createViewerEngine.
 *
 * These are integration tests that create real ModelStore instances
 * in temp directories and exercise the engine's public API surface.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import { NoModelIndexedError } from '../errors.js';
import type { ViewerEngine } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-engine-test-'));
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

// ---------------------------------------------------------------------------
// createViewerEngine
// ---------------------------------------------------------------------------

describe('createViewerEngine', () => {
  it('creates an engine with a temp data directory', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });
    expect(engine).toBeDefined();
    engine.close();
  });

  it('engine exposes all expected retrieval operations', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    // ViewerOperations keys
    expect(typeof engine.getRepositoryOverview).toBe('function');
    expect(typeof engine.findEntrypoints).toBe('function');
    expect(typeof engine.traceFlow).toBe('function');
    expect(typeof engine.explainSubsystem).toBe('function');
    expect(typeof engine.estimateBlastRadius).toBe('function');
    expect(typeof engine.listClaims).toBe('function');
    expect(typeof engine.listUncertainties).toBe('function');
    expect(typeof engine.checkInvariants).toBe('function');
    expect(typeof engine.verifyClaim).toBe('function');
    expect(typeof engine.buildClaimPayload).toBe('function');
    expect(typeof engine.sampleEvidenceAgreement).toBe('function');

    engine.close();
  });

  it('engine exposes feedback operations', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    expect(engine.feedback).toBeDefined();
    expect(typeof engine.feedback.confirmClaim).toBe('function');
    expect(typeof engine.feedback.rejectClaim).toBe('function');
    expect(typeof engine.feedback.annotateClaim).toBe('function');
    expect(typeof engine.feedback.confirmSubsystem).toBe('function');
    expect(typeof engine.feedback.rejectSubsystem).toBe('function');
    expect(typeof engine.feedback.annotateSubsystem).toBe('function');

    engine.close();
  });

  it('engine exposes indexer', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    expect(engine.indexer).toBeDefined();
    expect(typeof engine.indexer.index).toBe('function');

    engine.close();
  });

  it('engine exposes special operations', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    expect(typeof engine.resolveRef).toBe('function');
    expect(typeof engine.getClaimHistory).toBe('function');
    expect(typeof engine.compareRevisions).toBe('function');
    expect(typeof engine.doctor).toBe('function');
    expect(typeof engine.status).toBe('function');
    expect(typeof engine.initConfig).toBe('function');
    expect(typeof engine.close).toBe('function');

    engine.close();
  });

  it('close() can be called without error', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });
    expect(() => engine.close()).not.toThrow();
  });

  it('throws NoModelIndexedError when querying before index', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    try {
      expect(() => engine.getRepositoryOverview({})).toThrow(NoModelIndexedError);
    } finally {
      engine.close();
    }
  });

  it('NoModelIndexedError has instructive message', () => {
    const err = new NoModelIndexedError();
    expect(err.name).toBe('NoModelIndexedError');
    expect(err.message).toContain('viewer.index');
  });

  it('doctor() works even without indexed data', async () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    try {
      const result = await engine.doctor();
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      const data = result.data as unknown as Record<string, unknown>;
      expect(data['nodeVersion']).toBeDefined();
      expect(data['sqliteBinding']).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('status() works even without indexed data', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    try {
      const result = engine.status();
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      const data = result.data as unknown as Record<string, unknown>;
      expect(data['hasPartiality']).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('seeds custom claim types into kind_registry', () => {
    // Set up a repo root directory with a viewer.config.json
    const repoDir = makeTempDir();
    const configContent = JSON.stringify({
      version: 1,
      claimTypes: [
        { id: 'custom-perf-budget', displayTemplate: '{subject} stays under {threshold}ms' },
        { id: 'custom-api-contract', displayTemplate: '{endpoint} returns {schema}' },
      ],
    });
    writeFileSync(join(repoDir, 'viewer.config.json'), configContent);

    // Set up data directory with workspace-locator pointing to repoDir
    const dataDir = makeTempDir();
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: repoDir }),
    );

    const engine = createViewerEngine({ dataDir });

    try {
      // Query kind_registry directly to verify custom types were seeded
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rows = db
          .prepare(
            "SELECT kind, category, mvp_emitted FROM kind_registry WHERE kind IN (?, ?)",
          )
          .all('custom-perf-budget', 'custom-api-contract') as Array<{
          kind: string;
          category: string;
          mvp_emitted: number;
        }>;

        expect(rows).toHaveLength(2);
        const byKind = new Map(rows.map((r) => [r.kind, r]));

        expect(byKind.get('custom-perf-budget')).toEqual({
          kind: 'custom-perf-budget',
          category: 'claim_type',
          mvp_emitted: 0,
        });
        expect(byKind.get('custom-api-contract')).toEqual({
          kind: 'custom-api-contract',
          category: 'claim_type',
          mvp_emitted: 0,
        });
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('does not seed claim types when config has no claimTypes', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });

    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rows = db
          .prepare(
            "SELECT kind FROM kind_registry WHERE category = 'claim_type'",
          )
          .all() as Array<{ kind: string }>;

        // Only boundary-violation is seeded as a built-in claim_type kind
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('boundary-violation');
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('rule persistence failure produces a warning in status and doctor', async () => {
    // Create a repo dir with a config that defines rules
    const repoDir = makeTempDir();
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        rules: [
          { name: 'no-circular', type: 'forbidden_import', from: '**', to: '**', severity: 'error' },
        ],
      }),
    );

    const dataDir = makeTempDir();
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: repoDir }),
    );

    // First, create a store and insert a revision so the engine thinks
    // there's indexed data and attempts rule persistence.
    const { ModelStore } = await import('@system2-viewer/viewer-store');
    const tempStore = ModelStore.open(dataDir);
    const txn = tempStore.beginSnapshot('test-rev');
    txn.insertRevision({
      id: 'test-rev',
      repositoryId: 'repo::test',
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: new Date().toISOString(),
      historyBounded: 0,
    });
    txn.commit();
    tempStore.close();

    // Add a trigger that forces rule INSERT to fail. The table schema
    // is correct (so statement preparation succeeds), but the trigger
    // causes promoteRule() to throw at execution time.
    const dbPath = join(dataDir, 'model.sqlite');
    const corruptDb = new Database(dbPath);
    corruptDb.exec(`
      CREATE TRIGGER fail_rule_insert BEFORE INSERT ON rules
      BEGIN
        SELECT RAISE(ABORT, 'forced test failure');
      END
    `);
    corruptDb.close();

    // Create the engine -- rule persistence should fail but be captured as warning
    const engine = createViewerEngine({ dataDir });
    try {
      // The engine should still work (in-memory rules)
      const statusResult = engine.status();
      expect(statusResult).toBeDefined();
      const statusData = statusResult.data as unknown as Record<string, unknown>;
      expect(statusData['engineWarnings']).toBeDefined();
      expect(Array.isArray(statusData['engineWarnings'])).toBe(true);
      const warnings = statusData['engineWarnings'] as string[];
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to persist configured rules');

      // Doctor should also surface the warning
      const doctorResult = await engine.doctor();
      const doctorData = doctorResult.data as unknown as Record<string, unknown>;
      expect(doctorData['engineWarnings']).toBeDefined();
      const doctorWarnings = doctorData['engineWarnings'] as string[];
      expect(doctorWarnings.length).toBeGreaterThan(0);
      expect(doctorWarnings[0]).toContain('Failed to persist configured rules');
    } finally {
      engine.close();
    }
  });

  it('seeding custom claim types is idempotent', () => {
    const repoDir = makeTempDir();
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        claimTypes: [
          { id: 'custom-idempotent', displayTemplate: 'test' },
        ],
      }),
    );

    const dataDir = makeTempDir();
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: repoDir }),
    );

    // Create engine twice to verify idempotency
    const engine1 = createViewerEngine({ dataDir });
    engine1.close();

    const engine2 = createViewerEngine({ dataDir });
    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rows = db
          .prepare(
            "SELECT kind FROM kind_registry WHERE kind = 'custom-idempotent'",
          )
          .all() as Array<{ kind: string }>;

        expect(rows).toHaveLength(1);
      } finally {
        db.close();
      }
    } finally {
      engine2.close();
    }
  });
});
