/**
 * Semantic Retrieval Integration Tests
 *
 * Validates end-to-end semantic retrieval behavior, graceful degradation
 * when ONNX Runtime is not installed, --skip-embed flag acceptance,
 * embedding coverage reporting, and no-network guarantees.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runRetrievalPipeline, PIPELINE_STAGES } from '@system2-viewer/viewer-retrieval';
import { TOOL_TABLE } from '../tool-table.js';
import { COMMANDS, COMMAND_MAP } from '../cli-commands.js';
import { bindHandle } from '../bind-handle.js';
import { buildDoctorReport } from '../doctor.js';
import type { ReadHandle } from '@system2-viewer/viewer-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock ReadHandle suitable for bind-handle tests.
 * Defaults: empty data, semanticSearch returning [], embeddingCoverage
 * returning zeroes (simulating no embeddings in the store).
 */
function createMockReadHandle(overrides: Partial<ReadHandle> = {}): ReadHandle {
  return {
    neighbors: vi.fn(() => []),
    ftsSearch: vi.fn(() => []),
    getNode: vi.fn(() => null),
    getClaim: vi.fn(() => null),
    claimsByPrefix: vi.fn(() => []),
    listOpenClaims: vi.fn(() => []),
    getEvidence: vi.fn(() => null),
    partiality: vi.fn(() => []),
    verificationHistory: vi.fn(() => []),
    semanticSearch: vi.fn(() => []),
    embeddingCoverage: vi.fn(() => ({ totalNodes: 0, embeddedNodes: 0 })),
    getFileHash: vi.fn(() => null),
    close: vi.fn(),
    ...overrides,
  };
}

function createMockDb(): any {
  const mockStmt = {
    all: vi.fn(() => []),
    get: vi.fn(() => undefined),
  };
  return {
    prepare: vi.fn(() => mockStmt),
  };
}

// ---------------------------------------------------------------------------
// 1. Graceful degradation: ONNX not installed
//    When onnxruntime-node is not available (the common test environment),
//    the semantic pipeline stage degrades gracefully.
// ---------------------------------------------------------------------------

describe('Semantic retrieval: ONNX not installed graceful degradation', () => {
  it('semantic stage returns [] when handle has no semanticSearch method', () => {
    // A handle without semanticSearch (legacy/Phase 1 shape)
    const handle = {
      neighbors: vi.fn(() => []),
      ftsSearch: vi.fn(() => []),
      getNode: vi.fn(() => null),
      getClaim: vi.fn(() => null),
      partiality: vi.fn(() => []),
      // no semanticSearch property
    };

    const result = runRetrievalPipeline(handle, {
      text: 'authentication flow',
      queryEmbedding: new Float32Array([0.1, 0.2, 0.3]),
      revision: 'rev-1',
    });

    expect(result).toBeDefined();
    expect(result.anchors).toBeDefined();
    const semanticAnchors = result.anchors.filter(a => a.source === 'semantic');
    expect(semanticAnchors).toHaveLength(0);
  });

  it('semantic stage returns [] when semanticSearch is present but queryEmbedding is undefined', () => {
    const semanticSearch = vi.fn(() => []);
    const handle = {
      neighbors: vi.fn(() => []),
      ftsSearch: vi.fn(() => []),
      getNode: vi.fn(() => null),
      getClaim: vi.fn(() => null),
      partiality: vi.fn(() => []),
      semanticSearch,
    };

    const result = runRetrievalPipeline(handle, {
      text: 'authentication flow',
      revision: 'rev-1',
      // no queryEmbedding
    });

    expect(semanticSearch).not.toHaveBeenCalled();
    const semanticAnchors = result.anchors.filter(a => a.source === 'semantic');
    expect(semanticAnchors).toHaveLength(0);
  });

  it('all other pipeline stages (symbolic, lexical, graph, claim) still function without semantic', () => {
    const handle = {
      neighbors: vi.fn(() => []),
      ftsSearch: vi.fn(() => [
        { objectId: 'fts-1', objectType: 'symbol', text: 'login', path: 'src/auth.ts', rank: -2 },
      ]),
      getNode: vi.fn((id: string) => {
        if (id === 'node-1') return { id: 'node-1', kind: 'file', path: 'src/auth.ts' };
        return null;
      }),
      getClaim: vi.fn(() => null),
      partiality: vi.fn(() => []),
      // no semanticSearch
    };

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['node-1'],
      text: 'login',
      revision: 'rev-1',
    });

    // Symbolic stage should resolve node-1
    expect(result.anchors.some(a => a.id === 'node-1')).toBe(true);
    // Lexical stage should find fts-1
    expect(result.anchors.some(a => a.id === 'fts-1')).toBe(true);
    // No semantic anchors
    expect(result.anchors.filter(a => a.source === 'semantic')).toHaveLength(0);
  });

  it('tryLoadEmbedder returns null when onnxruntime-node is not installed', async () => {
    // Dynamic import to test the embedder module directly
    const { tryLoadEmbedder } = await import('@system2-viewer/viewer-indexer');
    const embedder = await tryLoadEmbedder();
    expect(embedder).toBeNull();
  });

  it('probeEmbedderStatus returns not_installed when onnxruntime-node is unavailable', async () => {
    const { probeEmbedderStatus } = await import('@system2-viewer/viewer-indexer');
    const status = await probeEmbedderStatus();
    expect(status.status).toBe('not_installed');
  });
});

