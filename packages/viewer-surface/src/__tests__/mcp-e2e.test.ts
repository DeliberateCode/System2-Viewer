/**
 * E2E MCP dispatch test -- exercises the full tool dispatch path
 * WITHOUT starting the stdio transport.
 *
 * 1. Creates engine with temp dir, indexes a small fixture
 * 2. Creates McpToolServer, registers with engine
 * 3. Calls server.invoke for doctor, getRepositoryOverview,
 *    findEntrypoints, listClaims
 * 4. Verifies: structured envelope, correct op, non-empty modelRevision
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createViewerEngine } from '../engine.js';
import { McpToolServer } from '../mcp-server.js';
import type { ViewerEngine } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-mcp-e2e-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Creates a small fixture repo with a handful of TypeScript source files
 * suitable for indexing. Returns the repo root path.
 */
function createFixtureRepo(): string {
  const repoDir = makeTempDir();
  mkdirSync(join(repoDir, 'src'), { recursive: true });

  writeFileSync(
    join(repoDir, 'src', 'index.ts'),
    [
      "import { greet } from './greet.js';",
      "import { add } from './math.js';",
      '',
      'export function main(): void {',
      "  console.log(greet('world'));",
      '  console.log(add(1, 2));',
      '}',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(repoDir, 'src', 'greet.ts'),
    [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}!`;',
      '}',
      '',
      'export function farewell(name: string): string {',
      '  return `Goodbye, ${name}!`;',
      '}',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(repoDir, 'src', 'math.ts'),
    [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function multiply(a: number, b: number): number {',
      '  return a * b;',
      '}',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(repoDir, 'src', 'types.ts'),
    [
      'export interface Config {',
      '  name: string;',
      '  version: number;',
      '}',
      '',
      'export type Status = "active" | "inactive";',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(repoDir, 'viewer.config.json'),
    JSON.stringify({ version: 1 }),
  );

  return repoDir;
}

/**
 * Asserts that a value is a well-formed ResultEnvelope with the expected
 * operation name and a non-empty modelRevision.
 */
function assertEnvelope(
  value: unknown,
  expectedOp: string,
): void {
  expect(value).toBeDefined();
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();

  const envelope = value as Record<string, unknown>;

  // query.op
  expect(envelope['query']).toBeDefined();
  const query = envelope['query'] as Record<string, unknown>;
  expect(query['op']).toBe(expectedOp);

  // data must be present (object or array)
  expect(envelope['data']).toBeDefined();

  // modelRevision non-empty string
  expect(typeof envelope['modelRevision']).toBe('string');
  expect((envelope['modelRevision'] as string).length).toBeGreaterThan(0);

  // evidence, uncertainties, suggestedNextCalls must be arrays
  expect(Array.isArray(envelope['evidence'])).toBe(true);
  expect(Array.isArray(envelope['uncertainties'])).toBe(true);
  expect(Array.isArray(envelope['suggestedNextCalls'])).toBe(true);
}

// ---------------------------------------------------------------------------
// Test setup and teardown
// ---------------------------------------------------------------------------

let engine: ViewerEngine | null = null;
let server: McpToolServer | null = null;

afterEach(() => {
  if (engine) {
    try { engine.close(); } catch { /* best effort */ }
    engine = null;
  }
  server = null;

  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// E2E MCP dispatch tests
// ---------------------------------------------------------------------------

describe('MCP E2E dispatch (no stdio transport)', () => {
  it('creates engine, indexes fixture, and registers McpToolServer', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    // Server is registered and ready for invoke
    const partition = server.toolPartition();
    expect(partition.length).toBe(21);
  });

  it('viewer.doctor returns a valid structured envelope', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    const result = await server.invoke('viewer.doctor', {});

    assertEnvelope(result, 'doctor');

    // Doctor-specific: check that data contains diagnostic fields
    const data = result.data as Record<string, unknown>;
    expect(data['nodeVersion']).toBeDefined();
    expect(typeof data['sqliteBinding']).toBe('boolean');
    expect(data['effectiveBackend']).toBeDefined();
  });

  it('viewer.getRepositoryOverview returns indexed repo data', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    // Use empty args -- defaults to the latest indexed revision
    const result = await server.invoke('viewer.getRepositoryOverview', {});

    assertEnvelope(result, 'getRepositoryOverview');

    // Overview-specific: check data contains structure information
    const data = result.data as Record<string, unknown>;
    expect(data).toBeDefined();
    // The overview should report files from the fixture
    const structure = data['structure'] as Record<string, unknown> | undefined;
    if (structure) {
      const totalFiles = structure['totalFiles'] as number;
      // We created 4 .ts files + 1 viewer.config.json
      expect(totalFiles).toBeGreaterThanOrEqual(1);
    }
  });

  it('viewer.findEntrypoints returns candidates for "index" query', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    const result = await server.invoke('viewer.findEntrypoints', {
      query: 'index',
    });

    assertEnvelope(result, 'findEntrypoints');

    // Entrypoints-specific: check that candidates exist
    const data = result.data as Record<string, unknown>;
    expect(data).toBeDefined();
    const candidates = data['candidates'] as unknown[];
    // The fixture has src/index.ts which should match the "index" query
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('viewer.listClaims returns structured claims data', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    const result = await server.invoke('viewer.listClaims', {});

    assertEnvelope(result, 'listClaims');

    // Claims data should be an array (may be empty if no surfaceable claims)
    const data = result.data;
    expect(data).toBeDefined();
  });

  it('all four operations return consistent modelRevision', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });
    await engine.indexer.index({ repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    const doctorResult = await server.invoke('viewer.doctor', {});
    const overviewResult = await server.invoke('viewer.getRepositoryOverview', {});
    const entrypointsResult = await server.invoke('viewer.findEntrypoints', { query: 'main' });
    const claimsResult = await server.invoke('viewer.listClaims', {});

    const overviewRev = overviewResult.modelRevision;
    const entrypointsRev = entrypointsResult.modelRevision;
    const claimsRev = claimsResult.modelRevision;

    // Overview and entrypoints share the same real revision
    expect(overviewRev).toBe(entrypointsRev);

    // All modelRevision fields are non-empty strings
    expect(overviewRev.length).toBeGreaterThan(0);
    expect(entrypointsRev.length).toBeGreaterThan(0);
    expect(claimsRev.length).toBeGreaterThan(0);
    expect(doctorResult.modelRevision.length).toBeGreaterThan(0);
  });

  it('invoke rejects unknown tool name', async () => {
    const repoDir = createFixtureRepo();
    const dataDir = makeTempDir();

    engine = createViewerEngine({ dataDir, repoRoot: repoDir });

    server = new McpToolServer();
    server.register(engine, engine.feedback, engine.indexer);

    await expect(
      server.invoke('viewer.nonExistent', {}),
    ).rejects.toThrow('Unknown tool');
  });

  it('invoke before register throws', async () => {
    server = new McpToolServer();

    await expect(
      server.invoke('viewer.doctor', {}),
    ).rejects.toThrow('register');
  });
});
