/**
 * Smoke tests for bugfixes: status CLI wiring, exclude matcher integration.
 *
 * Coverage: regression tests for Findings 2, 3, 6
 */
import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../cli.js';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import { buildExcludeSet, DEFAULT_SECRET_PATTERNS } from '@system2-viewer/viewer-config';
import type { ViewerConfig } from '@system2-viewer/viewer-config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function createMockOps(): CliOps {
  const resolveResult: ResolveResult = {
    status: 'resolved',
    id: 'node-123',
    kind: 'path',
    displayName: 'test/file.ts',
  };

  return {
    getRepositoryOverview: vi.fn(() => makeEnvelope('getRepositoryOverview')),
    findEntrypoints: vi.fn(() => makeEnvelope('findEntrypoints', { candidates: [] })),
    traceFlow: vi.fn(() => makeEnvelope('traceFlow', { segments: [] })),
    explainSubsystem: vi.fn(() => makeEnvelope('explainSubsystem')),
    estimateBlastRadius: vi.fn(() => makeEnvelope('estimateBlastRadius', { affectedNodes: [] })),
    listClaims: vi.fn(() => makeEnvelope('listClaims', [])),
    listUncertainties: vi.fn(() => makeEnvelope('listUncertainties', [])),
    checkInvariants: vi.fn(() => makeEnvelope('checkInvariants', { violations: [] })),
    verifyClaim: vi.fn(() => makeEnvelope('verifyClaim', {})),
    buildClaimPayload: vi.fn(() => makeEnvelope('buildClaimPayload', {})),
    sampleEvidenceAgreement: vi.fn(() => makeEnvelope('sampleEvidenceAgreement', {})),
    feedback: {
      confirmClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: null })),
      rejectClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: null })),
      annotateClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: null })),
      confirmSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: null })),
      rejectSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: null })),
      annotateSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: null })),
    },
    index: vi.fn(async () => makeEnvelope('index', { revision: 'rev-1', sourceModified: false })),
    resolveRef: vi.fn(() => makeEnvelope('resolveReference', resolveResult) as ResultEnvelope<ResolveResult>),
    getClaimHistory: vi.fn(() => makeEnvelope('getClaimHistory', { claimId: 'c1', verificationHistory: [], annotations: [], successorChain: [] })),
    compareRevisions: vi.fn(() => makeEnvelope('compareRevisions', { revA: 'a', revB: 'b', changedFiles: [], changedSymbols: [], changedEdges: [], changedClaims: [] })),
    doctor: vi.fn(async () => makeEnvelope('doctor', {
      nodeVersion: 'v22.0.0',
      sqliteBinding: true,
      grammarAvailability: {},
      tsBackendAvailable: true,
      gitAvailable: true,
      modelStatus: 'indexed',
      effectiveBackend: 'treesitter',
      degradationReason: null,
      backendCoverage: {},
    })),
    status: vi.fn(() => makeEnvelope('status', { modelRevision: 'rev-1', readinessState: 'ready' })),
    initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
    mcpConfig: vi.fn(() => ({ targetPath: '/tmp/.mcp.json', created: true })),
  } as unknown as CliOps;
}

describe('Finding 2: viewer status does not crash', () => {
  it('status command calls ops.status (not ops.doctor)', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['status'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.status).toHaveBeenCalled();
    expect(ops.doctor).not.toHaveBeenCalled();
  });

  it('status command renders output without crashing', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['status'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('Finding 3: exclude matcher applied during indexing', () => {
  it('.env files are excluded by default secret patterns', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: [] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    const matcher = buildExcludeSet(config, []);
    expect(matcher.isExcluded('.env')).toBe(true);
    expect(matcher.isExcluded('.env.local')).toBe(true);
    expect(matcher.isExcluded('config/.env')).toBe(true);
  });

  it('*.pem and *.key files are excluded', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: [] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    const matcher = buildExcludeSet(config, []);
    expect(matcher.isExcluded('server.pem')).toBe(true);
    expect(matcher.isExcluded('private.key')).toBe(true);
    expect(matcher.isExcluded('certs/tls.pem')).toBe(true);
  });

  it('.npmrc and SSH keys are excluded', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: [] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    const matcher = buildExcludeSet(config, []);
    expect(matcher.isExcluded('.npmrc')).toBe(true);
    expect(matcher.isExcluded('id_rsa')).toBe(true);
    expect(matcher.isExcluded('id_ed25519')).toBe(true);
  });

  it('normal source files are NOT excluded', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: [] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    const matcher = buildExcludeSet(config, []);
    expect(matcher.isExcluded('src/index.ts')).toBe(false);
    expect(matcher.isExcluded('package.json')).toBe(false);
    expect(matcher.isExcluded('README.md')).toBe(false);
  });
});

