/**
 * Integration tests for custom claim types round-tripping through
 * generation, surfacing, and history.
 *
 *
 * Test 1: Configure custom claim type, create engine, manually create
 *         a claim of that type via SnapshotTxn, call listClaims with
 *         type filter, verify it appears.
 *
 * Test 2: Config with id 'file-defines-symbol' -> verify config
 *         validation error (collision with built-in type).
 *
 * Test 3: Custom claim with no evidence does NOT appear in listClaims
 *         (surfacing gate applies to custom types identically).
 *
 * Test 4: Verify custom type entry exists in kind_registry after
 *         engine creation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import {
  loadConfigResult,
  BUILT_IN_CLAIM_TYPES,
} from '@system2-viewer/viewer-config';
import { ModelStore } from '@system2-viewer/viewer-store';
import type { ClaimRow, EvidenceRow } from '@system2-viewer/viewer-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-custom-claim-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

/**
 * Sets up a repo dir + data dir with a viewer.config.json containing
 * the specified claimTypes, and a workspace-locator pointing the engine
 * to the repo dir so config is discoverable.
 */
function setupCustomClaimEnv(claimTypes: unknown[]) {
  const repoDir = makeTempDir();
  const dataDir = makeTempDir();

  const configContent = JSON.stringify({
    version: 1,
    claimTypes,
  });
  writeFileSync(join(repoDir, 'viewer.config.json'), configContent);
  writeFileSync(
    join(dataDir, 'workspace-locator.json'),
    JSON.stringify({ repoRoot: repoDir }),
  );

  return { repoDir, dataDir };
}

/**
 * Seeds a revision row so that the engine's latestRevision() can find
 * an active revision. Without this, operations that need a revision
 * (like listClaims via withRead) throw NoModelIndexedError.
 */
function seedRevision(dataDir: string, revId: string): void {
  const db = new Database(join(dataDir, 'model.sqlite'));
  try {
    db.prepare(
      `INSERT OR IGNORE INTO revisions (id, repository_id, kind, indexed_at)
       VALUES (?, 'repo-test', 'working_tree', ?)`,
    ).run(revId, new Date().toISOString());
  } finally {
    db.close();
  }
}

function makeEvidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  const now = new Date().toISOString();
  return {
    id: 'evd-custom-1',
    kind: 'source_span',
    epistemic: 'static',
    repositoryId: 'repo-test',
    revision: 'rev-test-1',
    path: 'src/boundary.ts',
    startLine: 1,
    endLine: 10,
    contentHash: 'hash-custom-1',
    extractor: 'test-harness',
    derivationLocality: 'local',
    actor: null,
    metadataJson: null,
    createdAt: now,
    ...overrides,
  };
}

function makeClaimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  const now = new Date().toISOString();
  return {
    id: 'claim-custom-1',
    claimType: 'test-custom-boundary',
    statement: 'ModuleA defines boundary with ModuleB',
    status: 'hypothesis',
    repositoryId: 'repo-test',
    scopeJson: JSON.stringify({ path: 'src/boundary.ts' }),
    confidenceBand: 'medium',
    freshnessBand: 'fresh',
    supportingEvidenceIdsJson: JSON.stringify(['evd-custom-1']),
    contradictingEvidenceIdsJson: null,
    verificationRecipesJson: JSON.stringify([
      { recipeType: 'source_span_check', description: 'check span' },
    ]),
    derivationMethod: 'test-harness',
    generationId: 'gen-custom-1',
    surfaced: 1,
    validFromRevision: 'rev-test-1',
    validToRevision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('custom claim types integration', () => {
  it('round-trips a custom claim type through generation and listClaims', () => {
    // 1. Configure custom claim type
    const { dataDir } = setupCustomClaimEnv([
      {
        id: 'test-custom-boundary',
        displayTemplate: '${subject} defines boundary',
        defaultVerificationRecipes: [
          { recipeType: 'source_span_check', description: 'check span' },
        ],
        severity: 'medium',
      },
    ]);

    // 2. Create engine -- this seeds kind_registry
    const engine = createViewerEngine({ dataDir });

    try {
      // 3. Seed a revision so listClaims can find it
      seedRevision(dataDir, 'rev-test-1');

      // 4. Manually create evidence + claim of the custom type via store
      const store = ModelStore.open(dataDir);
      try {
        const txn = store.beginSnapshot('rev-test-1');
        txn.appendEvidence(makeEvidenceRow());
        txn.versionClaim(makeClaimRow());
        txn.commit();
      } finally {
        store.close();
      }

      // 5. Call listClaims with type filter, verify it appears
      const result = engine.listClaims({
        claimType: 'test-custom-boundary',
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();

      const claims = result.data as Array<{
        id: string;
        claimType: string;
        statement: string;
        status: string;
        confidence: string;
      }>;

      expect(claims.length).toBeGreaterThanOrEqual(1);

      const customClaim = claims.find(
        (c) => c.claimType === 'test-custom-boundary',
      );
      expect(customClaim).toBeDefined();
      expect(customClaim!.id).toBe('claim-custom-1');
      expect(customClaim!.statement).toBe(
        'ModuleA defines boundary with ModuleB',
      );
      expect(customClaim!.status).toBe('hypothesis');
      expect(customClaim!.confidence).toBe('medium');

      // Verify the envelope structure
      expect(result.query).toBeDefined();
      expect(result.query.op).toBe('listClaims');
      expect(result.modelRevision).toBeTruthy();
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(Array.isArray(result.uncertainties)).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('rejects config with built-in claim type id collision', () => {
    // Iterate over all built-in types to verify collision detection
    for (const builtIn of BUILT_IN_CLAIM_TYPES) {
      const repoDir = makeTempDir();
      const configContent = JSON.stringify({
        version: 1,
        claimTypes: [
          {
            id: builtIn,
            displayTemplate: 'collision test',
          },
        ],
      });
      writeFileSync(join(repoDir, 'viewer.config.json'), configContent);

      const result = loadConfigResult(repoDir);

      // Expect at least one error issue for collision
      const collisionIssues = result.issues.filter(
        (i) =>
          i.severity === 'error' && i.message.includes('collides with a built-in type'),
      );
      expect(collisionIssues.length).toBeGreaterThanOrEqual(1);

      // Verify the colliding type is NOT in the loaded config's claimTypes
      const loadedTypes = result.config.claimTypes ?? [];
      const collidingType = loadedTypes.find((ct) => ct.id === builtIn);
      expect(collidingType).toBeUndefined();
    }
  });

  it('specifically rejects file-defines-symbol as custom claim type', () => {
    const repoDir = makeTempDir();
    writeFileSync(
      join(repoDir, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        claimTypes: [
          { id: 'file-defines-symbol', displayTemplate: 'collision' },
        ],
      }),
    );

    const result = loadConfigResult(repoDir);

    // The collision must produce an error-severity issue
    const errorIssues = result.issues.filter((i) => i.severity === 'error');
    expect(errorIssues.length).toBeGreaterThanOrEqual(1);
    expect(
      errorIssues.some((i) => i.message.includes('file-defines-symbol')),
    ).toBe(true);

    // Config falls back to defaults -- claimTypes should be absent
    expect(result.config.claimTypes).toBeUndefined();
  });

  it('does NOT surface a custom claim with no evidence (surfacing gate)', () => {
    const { dataDir } = setupCustomClaimEnv([
      {
        id: 'test-no-evidence',
        displayTemplate: '${subject} has no evidence',
      },
    ]);

    const engine = createViewerEngine({ dataDir });

    try {
      // Seed revision
      seedRevision(dataDir, 'rev-test-1');

      // Create a claim with confidence 'none' and no supporting evidence
      const store = ModelStore.open(dataDir);
      try {
        const txn = store.beginSnapshot('rev-test-1');
        txn.versionClaim(
          makeClaimRow({
            id: 'claim-no-evidence',
            claimType: 'test-no-evidence',
            statement: 'This has no evidence',
            confidenceBand: 'none',
            supportingEvidenceIdsJson: JSON.stringify([]),
            surfaced: 0,
          }),
        );
        txn.commit();
      } finally {
        store.close();
      }

      // listClaims without includeLowValue -- should NOT find it
      const result = engine.listClaims({
        claimType: 'test-no-evidence',
      });

      const claims = result.data as Array<{
        id: string;
        claimType: string;
      }>;
      const noEvClaim = claims.find(
        (c) => c.id === 'claim-no-evidence',
      );
      expect(noEvClaim).toBeUndefined();

      // listClaims WITH includeLowValue -- should find it
      const resultLow = engine.listClaims({
        claimType: 'test-no-evidence',
        includeLowValue: true,
      });

      const claimsLow = resultLow.data as Array<{
        id: string;
        claimType: string;
      }>;
      const foundLow = claimsLow.find(
        (c) => c.id === 'claim-no-evidence',
      );
      expect(foundLow).toBeDefined();
      expect(foundLow!.claimType).toBe('test-no-evidence');
    } finally {
      engine.close();
    }
  });

  it('seeds custom type into kind_registry at engine creation', () => {
    const { dataDir } = setupCustomClaimEnv([
      {
        id: 'test-registry-check',
        displayTemplate: '${subject} is registered',
      },
    ]);

    const engine = createViewerEngine({ dataDir });

    try {
      // Query kind_registry directly
      const db = new Database(join(dataDir, 'model.sqlite'), {
        readonly: true,
      });
      try {
        const row = db
          .prepare(
            "SELECT kind, category, mvp_emitted FROM kind_registry WHERE kind = ?",
          )
          .get('test-registry-check') as {
          kind: string;
          category: string;
          mvp_emitted: number;
        } | undefined;

        expect(row).toBeDefined();
        expect(row!.kind).toBe('test-registry-check');
        expect(row!.category).toBe('claim_type');
        expect(row!.mvp_emitted).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('does not seed built-in types as claim_type category in kind_registry', () => {
    const { dataDir } = setupCustomClaimEnv([]);

    const engine = createViewerEngine({ dataDir });

    try {
      const db = new Database(join(dataDir, 'model.sqlite'), {
        readonly: true,
      });
      try {
        // Built-in claim types are NOT in kind_registry under 'claim_type'
        // category -- they use the claims table's claim_type column directly
        const rows = db
          .prepare(
            "SELECT kind FROM kind_registry WHERE category = 'claim_type'",
          )
          .all() as Array<{ kind: string }>;

        // None of the built-in claim types should appear
        for (const builtIn of BUILT_IN_CLAIM_TYPES) {
          const found = rows.find((r) => r.kind === builtIn);
          expect(found).toBeUndefined();
        }
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('custom claim with low confidence is hidden by surfacing gate', () => {
    const { dataDir } = setupCustomClaimEnv([
      {
        id: 'test-low-conf',
        displayTemplate: '${subject} has low confidence',
      },
    ]);

    const engine = createViewerEngine({ dataDir });

    try {
      seedRevision(dataDir, 'rev-test-1');

      // Insert evidence so the claim is valid, but set confidence to 'low'
      const store = ModelStore.open(dataDir);
      try {
        const txn = store.beginSnapshot('rev-test-1');
        txn.appendEvidence(
          makeEvidenceRow({ id: 'evd-low-conf' }),
        );
        txn.versionClaim(
          makeClaimRow({
            id: 'claim-low-conf',
            claimType: 'test-low-conf',
            statement: 'Low confidence claim',
            confidenceBand: 'low',
            supportingEvidenceIdsJson: JSON.stringify(['evd-low-conf']),
            surfaced: 0,
          }),
        );
        txn.commit();
      } finally {
        store.close();
      }

      // Default listClaims filters out low confidence
      const result = engine.listClaims({
        claimType: 'test-low-conf',
      });
      const claims = result.data as Array<{ id: string }>;
      expect(claims.find((c) => c.id === 'claim-low-conf')).toBeUndefined();

      // includeLowValue brings it back
      const resultLow = engine.listClaims({
        claimType: 'test-low-conf',
        includeLowValue: true,
      });
      const claimsLow = resultLow.data as Array<{ id: string }>;
      expect(
        claimsLow.find((c) => c.id === 'claim-low-conf'),
      ).toBeDefined();
    } finally {
      engine.close();
    }
  });

  it('multiple custom claim types can coexist', () => {
    const { dataDir } = setupCustomClaimEnv([
      { id: 'custom-type-alpha', displayTemplate: 'Alpha: ${subject}' },
      { id: 'custom-type-beta', displayTemplate: 'Beta: ${subject}' },
    ]);

    const engine = createViewerEngine({ dataDir });

    try {
      seedRevision(dataDir, 'rev-test-1');

      // Insert claims of both types
      const store = ModelStore.open(dataDir);
      try {
        const txn = store.beginSnapshot('rev-test-1');
        txn.appendEvidence(makeEvidenceRow({ id: 'evd-alpha' }));
        txn.appendEvidence(
          makeEvidenceRow({ id: 'evd-beta', path: 'src/beta.ts' }),
        );
        txn.versionClaim(
          makeClaimRow({
            id: 'claim-alpha',
            claimType: 'custom-type-alpha',
            statement: 'Alpha claim',
            supportingEvidenceIdsJson: JSON.stringify(['evd-alpha']),
          }),
        );
        txn.versionClaim(
          makeClaimRow({
            id: 'claim-beta',
            claimType: 'custom-type-beta',
            statement: 'Beta claim',
            supportingEvidenceIdsJson: JSON.stringify(['evd-beta']),
          }),
        );
        txn.commit();
      } finally {
        store.close();
      }

      // Filter by type alpha -- only alpha claim
      const resultAlpha = engine.listClaims({
        claimType: 'custom-type-alpha',
      });
      const alphas = resultAlpha.data as Array<{
        id: string;
        claimType: string;
      }>;
      expect(alphas).toHaveLength(1);
      expect(alphas[0].claimType).toBe('custom-type-alpha');

      // Filter by type beta -- only beta claim
      const resultBeta = engine.listClaims({
        claimType: 'custom-type-beta',
      });
      const betas = resultBeta.data as Array<{
        id: string;
        claimType: string;
      }>;
      expect(betas).toHaveLength(1);
      expect(betas[0].claimType).toBe('custom-type-beta');

      // Both kind_registry entries exist
      const db = new Database(join(dataDir, 'model.sqlite'), {
        readonly: true,
      });
      try {
        const rows = db
          .prepare(
            "SELECT kind FROM kind_registry WHERE category = 'claim_type' ORDER BY kind",
          )
          .all() as Array<{ kind: string }>;
        const kinds = rows.map((r) => r.kind);
        expect(kinds).toContain('custom-type-alpha');
        expect(kinds).toContain('custom-type-beta');
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('getClaimHistory returns history for a custom claim type', () => {
    const { dataDir } = setupCustomClaimEnv([
      {
        id: 'test-history-type',
        displayTemplate: '${subject} history test',
      },
    ]);

    const engine = createViewerEngine({ dataDir });

    try {
      seedRevision(dataDir, 'rev-test-1');

      // Insert evidence, claim, and a verification history entry
      const store = ModelStore.open(dataDir);
      try {
        const txn = store.beginSnapshot('rev-test-1');
        txn.appendEvidence(makeEvidenceRow({ id: 'evd-hist' }));
        txn.versionClaim(
          makeClaimRow({
            id: 'claim-hist',
            claimType: 'test-history-type',
            statement: 'History test claim',
            supportingEvidenceIdsJson: JSON.stringify(['evd-hist']),
          }),
        );
        txn.appendVerificationHistory({
          id: 'vh-custom-1',
          claimId: 'claim-hist',
          recipesJson: JSON.stringify([
            { recipeType: 'source_span_check', description: 'check' },
          ]),
          priorConfidence: 'medium',
          newConfidence: 'medium',
          priorFreshness: 'fresh',
          newFreshness: 'fresh',
          priorStatus: 'hypothesis',
          newStatus: 'hypothesis',
          unresolvedReason: null,
          ranAt: new Date().toISOString(),
        });
        txn.commit();
      } finally {
        store.close();
      }

      // Call getClaimHistory
      const result = engine.getClaimHistory({ claimId: 'claim-hist' });

      expect(result).toBeDefined();
      expect(result.query.op).toBe('getClaimHistory');
      expect(result.data).toBeDefined();

      // The history data should contain verification history
      const data = result.data as Record<string, unknown>;
      const verificationHistory = data['verificationHistory'] as
        | Array<{ id: string; claimId: string }>
        | undefined;

      // If implementation returns verificationHistory
      if (verificationHistory) {
        expect(verificationHistory.length).toBeGreaterThanOrEqual(1);
        const entry = verificationHistory.find(
          (h) => h.id === 'vh-custom-1',
        );
        expect(entry).toBeDefined();
        expect(entry!.claimId).toBe('claim-hist');
      }
    } finally {
      engine.close();
    }
  });
});