// ---------------------------------------------------------------------------
// 2. --skip-embed flag accepted by CLI index command args builder
// ---------------------------------------------------------------------------

describe('CLI index command: --skip-embed flag', () => {
  it('COMMAND_MAP contains an index command', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    expect(indexCmd!.opKey).toBe('index');
  });

  it('index command args builder produces skipEmbed: true when --skip-embed is present', () => {
    const indexCmd = COMMAND_MAP.get('index')!;
    const args = indexCmd.args(['.'], { 'skip-embed': '' });
    expect(args).toHaveProperty('skipEmbed', true);
  });

  it('index command args builder produces skipEmbed: false when --skip-embed is absent', () => {
    const indexCmd = COMMAND_MAP.get('index')!;
    const args = indexCmd.args(['.'], {});
    expect(args).toHaveProperty('skipEmbed', false);
  });

  it('index command args builder coexists with other flags', () => {
    const indexCmd = COMMAND_MAP.get('index')!;
    const args = indexCmd.args(['./repo'], {
      'skip-embed': '',
      'depth': '5',
      'workspace': 'auto',
    });
    expect(args['skipEmbed']).toBe(true);
    expect(args['depth']).toBe(5);
    expect(args['workspace']).toBe('auto');
    expect(args['repoRoot']).toBe('./repo');
  });
});

// ---------------------------------------------------------------------------
// 3. skipEmbed present in MCP tool schema for viewer.index
// ---------------------------------------------------------------------------

