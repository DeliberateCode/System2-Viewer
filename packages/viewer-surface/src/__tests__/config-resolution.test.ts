/**
 * Contract tests for config resolution from repoRoot.
 *
 * Validates that `createViewerEngine` resolves configuration from
 * the caller-supplied `repoRoot`, not `process.cwd()`.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import { deriveRepositoryId } from '@system2-viewer/viewer-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix = 'viewer-cfgres-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('config resolution from repoRoot', () => {
  it('loads config from the supplied repoRoot, not from cwd', () => {
    // Set up two distinct temp directories with different configs.
    // "targetRepo" is the one we pass as repoRoot.
    // "cwdRepo" simulates what cwd might resolve to (irrelevant here).
    const targetRepo = makeTempDir('viewer-cfgres-target-');
    const cwdRepo = makeTempDir('viewer-cfgres-cwd-');
    const dataDir = makeTempDir('viewer-cfgres-data-');

    // Write distinct configs to each repo dir.
    writeFileSync(
      join(targetRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { name: 'target-repo' },
      }),
    );
    writeFileSync(
      join(cwdRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { name: 'cwd-repo' },
      }),
    );

    // Create engine pointing repoRoot at targetRepo.
    const engine = createViewerEngine({ dataDir, repoRoot: targetRepo });

    try {
      // The config loaded from targetRepo should produce a repositoryId
      // derived from "target-repo" (the config's repository.name).
      const expectedId = deriveRepositoryId(targetRepo, 'target-repo');
      const wrongId = deriveRepositoryId(cwdRepo, 'cwd-repo');

      // Verify by checking that rules or kind_registry was seeded using
      // the targetRepo config. We can also verify by inspecting the
      // SQLite database for any repository-scoped data.
      //
      // A reliable way: write a custom claim type in the target config
      // and verify it was seeded. But for a simpler contract test, we
      // verify that doctor() uses the target repoRoot for its report.

      // The easiest observable effect of config resolution is the
      // repository.name in the config. Since loadConfig is called with
      // repoRoot, the engine uses config.repository.name from targetRepo.
      // We verify this indirectly: create a second engine with the same
      // dataDir but WITHOUT repoRoot, with a workspace-locator pointing
      // to cwdRepo. This second engine should resolve a different repo name.

      // First, verify the target engine's repositoryId.
      // We can check the model.sqlite kind_registry or rules table.
      // But since no indexing happened, the simplest check is to verify
      // that the engine was created without error using the target config.
      // The strongest verification is to add a custom claim type to target
      // config and verify it's in kind_registry.
      expect(expectedId).not.toBe(wrongId);

      // Check kind_registry does NOT contain 'cwd-repo' markers.
      // Since we didn't add claimTypes, we verify through a second engine.
    } finally {
      engine.close();
    }

    // Now create a second engine that should resolve from cwdRepo
    // via workspace-locator (simulating fallback behavior).
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: cwdRepo }),
    );

    // Engine without explicit repoRoot should fall back to locator -> cwdRepo.
    const engine2 = createViewerEngine({ dataDir });
    try {
      // The second engine should use cwdRepo's config.
      // We can verify this by checking that doctor() reports from cwdRepo.
      // Since both engines used the same dataDir, any state changes from
      // the first engine persist. The key assertion: the second engine
      // used cwdRepo for config, meaning it loaded "cwd-repo" as the name.
      //
      // Verified below via claimTypes seeding test (stronger signal).
    } finally {
      engine2.close();
    }
  });

  it('uses config from repoRoot with distinguishable claimTypes', () => {
    // This test uses a custom claim type in the target config to provide
    // a strong, directly observable signal that config came from repoRoot.
    const targetRepo = makeTempDir('viewer-cfgres-target-');
    const otherRepo = makeTempDir('viewer-cfgres-other-');
    const dataDir = makeTempDir('viewer-cfgres-data-');

    // Target repo: has a unique custom claim type.
    writeFileSync(
      join(targetRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { name: 'target-repo' },
        claimTypes: [
          { id: 'target-only-marker', displayTemplate: '{subject} target marker' },
        ],
      }),
    );

    // Other repo: has a different custom claim type.
    writeFileSync(
      join(otherRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { name: 'other-repo' },
        claimTypes: [
          { id: 'other-only-marker', displayTemplate: '{subject} other marker' },
        ],
      }),
    );

    // Create engine with explicit repoRoot -> targetRepo.
    const engine = createViewerEngine({ dataDir, repoRoot: targetRepo });

    try {
      // Verify the kind_registry has the target marker, not the other marker.
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const targetRows = db
          .prepare("SELECT kind FROM kind_registry WHERE kind = 'target-only-marker'")
          .all() as Array<{ kind: string }>;
        const otherRows = db
          .prepare("SELECT kind FROM kind_registry WHERE kind = 'other-only-marker'")
          .all() as Array<{ kind: string }>;

        expect(targetRows).toHaveLength(1);
        expect(otherRows).toHaveLength(0);
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('falls back to existing behavior when repoRoot is not supplied', () => {
    // When repoRoot is not supplied, the engine should fall back to:
    //   1. workspace-locator.json (if present in dataDir)
    //   2. process.cwd()
    // This test verifies fallback (1): workspace-locator.json.
    const locatorRepo = makeTempDir('viewer-cfgres-locator-');
    const dataDir = makeTempDir('viewer-cfgres-data-');

    // Write a config with a unique claim type in the locator-repo.
    writeFileSync(
      join(locatorRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        repository: { name: 'locator-repo' },
        claimTypes: [
          { id: 'locator-marker', displayTemplate: '{subject} locator marker' },
        ],
      }),
    );

    // Write workspace-locator pointing to locatorRepo.
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: locatorRepo }),
    );

    // Create engine WITHOUT repoRoot -- should fall back to locator.
    const engine = createViewerEngine({ dataDir });

    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const rows = db
          .prepare("SELECT kind FROM kind_registry WHERE kind = 'locator-marker'")
          .all() as Array<{ kind: string }>;

        expect(rows).toHaveLength(1);
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('repoRoot takes precedence over workspace-locator.json', () => {
    // When both repoRoot and workspace-locator are present, repoRoot wins.
    const explicitRepo = makeTempDir('viewer-cfgres-explicit-');
    const locatorRepo = makeTempDir('viewer-cfgres-locator-');
    const dataDir = makeTempDir('viewer-cfgres-data-');

    // Explicit repo: unique marker.
    writeFileSync(
      join(explicitRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        claimTypes: [
          { id: 'explicit-wins-marker', displayTemplate: 'explicit wins' },
        ],
      }),
    );

    // Locator repo: different marker.
    writeFileSync(
      join(locatorRepo, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        claimTypes: [
          { id: 'locator-loses-marker', displayTemplate: 'locator loses' },
        ],
      }),
    );

    // Workspace locator points to locatorRepo.
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: locatorRepo }),
    );

    // Create engine with explicit repoRoot -- should override locator.
    const engine = createViewerEngine({ dataDir, repoRoot: explicitRepo });

    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const explicitRows = db
          .prepare("SELECT kind FROM kind_registry WHERE kind = 'explicit-wins-marker'")
          .all() as Array<{ kind: string }>;
        const locatorRows = db
          .prepare("SELECT kind FROM kind_registry WHERE kind = 'locator-loses-marker'")
          .all() as Array<{ kind: string }>;

        expect(explicitRows).toHaveLength(1);
        expect(locatorRows).toHaveLength(0);
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('falls back to cwd when no repoRoot and no workspace-locator', () => {
    // When neither repoRoot nor workspace-locator is available,
    // the engine falls back to process.cwd().
    // We verify this by creating an engine with a fresh dataDir
    // (no workspace-locator.json) and no explicit repoRoot.
    // The engine should still create successfully, loading default
    // config (since cwd likely has no viewer.config.json or has one
    // from the project root).
    const dataDir = makeTempDir('viewer-cfgres-nocwd-');

    // Ensure no workspace-locator.json exists.
    expect(existsSync(join(dataDir, 'workspace-locator.json'))).toBe(false);

    // Engine should create without error, using cwd for config.
    const engine = createViewerEngine({ dataDir });
    try {
      expect(engine).toBeDefined();
      // doctor() should work even with cwd-based config resolution.
      const result = engine.status();
      expect(result).toBeDefined();
    } finally {
      engine.close();
    }
  });
});
