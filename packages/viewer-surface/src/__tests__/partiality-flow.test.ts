/**
 * Contract test for partiality end-to-end flow.
 *
 * Validates that partiality data flows from the indexer through the partiality
 * table to retrieval operations, spanning three packages:
 *   - viewer-indexer (writes partiality via txn.upsertPartiality)
 *   - viewer-store (ReadHandle.partiality reads from partiality table)
 *   - viewer-retrieval (getRepositoryOverview includes partiality in envelope)
 *
 *
 * Test classification:
 *   1. partiality table populated after indexing with unsupported language (missing coverage)
 *   2. handle.partiality(revision) returns non-empty array (missing coverage)
 *   3. getRepositoryOverview envelope includes partiality data (missing coverage)
 *   4. listUncertainties includes partiality-derived uncertainty items (missing coverage)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import type { ViewerEngine } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix = 'viewer-partiality-test-'): string {
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

/**
 * Creates a temp fixture repository containing:
 *   - main.ts (supported language, will be fully indexed)
 *   - script.rb (unsupported language, triggers partiality)
 *
 * Returns the repo directory path.
 */
function createFixtureRepo(): string {
  const repoDir = makeTempDir('viewer-partiality-fixture-');

  // Supported file: TypeScript
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(
    join(repoDir, 'src', 'main.ts'),
    `export function hello(): string {\n  return 'hello';\n}\n`,
  );

  // Unsupported file: Ruby (no grammar available -- triggers partiality)
  writeFileSync(
    join(repoDir, 'script.rb'),
    `def greet(name)\n  puts "Hello, #{name}"\nend\n`,
  );

  return repoDir;
}

/**
 * Query the raw partiality table rows from the model database.
 */
function queryPartialityTable(
  dataDir: string,
  revision: string,
): Array<{
  id: string;
  revision: string;
  scope: string;
  extracted_json: string | null;
  failed_json: string | null;
  skipped_json: string | null;
}> {
  const dbPath = join(dataDir, 'model.sqlite');
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT id, revision, scope, extracted_json, failed_json, skipped_json
         FROM partiality
         WHERE revision = ?`,
      )
      .all(revision) as Array<{
      id: string;
      revision: string;
      scope: string;
      extracted_json: string | null;
      failed_json: string | null;
      skipped_json: string | null;
    }>;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Partiality end-to-end flow', () => {
  it('populates partiality table after indexing with unsupported language file', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir('viewer-partiality-data-');

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      const { revision } = await engine.indexer.index({ repoRoot: repoDir });

      // Query partiality table directly via SQLite
      const rows = queryPartialityTable(dataDir, revision);

      // At least one partiality row should exist for the unsupported language
      // (script.rb with language=unknown triggers partiality in extractSymbols)
      expect(rows.length).toBeGreaterThanOrEqual(1);

      // Find the row for the Ruby file
      const rbRow = rows.find((r) => r.scope === 'script.rb');
      expect(rbRow, 'Partiality row for script.rb should exist').toBeDefined();

      // Verify the partiality row has correct structure
      expect(rbRow!.revision).toBe(revision);
      expect(rbRow!.id).toContain('partiality::');

      // script.rb should have extracted_json (file-node was extracted)
      // and skipped_json (symbol-extraction was skipped)
      if (rbRow!.extracted_json) {
        const extracted = JSON.parse(rbRow!.extracted_json) as string[];
        expect(extracted).toContain('file-node');
      }
      if (rbRow!.skipped_json) {
        const skipped = JSON.parse(rbRow!.skipped_json) as string[];
        expect(skipped).toContain('symbol-extraction');
      }
    } finally {
      engine.close();
    }
  });

  it('ReadHandle.partiality(revision) returns non-empty array after indexing', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir('viewer-partiality-data-');

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      const { revision } = await engine.indexer.index({ repoRoot: repoDir });

      // Open a ReadHandle via the store to call partiality(revision)
      const { ModelStore } = await import('@system2-viewer/viewer-store');
      const store = ModelStore.open(dataDir);
      try {
        const rh = store.read(revision);
        try {
          const partialityRows = rh.partiality(revision);

          // Should return a non-empty array
          expect(partialityRows.length).toBeGreaterThanOrEqual(1);

          // At least one entry should be for the unsupported language scope
          const rbEntry = partialityRows.find((p) => p.scope === 'script.rb');
          expect(
            rbEntry,
            'Partiality entry for script.rb should exist',
          ).toBeDefined();

          // Verify the PartialityRow shape
          expect(rbEntry!.id).toContain('partiality::');
          expect(rbEntry!.revision).toBe(revision);
          expect(rbEntry!.scope).toBe('script.rb');
        } finally {
          rh.close();
        }
      } finally {
        store.close();
      }
    } finally {
      engine.close();
    }
  });

  it('getRepositoryOverview envelope includes partiality data', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir('viewer-partiality-data-');

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      const { revision } = await engine.indexer.index({ repoRoot: repoDir });

      // Call getRepositoryOverview -- should include partiality in envelope
      const envelope = engine.getRepositoryOverview({ revision });

      // The envelope should have partiality data since we indexed an
      // unsupported language file (script.rb)
      expect(envelope).toBeDefined();
      expect(envelope.partiality).toBeDefined();
      expect(envelope.partiality).not.toBeNull();

      // Verify the partiality summary ref structure
      const partiality = envelope.partiality!;
      expect(partiality.ref).toBe('partiality');
      expect(partiality.scopes).toBeDefined();
      expect(Array.isArray(partiality.scopes)).toBe(true);
      expect(partiality.scopes.length).toBeGreaterThanOrEqual(1);

      // At least one scope should relate to the unsupported language
      const rbScope = partiality.scopes.find((s) =>
        s.scope === 'script.rb',
      );
      expect(
        rbScope,
        'Partiality scope for script.rb should be in overview envelope',
      ).toBeDefined();
    } finally {
      engine.close();
    }
  });

  // FIXED: listUncertainties now accepts opts.revision and the engine passes
  // the resolved revision through. handle.partiality(actualRevision) returns rows.
  // partiality should be surfaced in uncertainty lists.
  it('listUncertainties includes partiality-derived uncertainty items', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir('viewer-partiality-data-');

    const engine: ViewerEngine = createViewerEngine({
      dataDir,
      repoRoot: repoDir,
    });

    try {
      const { revision } = await engine.indexer.index({ repoRoot: repoDir });

      // Call listUncertainties -- should include partiality-derived items.
      // After the production fix, this should work because partiality rows
      // exist in the table and handle.partiality(actualRevision) returns them.
      const envelope = engine.listUncertainties({});
      expect(envelope).toBeDefined();

      const items = envelope.data as Array<{
        id: string;
        kind: string;
        severity: string;
        description: string;
      }>;
      expect(Array.isArray(items)).toBe(true);

      // Look for partiality-derived uncertainty items.
      // The production code generates:
      //   - unc:partiality:<row.id> for entries with failedJson
      //   - unc:skipped:<row.id> for entries with skippedJson
      // Since script.rb triggers symbol-extraction skipping (not failure),
      // we check for unc:skipped: prefixed items.
      const partialityItems = items.filter(
        (item) =>
          item.id.startsWith('unc:partiality:') ||
          item.id.startsWith('unc:skipped:'),
      );

      // partiality should be surfaced in uncertainty lists.
      expect(
        partialityItems.length,
        'At least one partiality-derived uncertainty item should exist.',
      ).toBeGreaterThanOrEqual(1);
    } finally {
      engine.close();
    }
  });
});