describe('MCP tool schema: viewer.index includes skipEmbed', () => {
  it('TOOL_TABLE contains viewer.index entry', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexTool).toBeDefined();
    expect(indexTool!.capabilityClass).toBe('index');
  });

  it('viewer.index input schema accepts skipEmbed boolean', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index')!;
    const schema = indexTool.inputSchema;

    // Parse with skipEmbed: true
    const resultTrue = schema.safeParse({
      repoRoot: '/some/path',
      skipEmbed: true,
    });
    expect(resultTrue.success).toBe(true);

    // Parse with skipEmbed: false
    const resultFalse = schema.safeParse({
      repoRoot: '/some/path',
      skipEmbed: false,
    });
    expect(resultFalse.success).toBe(true);
  });

  it('viewer.index input schema accepts omitted skipEmbed', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index')!;
    const result = indexTool.inputSchema.safeParse({
      repoRoot: '/some/path',
    });
    expect(result.success).toBe(true);
  });

  it('viewer.index input schema rejects non-boolean skipEmbed', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index')!;
    const result = indexTool.inputSchema.safeParse({
      repoRoot: '/some/path',
      skipEmbed: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Doctor report includes embeddingModel field with status
//
//    adds the embeddingModel field to DoctorReport. This test
//    verifies that buildDoctorReport produces a report that either
//    contains the embeddingModel field or
//    produces a valid report without it (backward compatibility).
//    The field should have status: 'available' | 'not_installed' | 'load_failed'.
// ---------------------------------------------------------------------------

describe('Doctor report: embedding model status', () => {
  it('buildDoctorReport returns a valid doctor report object', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-semantic-test' });
    expect(report).toBeDefined();
    expect(report).toHaveProperty('nodeVersion');
    expect(report).toHaveProperty('sqliteBinding');
    expect(report).toHaveProperty('grammarAvailability');
    expect(report).toHaveProperty('modelStatus');
    expect(report).toHaveProperty('effectiveBackend');
  });

  it('buildDoctorReport includes embeddingModel field', async () => {
    const report = await buildDoctorReport({ dataDir: '/tmp/nonexistent-semantic-test' });

    // embeddingModel field is now present.
    expect(report).toHaveProperty('embeddingModel');
    const model = report.embeddingModel!;
    expect(model).toHaveProperty('status');
    expect(['available', 'not_installed', 'load_failed']).toContain(model.status);
  });
});

// ---------------------------------------------------------------------------
// 5. embeddingCoverage in bind-handle returns { totalNodes: 0, embeddedNodes: 0 }
//    when no embeddings exist
// ---------------------------------------------------------------------------

describe('bindHandle: embeddingCoverage with no embeddings', () => {
  it('embeddingCoverage returns zeros when ReadHandle has no embeddings', () => {
    const readHandle = createMockReadHandle({
      embeddingCoverage: vi.fn(() => ({ totalNodes: 0, embeddedNodes: 0 })),
    });
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    expect(handle.embeddingCoverage).toBeDefined();
    const coverage = handle.embeddingCoverage!();
    expect(coverage).toEqual({ totalNodes: 0, embeddedNodes: 0 });
  });

  it('embeddingCoverage delegates to ReadHandle', () => {
    const embeddingCoverageMock = vi.fn(() => ({ totalNodes: 50, embeddedNodes: 0 }));
    const readHandle = createMockReadHandle({
      embeddingCoverage: embeddingCoverageMock,
    });
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    const coverage = handle.embeddingCoverage!();
    expect(embeddingCoverageMock).toHaveBeenCalled();
    expect(coverage).toEqual({ totalNodes: 50, embeddedNodes: 0 });
  });

  it('embeddingCoverage with some embeddings returns correct counts', () => {
    const readHandle = createMockReadHandle({
      embeddingCoverage: vi.fn(() => ({ totalNodes: 100, embeddedNodes: 42 })),
    });
    const db = createMockDb();
    const handle = bindHandle(readHandle, db, 'rev::test');

    const coverage = handle.embeddingCoverage!();
    expect(coverage.totalNodes).toBe(100);
    expect(coverage.embeddedNodes).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 6. Retrieval pipeline semantic stage returns [] when handle has no
//    semanticSearch -- end-to-end integration verification
// ---------------------------------------------------------------------------

describe('Retrieval pipeline: end-to-end semantic graceful degradation', () => {
  it('returns complete result with zero semantic anchors when semanticSearch is absent', () => {
    const getNode = vi.fn((id: string) => {
      if (id === 'file-1') return { id: 'file-1', kind: 'file', path: 'src/main.ts' };
      return null;
    });
    const ftsSearch = vi.fn(() => [
      { objectId: 'sym-auth', objectType: 'symbol', text: 'authenticate', path: 'src/auth.ts', rank: -1 },
    ]);

    const handle = {
      neighbors: vi.fn(() => []),
      ftsSearch,
      getNode,
      getClaim: vi.fn(() => null),
      partiality: vi.fn(() => []),
      // NO semanticSearch
    };

    const result = runRetrievalPipeline(handle, {
      nodeIds: ['file-1'],
      text: 'authenticate',
      queryEmbedding: new Float32Array([0.1, 0.2, 0.3]),
      revision: 'test-rev',
    });

    // Pipeline completes successfully
    expect(result).toBeDefined();
    expect(result.revision).toBe('test-rev');

    // No semantic anchors
    const semanticAnchors = result.anchors.filter(a => a.source === 'semantic');
    expect(semanticAnchors).toHaveLength(0);

    // But symbolic and lexical stages worked
    expect(result.anchors.some(a => a.source === 'symbolic')).toBe(true);
    expect(result.anchors.some(a => a.source === 'lexical')).toBe(true);
  });

  it('includes semantic anchors when semanticSearch IS available', () => {
    const semanticSearch = vi.fn(() => [
      { nodeId: 'sem-node-1', score: 0.88 },
    ]);

    const handle = {
      neighbors: vi.fn(() => []),
      ftsSearch: vi.fn(() => []),
      getNode: vi.fn(() => null),
      getClaim: vi.fn(() => null),
      partiality: vi.fn(() => []),
      semanticSearch,
    };

    const result = runRetrievalPipeline(handle, {
      queryEmbedding: new Float32Array([0.5, 0.5]),
      revision: 'test-rev',
    });

    const semanticAnchors = result.anchors.filter(a => a.source === 'semantic');
    expect(semanticAnchors).toHaveLength(1);
    expect(semanticAnchors[0].id).toBe('sem-node-1');
  });

  it('pipeline stages are exactly: symbolic, lexical, semantic, graph, claim', () => {
    expect(PIPELINE_STAGES).toEqual([
      'symbolic',
      'lexical',
      'semantic',
      'graph',
      'claim',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 7. Grep check: no http, https, fetch, or WebSocket import in embedding
//    code paths.
//
//    No network calls anywhere. This verifies the embedding
//    module specifically does not import networking libraries.
// ---------------------------------------------------------------------------

describe('Embedding code paths: no network imports', () => {
  const FORBIDDEN_IMPORTS = [
    /\bimport\b.*['"]http['"]/,
    /\bimport\b.*['"]https['"]/,
    /\bimport\b.*['"]node:http['"]/,
    /\bimport\b.*['"]node:https['"]/,
    /\bimport\b.*['"]node:net['"]/,
    /\bimport\b.*['"]node:dgram['"]/,
    /\bimport\b.*['"]node:tls['"]/,
    /\brequire\s*\(\s*['"]http['"]\s*\)/,
    /\brequire\s*\(\s*['"]https['"]\s*\)/,
    /\brequire\s*\(\s*['"]node:http['"]\s*\)/,
    /\brequire\s*\(\s*['"]node:https['"]\s*\)/,
    /\bfetch\s*\(/,
    /\bnew\s+WebSocket\b/,
    /\bimport\b.*['"]ws['"]/,
  ];

  /**
   * Recursively collects all .ts source files under a directory,
   * excluding dist/ and node_modules/.
   */
  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir)) {
        if (entry === 'dist' || entry === 'node_modules') continue;
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            files.push(...collectTsFiles(fullPath));
          } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
            files.push(fullPath);
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // skip unreadable directories
    }
    return files;
  }

  // The monorepo root is 4 levels up from packages/viewer-surface/src/__tests__/
  const MONOREPO_ROOT = resolve(__dirname, '../../../..');

  it('viewer-indexer embedder module has no network imports', () => {
    const embedderPath = join(MONOREPO_ROOT, 'packages/viewer-indexer/src/embedder.ts');
    const content = readFileSync(embedderPath, 'utf-8');
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('viewer-indexer source has no http/https/fetch/WebSocket imports', () => {
    const srcDir = join(MONOREPO_ROOT, 'packages/viewer-indexer/src');
    const tsFiles = collectTsFiles(srcDir);
    expect(tsFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      for (const pattern of FORBIDDEN_IMPORTS) {
        if (pattern.test(content)) {
          violations.push(`${filePath}: matches ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('viewer-store read-handle (semantic search) has no network imports', () => {
    const readHandlePath = join(MONOREPO_ROOT, 'packages/viewer-store/src/read-handle.ts');
    const content = readFileSync(readHandlePath, 'utf-8');
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('viewer-retrieval pipeline (semantic stage) has no network imports', () => {
    const pipelinePath = join(MONOREPO_ROOT, 'packages/viewer-retrieval/src/pipeline.ts');
    const content = readFileSync(pipelinePath, 'utf-8');
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(content).not.toMatch(pattern);
    }
  });
});
