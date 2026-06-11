/**
 * Metadata scrubbing + path relativization validation tests.
 *
 *
 * These tests validate:
 * 1. AWS key in symbol metadataJson is scrubbed before persistence
 * 2. All stored paths are repo-relative (no leading /)
 * 3. Repository node metadata uses repoName (basename) not repoRoot
 * 4. FTS text entries use relative paths (no absolute filesystem paths)
 * 5. scrubSecrets is idempotent
 * 6. Structural fields (id, kind, path) in node rows are NOT scrubbed
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Indexer } from '../indexer.js';
import { scrubSecrets } from '../secret-scrub.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupGitRepo(repoDir: string): void {
  spawnSync('git', ['init'], { cwd: repoDir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
}

function commitAll(repoDir: string, message: string): void {
  spawnSync('git', ['add', '.'], { cwd: repoDir });
  spawnSync('git', ['commit', '-m', message], { cwd: repoDir });
}

// ---------------------------------------------------------------------------
// Metadata secret scrubbing
// ---------------------------------------------------------------------------

describe('Metadata secret scrubbing', () => {
  it('scrubs AWS key from symbol node metadataJson', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-sym-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-sym-data-'));

    try {
      setupGitRepo(repoDir);

      const awsKey = 'AKIAIOSFODNN7EXAMPLE';
      // Create a TS file with an AWS key embedded in a symbol name.
      // The symbol's metadataJson will contain the symbol name in its metadata.
      writeFileSync(
        join(repoDir, 'config.ts'),
        `export const CONFIG_${awsKey} = { region: 'us-east-1' };\n`,
      );

      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Verify: no metadataJson on symbol nodes contains the raw AWS key
      const symbolNodes = db
        .prepare(
          `SELECT id, metadata_json FROM nodes WHERE kind = 'symbol' AND metadata_json IS NOT NULL`,
        )
        .all() as Array<{ id: string; metadata_json: string }>;

      expect(symbolNodes.length).toBeGreaterThan(0);
      for (const row of symbolNodes) {
        expect(row.metadata_json).not.toContain(awsKey);
      }

      // Verify: no metadataJson on ANY node type contains the raw AWS key
      const allMetadata = db
        .prepare(
          `SELECT metadata_json FROM nodes WHERE metadata_json LIKE '%AKIA%'`,
        )
        .all() as Array<{ metadata_json: string }>;
      expect(allMetadata).toHaveLength(0);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs secrets from edge metadataJson fields', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-edge-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-edge-data-'));

    try {
      setupGitRepo(repoDir);

      const awsKey = 'AKIAIOSFODNN7EXAMPLE';
      writeFileSync(
        join(repoDir, 'auth.ts'),
        `export const KEY_${awsKey} = 'value';\n`,
      );

      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Verify: no edge metadataJson contains the raw AWS key
      const edgeMetadata = db
        .prepare(
          `SELECT metadata_json FROM edges WHERE metadata_json LIKE '%AKIA%'`,
        )
        .all() as Array<{ metadata_json: string }>;
      expect(edgeMetadata).toHaveLength(0);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('structural fields (id, kind, path) on node rows are NOT scrubbed', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-struct-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-struct-data-'));

    try {
      setupGitRepo(repoDir);

      writeFileSync(
        join(repoDir, 'index.ts'),
        `export function hello() { return 'world'; }\n`,
      );

      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Verify: structural fields are intact (not '[REDACTED...]')
      const fileNodes = db
        .prepare(`SELECT id, kind, path, display_name FROM nodes WHERE kind = 'file'`)
        .all() as Array<{ id: string; kind: string; path: string; display_name: string }>;

      expect(fileNodes.length).toBeGreaterThan(0);
      for (const node of fileNodes) {
        expect(node.id).not.toContain('[REDACTED');
        expect(node.kind).toBe('file');
        expect(node.path).not.toContain('[REDACTED');
        expect(node.display_name).not.toContain('[REDACTED');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// scrubSecrets idempotency
// ---------------------------------------------------------------------------

describe('scrubSecrets idempotency', () => {
  it('scrubSecrets(scrubSecrets(input).scrubbed).scrubbed === scrubSecrets(input).scrubbed', () => {
    // idempotency constraint
    const inputs = [
      'key=AKIAIOSFODNN7EXAMPLE',
      'SLACK_TOKEN=xoxb-123456789012-abcdef',
      `cert:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ\n-----END RSA PRIVATE KEY-----\nend`,
      'normal text with no secrets',
      '',
    ];

    for (const input of inputs) {
      const firstPass = scrubSecrets(input);
      const secondPass = scrubSecrets(firstPass.scrubbed);
      expect(secondPass.scrubbed).toBe(firstPass.scrubbed);
    }
  });
});

// ---------------------------------------------------------------------------
// Path relativization
// ---------------------------------------------------------------------------

describe('Path relativization validation', () => {
  it('repository node stores repoName (not repoRoot) in metadataJson', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-reponame-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-reponame-data-'));

    try {
      setupGitRepo(repoDir);

      writeFileSync(join(repoDir, 'index.ts'), `export const x = 1;\n`);
      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // repoRoot must NOT be in metadata
      const repoRootVal = db
        .prepare(
          `SELECT json_extract(metadata_json, '$.repoRoot') as val FROM nodes WHERE kind = 'repository'`,
        )
        .get() as { val: unknown } | undefined;
      expect(repoRootVal?.val).toBeNull();

      // repoName must be present and equal the basename only
      const repoNameVal = db
        .prepare(
          `SELECT json_extract(metadata_json, '$.repoName') as val FROM nodes WHERE kind = 'repository'`,
        )
        .get() as { val: string } | undefined;
      expect(repoNameVal).toBeDefined();
      expect(repoNameVal!.val).toBe(basename(repoDir));

      // The absolute path of repoDir must not appear anywhere in the metadata
      const leakCheck = db
        .prepare(
          `SELECT metadata_json FROM nodes WHERE metadata_json LIKE ?`,
        )
        .all(`%${repoDir}%`) as Array<{ metadata_json: string }>;
      expect(leakCheck).toHaveLength(0);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('all stored node paths are repo-relative (no leading /)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-relpaths-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-relpaths-data-'));

    try {
      setupGitRepo(repoDir);

      mkdirSync(join(repoDir, 'src', 'utils'), { recursive: true });
      writeFileSync(join(repoDir, 'index.ts'), `export { main } from './src/main';\n`);
      writeFileSync(join(repoDir, 'src', 'main.ts'), `export function main() {}\n`);
      writeFileSync(join(repoDir, 'src', 'utils', 'helper.ts'), `export const x = 1;\n`);

      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // All node paths must be relative (no leading /)
      const allNodes = db
        .prepare(`SELECT id, path FROM nodes WHERE path IS NOT NULL`)
        .all() as Array<{ id: string; path: string }>;

      expect(allNodes.length).toBeGreaterThan(0);
      for (const node of allNodes) {
        expect(node.path.startsWith('/')).toBe(false);
        expect(node.path).not.toContain(repoDir);
      }

      // Also check edge paths if they have paths
      const allEdges = db
        .prepare(`SELECT id, metadata_json FROM edges WHERE metadata_json IS NOT NULL`)
        .all() as Array<{ id: string; metadata_json: string }>;

      for (const edge of allEdges) {
        expect(edge.metadata_json).not.toContain(repoDir);
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('FTS text entries use relative paths (no absolute filesystem paths)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'sec-val-fts-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'sec-val-fts-data-'));

    try {
      setupGitRepo(repoDir);

      mkdirSync(join(repoDir, 'src'), { recursive: true });
      writeFileSync(join(repoDir, 'src', 'app.ts'), `export function start() {}\n`);
      writeFileSync(join(repoDir, 'index.ts'), `export { start } from './src/app';\n`);

      commitAll(repoDir, 'initial');

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // All FTS text entries must not contain the absolute repoDir path
      const ftsRows = db
        .prepare(`SELECT text, path FROM fts_text`)
        .all() as Array<{ text: string; path: string | null }>;

      expect(ftsRows.length).toBeGreaterThan(0);
      for (const row of ftsRows) {
        expect(row.text).not.toContain(repoDir);
        if (row.path !== null) {
          expect(row.path.startsWith('/')).toBe(false);
          expect(row.path).not.toContain(repoDir);
        }
      }

      // FTS path column for file entries should contain relative paths
      const fileFtsRows = db
        .prepare(`SELECT path FROM fts_text WHERE object_type = 'file'`)
        .all() as Array<{ path: string }>;

      for (const row of fileFtsRows) {
        expect(row.path.startsWith('/')).toBe(false);
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
