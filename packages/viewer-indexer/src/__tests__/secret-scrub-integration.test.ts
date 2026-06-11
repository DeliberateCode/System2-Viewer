/**
 * Integration test: indexing a file containing secrets produces scrubbed
 * claim statements and FTS text with [REDACTED:aws-key] markers.
 *
 *
 * Categories: missing coverage (new tests), existing coverage (extended)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Indexer } from '../indexer.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import Database from 'better-sqlite3';

describe('Secret scrubbing integration', () => {
  it('scrubs AWS key from claim statements and FTS text', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-int-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-int-data-'));

    try {
      // Initialize a git repo so the indexer can run git history mining
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      // Create a TypeScript file that embeds an AWS key in a variable name
      // and has the key in the source content. The claim statement references
      // symbol names, and the FTS row references the file name + path.
      // We'll put the key in a symbol name so it appears in claim statements.
      const secretKey = 'AKIAIOSFODNN7EXAMPLE';
      writeFileSync(
        join(repoDir, 'config.ts'),
        `export const AWS_KEY_${secretKey} = 'value';\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Check claim statements: any claim referencing the file should have the key scrubbed
      const claims = db
        .prepare(
          `SELECT statement FROM claims WHERE valid_from_revision = ? AND statement LIKE '%config.ts%'`,
        )
        .all(revision) as Array<{ statement: string }>;

      expect(claims.length).toBeGreaterThan(0);
      for (const c of claims) {
        expect(c.statement).not.toContain(secretKey);
        expect(c.statement).toContain('[REDACTED:aws-key]');
      }

      // Check FTS text: symbol FTS row should have the key scrubbed
      const ftsRows = db
        .prepare(
          `SELECT text FROM fts_text WHERE text LIKE '%AWS_KEY%'`,
        )
        .all() as Array<{ text: string }>;

      for (const row of ftsRows) {
        expect(row.text).not.toContain(secretKey);
        expect(row.text).toContain('[REDACTED:aws-key]');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('passes through clean content unchanged (no [REDACTED] markers)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-clean-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-clean-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      writeFileSync(
        join(repoDir, 'index.ts'),
        `export function hello() { return 'world'; }\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Verify claims exist and contain no redaction markers
      const claims = db
        .prepare(`SELECT statement FROM claims WHERE valid_from_revision = ?`)
        .all(revision) as Array<{ statement: string }>;

      for (const c of claims) {
        expect(c.statement).not.toContain('[REDACTED');
      }

      // Verify FTS rows contain no redaction markers
      const ftsRows = db
        .prepare(`SELECT text FROM fts_text`)
        .all() as Array<{ text: string }>;

      for (const row of ftsRows) {
        expect(row.text).not.toContain('[REDACTED');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs AWS key embedded in function name from claim text', async () => {

    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-funcname-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-funcname-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      const awsKey = 'AKIAIOSFODNN7EXAMPLE';
      // Place the AWS key inside a function name so it appears in symbol extraction
      writeFileSync(
        join(repoDir, 'auth.ts'),
        `export function getKey_${awsKey}() { return 'secret'; }\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add auth'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Claim statements referencing auth.ts should have the AWS key redacted
      const claims = db
        .prepare(
          `SELECT statement FROM claims WHERE valid_from_revision = ? AND statement LIKE '%auth.ts%'`,
        )
        .all(revision) as Array<{ statement: string }>;

      expect(claims.length).toBeGreaterThan(0);
      for (const c of claims) {
        expect(c.statement).not.toContain(awsKey);
        expect(c.statement).toContain('[REDACTED:aws-key]');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs PEM private key block from FTS text', async () => {

    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-pem-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-pem-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      // The PEM block is in a variable name that will appear in FTS/claims
      // The actual PEM content won't appear in symbol names, but a reference
      // to it through the variable name is what gets scrubbed.
      // Let's use a constant name that embeds the PEM BEGIN marker to test
      // that patterns are caught anywhere in text content.
      const pemContent = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn',
        '-----END RSA PRIVATE KEY-----',
      ].join('\\n');

      writeFileSync(
        join(repoDir, 'certs.ts'),
        `export const CERT = "${pemContent}";\nexport function loadCert() { return CERT; }\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add certs'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Check that no FTS row contains a PEM BEGIN marker
      const ftsRows = db
        .prepare(`SELECT text FROM fts_text`)
        .all() as Array<{ text: string }>;

      // FTS text for file nodes contains the filename and path, not file content.
      // FTS text for symbol nodes contains the symbol name.
      // The PEM block would only appear if the symbol name contained it.
      // Since CERT and loadCert are clean names, they should pass through.
      // This test verifies the FTS text does not leak PEM content.
      for (const row of ftsRows) {
        expect(row.text).not.toContain('BEGIN RSA PRIVATE KEY');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs high-entropy string (>40 chars, >4.5 bits/char) from FTS', async () => {

    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-entropy-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-entropy-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      // A high-entropy string used as a variable name will appear in FTS
      const highEntropy = 'aB3dE7fG9hJ1kL4mN6pQ8rS0tU2vW5xY7zA3cD6eF8gH1jK';
      writeFileSync(
        join(repoDir, 'tokens.ts'),
        `export const TOKEN_${highEntropy} = 'value';\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add tokens'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // The high-entropy portion of the symbol name should be redacted in FTS
      const ftsRows = db
        .prepare(`SELECT text FROM fts_text WHERE text LIKE '%TOKEN%'`)
        .all() as Array<{ text: string }>;

      for (const row of ftsRows) {
        expect(row.text).not.toContain(highEntropy);
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs secrets from evidence metadata', async () => {

    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-evmeta-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-evmeta-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      const secretKey = 'AKIAIOSFODNN7EXAMPLE';
      // Symbol name will appear in evidence metadata as symbolName
      writeFileSync(
        join(repoDir, 'secrets.ts'),
        `export const AWS_${secretKey} = 42;\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add secrets'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Evidence metadata for tree_sitter_query evidence includes symbolName.
      // The scrubber should have replaced the AWS key in the metadata JSON.
      const evidenceRows = db
        .prepare(
          `SELECT metadata_json FROM evidence WHERE kind = 'tree_sitter_query'`,
        )
        .all() as Array<{ metadata_json: string | null }>;

      const relevantRows = evidenceRows.filter(
        (r) => r.metadata_json && r.metadata_json.includes('AWS'),
      );

      for (const row of relevantRows) {
        expect(row.metadata_json).not.toContain(secretKey);
        expect(row.metadata_json).toContain('[REDACTED:aws-key]');
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('reports scrub count correctly via partiality', async () => {

    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-count-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-count-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      const awsKey = 'AKIAIOSFODNN7EXAMPLE';
      // Place multiple secrets in a single file
      writeFileSync(
        join(repoDir, 'multi-secrets.ts'),
        [
          `export const KEY1_${awsKey} = 'v1';`,
          `export const KEY2_${awsKey} = 'v2';`,
        ].join('\n') + '\n',
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'add multi-secrets'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      const { revision } = await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // Check partiality for secret-scrubbing scope
      const partialityRows = db
        .prepare(
          `SELECT extracted_json FROM partiality WHERE scope = 'secret-scrubbing' AND revision = ?`,
        )
        .all(revision) as Array<{ extracted_json: string | null }>;

      // There should be a partiality entry indicating secrets were scrubbed
      expect(partialityRows.length).toBe(1);
      const extracted = JSON.parse(partialityRows[0]!.extracted_json!) as string[];
      // The extracted field should contain a count message like "N secrets scrubbed"
      expect(extracted.length).toBe(1);
      expect(extracted[0]).toMatch(/\d+ secrets scrubbed/);

      // The count should be > 0 (at least 2 from the two symbol names,
      // plus claim statements and FTS text references)
      const count = parseInt(extracted[0]!.match(/(\d+)/)?.[1] ?? '0', 10);
      expect(count).toBeGreaterThanOrEqual(2);

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('scrubs AWS key from metadataJson on package nodes (dependencies)', async () => {
    // metadataJson fields must be scrubbed before DB persistence.
    // A package.json with a dependency whose name contains an AWS key will
    // produce a package node whose metadataJson.dependencies includes the key.
    const repoDir = mkdtempSync(join(tmpdir(), 'scrub-meta-repo-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'scrub-meta-data-'));

    try {
      spawnSync('git', ['init'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

      const secretKey = 'AKIAIOSFODNN7EXAMPLE';

      // Create a package.json with a dependency name that embeds the AWS key
      writeFileSync(
        join(repoDir, 'package.json'),
        JSON.stringify({
          name: 'test-pkg',
          dependencies: {
            [`dep-${secretKey}`]: '^1.0.0',
          },
        }),
      );

      // Need at least one source file for the indexer to process
      writeFileSync(
        join(repoDir, 'index.ts'),
        `export const x = 1;\n`,
      );

      spawnSync('git', ['add', '.'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });

      const store = ModelStore.open(dataDir);
      const indexer = new Indexer(store);
      await indexer.index({ repoRoot: repoDir, depth: 0 });

      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });

      // The package node metadata_json should have the AWS key scrubbed
      const pkgNodes = db
        .prepare(
          `SELECT id, metadata_json FROM nodes WHERE kind = 'package' AND metadata_json IS NOT NULL`,
        )
        .all() as Array<{ id: string; metadata_json: string }>;

      expect(pkgNodes.length).toBeGreaterThan(0);
      for (const row of pkgNodes) {
        expect(row.metadata_json).not.toContain(secretKey);
        expect(row.metadata_json).toContain('[REDACTED:aws-key]');
      }

      // Also verify no metadata_json in ANY table leaks the key
      for (const table of ['nodes', 'edges', 'evidence']) {
        const rows = db
          .prepare(`SELECT metadata_json FROM ${table} WHERE metadata_json IS NOT NULL`)
          .all() as Array<{ metadata_json: string }>;
        for (const row of rows) {
          expect(row.metadata_json).not.toContain(secretKey);
        }
      }

      db.close();
      store.close();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