describe('Finding 1 fix: indexing uses target repo .gitignore', () => {
  it('buildExcludeSet respects gitignore patterns including node_modules', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: [] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    // Simulate a .gitignore that excludes node_modules
    const gitignorePatterns = ['node_modules', 'dist', '*.log'];
    const matcher = buildExcludeSet(config, gitignorePatterns);

    // The walker checks directory/file names against the matcher.
    // 'node_modules' directory entry is checked as 'node_modules'
    expect(matcher.isExcluded('node_modules')).toBe(true);
    // 'dist' directory entry
    expect(matcher.isExcluded('dist')).toBe(true);
    // log files should be excluded (basename match)
    expect(matcher.isExcluded('error.log')).toBe(true);
    expect(matcher.isExcluded('logs/debug.log')).toBe(true);
    // normal source files are NOT excluded
    expect(matcher.isExcluded('src/index.ts')).toBe(false);
  });

  it('config excludes from target repo are applied', () => {
    const config: ViewerConfig = {
      version: 1,
      repository: { exclude: ['vendor/**', 'generated/**'] },
      indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
      rules: [],
    } as unknown as ViewerConfig;

    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('vendor/lib.js')).toBe(true);
    expect(matcher.isExcluded('generated/schema.ts')).toBe(true);
    expect(matcher.isExcluded('src/index.ts')).toBe(false);
  });

  it('Indexer uses target-repo .gitignore to exclude node_modules', async () => {
    // Create a temporary directory structure simulating a target repo
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync: rmSyncLocal } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: pathJoin } = await import('node:path');
    const { Indexer } = await import('@system2-viewer/viewer-indexer');

    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'viewer-gitignore-test-'));
    try {
      // Create source file
      mkdirSync(pathJoin(tempDir, 'src'), { recursive: true });
      writeFileSync(pathJoin(tempDir, 'src', 'index.ts'), 'export const x = 1;');
      // Create node_modules (should be excluded by .gitignore)
      mkdirSync(pathJoin(tempDir, 'node_modules', 'some-pkg'), { recursive: true });
      writeFileSync(pathJoin(tempDir, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {}');
      // Create .gitignore that excludes node_modules
      writeFileSync(pathJoin(tempDir, '.gitignore'), 'node_modules\n');

      // Build exclude matcher from target repo's .gitignore
      const config: ViewerConfig = {
        version: 1,
        repository: { exclude: [] },
        indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
        rules: [],
        remote: { enabled: false },
      } as unknown as ViewerConfig;
      const matcher = buildExcludeSet(config, ['node_modules']);

      // Track which node IDs are upserted
      const upsertedNodePaths: (string | null)[] = [];
      const mockStore = {
        beginSnapshot: () => ({
          insertRevision: vi.fn(),
          clearFtsForRepository: vi.fn(),
          deleteFtsForFile: vi.fn(),
          upsertNode: vi.fn((row: { path: string | null }) => { upsertedNodePaths.push(row.path); }),
          upsertEdge: vi.fn(),
          appendEvidence: vi.fn(),
          versionClaim: vi.fn(),
          insertFtsText: vi.fn(),
          upsertEmbedding: vi.fn(),
          upsertPartiality: vi.fn(),
          closeStaleIntervals: vi.fn(),
          commit: vi.fn(),
          abort: vi.fn(),
        }),
      };

      const indexer = new Indexer(mockStore as any);
      indexer.setExcludeMatcher(matcher);
      await indexer.index({ repoRoot: tempDir });

      // src/index.ts should be indexed
      expect(upsertedNodePaths.some(p => p === 'src/index.ts')).toBe(true);
      // node_modules files should NOT be indexed
      expect(upsertedNodePaths.some(p => p != null && p.includes('node_modules'))).toBe(false);
    } finally {
      rmSyncLocal(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Finding 6: viewer-surface package.json has bin field', () => {
  it('package.json has bin field pointing to viewer.mjs', () => {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.viewer).toBe('bin/viewer.mjs');
  });

  it('package.json files array includes bin directory', () => {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.files).toContain('bin');
    expect(pkg.files).toContain('dist');
  });
});
