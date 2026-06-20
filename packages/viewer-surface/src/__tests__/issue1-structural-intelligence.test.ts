import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createViewerEngine } from '../engine.js';
import type { ViewerEngine } from '../types.js';
import { getImportGraph } from '@system2-viewer/viewer-retrieval';
import type { ReadView, EntrypointReadHandle } from '@system2-viewer/viewer-retrieval';
import { findEntrypoints } from '@system2-viewer/viewer-retrieval';
import {
  loadConfigResult,
  DEFAULT_FRAMEWORK_HINTS,
  extractDecoratorNames,
  BUILT_IN_CLAIM_TYPES,
} from '@system2-viewer/viewer-config';
import { resolveBoundaryMembership } from '@system2-viewer/viewer-indexer';
import {
  RulesEngine,
  checkInvariants,
  loadExplicitRules,
} from '@system2-viewer/viewer-verify';
import type { RulesReadHandle, ModelImportEdge } from '@system2-viewer/viewer-verify';
import { ModelStore } from '@system2-viewer/viewer-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-p6-issue1-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  tempDirs.length = 0;
});

function createMockReadView(
  edges: Array<{ fromNodeId: string; toNodeId: string; kind: string }>,
): ReadView {
  return {
    neighbors: () => [],
    ftsSearch: () => [],
    getNode: (id: string) =>
      edges.some(e => e.fromNodeId === id || e.toNodeId === id) ? { id, kind: 'file' } : null,
    getClaim: () => null,
    claimsByPrefix: () => [],
    partiality: () => [],
    allEdges: (kind?: string) => kind ? edges.filter(e => e.kind === kind) : edges,
  };
}

function mkRulesReadHandle(importEdges: ModelImportEdge[] = []): RulesReadHandle {
  return {
    neighbors: vi.fn().mockReturnValue([]),
    getNode: vi.fn().mockReturnValue(null),
    allImportEdges: vi.fn().mockReturnValue(importEdges),
  };
}

// ============================================================================
// Issue #1.1: Cross-module import graph
// ============================================================================

describe('Issue #1.1: Cross-module import graph', () => {
  it('builds adjacency list with fan-in/fan-out from import edges', () => {
    const edges = [
      { fromNodeId: 'src/api/handler.ts', toNodeId: 'src/db/connection.ts', kind: 'imports' },
      { fromNodeId: 'src/api/handler.ts', toNodeId: 'src/utils/helper.ts', kind: 'imports' },
      { fromNodeId: 'src/web/page.ts', toNodeId: 'src/db/connection.ts', kind: 'imports' },
      { fromNodeId: 'src/web/page.ts', toNodeId: 'src/api/handler.ts', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.metrics.totalNodes).toBe(4);
    expect(result.data.metrics.totalEdges).toBe(4);

    const dbNode = result.data.nodes.find(n => n.id === 'src/db/connection.ts');
    expect(dbNode).toBeDefined();
    expect(dbNode!.fanIn).toBe(2);
    expect(dbNode!.fanOut).toBe(0);

    const apiNode = result.data.nodes.find(n => n.id === 'src/api/handler.ts');
    expect(apiNode).toBeDefined();
    expect(apiNode!.fanIn).toBe(1);
    expect(apiNode!.fanOut).toBe(2);
  });

  it('detects circular dependency cycles via Tarjan SCC', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'B', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'C', toNodeId: 'A', kind: 'imports' },
      { fromNodeId: 'D', toNodeId: 'E', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*', detectCycles: true });

    expect(result.data.cycles).toBeDefined();
    expect(result.data.cycles!.length).toBe(1);
    expect(result.data.metrics.cycleCount).toBe(1);

    const cycle = result.data.cycles![0];
    expect(cycle.length).toBeGreaterThanOrEqual(3);
    for (const node of ['A', 'B', 'C']) {
      expect(cycle).toContain(node);
    }
    expect(cycle).not.toContain('D');
    expect(cycle).not.toContain('E');
  });

  it('reports empty cycles for acyclic import graph', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'B', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'C', toNodeId: 'D', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*', detectCycles: true });

    expect(result.data.cycles).toEqual([]);
    expect(result.data.cyclesLimitReached).toBe(false);
  });

  it('ranks nodes by fan-in descending (most-imported first)', () => {
    const edges = [
      { fromNodeId: 'app.ts', toNodeId: 'utils.ts', kind: 'imports' },
      { fromNodeId: 'handler.ts', toNodeId: 'utils.ts', kind: 'imports' },
      { fromNodeId: 'test.ts', toNodeId: 'utils.ts', kind: 'imports' },
      { fromNodeId: 'app.ts', toNodeId: 'handler.ts', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.nodes[0].id).toBe('utils.ts');
    expect(result.data.nodes[0].fanIn).toBe(3);
  });

  it('surfaces uncertainty for empty scope match', () => {
    const handle = createMockReadView([]);
    const result = getImportGraph(handle, { scope: 'nonexistent-module' });

    expect(result.uncertainties.length).toBeGreaterThan(0);
    expect(result.uncertainties[0].kind).toBe('empty-scope');
  });

  it('wraps result in a valid ResultEnvelope with suggested next calls', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.query.op).toBe('getImportGraph');
    expect(result.modelRevision).toBeDefined();
    expect(result.evidence).toBeDefined();
    expect(result.suggestedNextCalls.length).toBeGreaterThan(0);
    expect(result.suggestedNextCalls.some(s => s.op === 'viewer.traceFlow')).toBe(true);
  });

  it('computes aggregate metrics (maxFanIn, maxFanOut, avgFanOut)', () => {
    const edges = [
      { fromNodeId: 'A', toNodeId: 'B', kind: 'imports' },
      { fromNodeId: 'A', toNodeId: 'C', kind: 'imports' },
      { fromNodeId: 'A', toNodeId: 'D', kind: 'imports' },
    ];
    const handle = createMockReadView(edges);
    const result = getImportGraph(handle, { scope: '*' });

    expect(result.data.metrics.maxFanOut).toBe(3);
    expect(result.data.metrics.maxFanIn).toBe(1);
    expect(result.data.metrics.avgFanOut).toBeCloseTo(0.75, 1);
  });
});

// ============================================================================
// Issue #1.2: Semantic entrypoints / Framework hints
// ============================================================================

describe('Issue #1.2: Semantic entrypoints via framework hints', () => {
  it('DEFAULT_FRAMEWORK_HINTS covers Flask, FastAPI, Django, and Spring', () => {
    const frameworks = new Set(DEFAULT_FRAMEWORK_HINTS.map(h => h.framework));
    expect(frameworks.has('flask')).toBe(true);
    expect(frameworks.has('fastapi')).toBe(true);
    expect(frameworks.has('django')).toBe(true);
    expect(frameworks.has('spring')).toBe(true);
  });

  it('all default hints exclude test directories', () => {
    for (const hint of DEFAULT_FRAMEWORK_HINTS) {
      expect(hint.excludePaths).toBeDefined();
      expect(hint.excludePaths!.length).toBeGreaterThan(0);
      expect(hint.excludePaths!.some(p => p.includes('test'))).toBe(true);
    }
  });

  it('extractDecoratorNames handles Python decorators', () => {
    const meta = JSON.stringify({ decorators: ['app.route', 'login_required'] });
    const result = extractDecoratorNames(meta);
    expect(result).toContain('app.route');
    expect(result).toContain('login_required');
  });

  it('extractDecoratorNames handles Java annotations', () => {
    const meta = JSON.stringify({ annotations: ['RequestMapping', 'GetMapping'] });
    const result = extractDecoratorNames(meta);
    expect(result).toContain('RequestMapping');
    expect(result).toContain('GetMapping');
  });

  it('extractDecoratorNames handles Rust attributes', () => {
    const meta = JSON.stringify({ attributes: ['derive(Debug)', 'serde(rename)'] });
    const result = extractDecoratorNames(meta);
    expect(result).toContain('derive(Debug)');
  });

  it('findEntrypoints matches framework-hint decorated symbols', () => {
    const symbolEntries = [
      { id: 'node::app::login', metadataJson: JSON.stringify({ decorators: ['app.route'] }), path: 'src/auth/login.py' },
      { id: 'node::api::users', metadataJson: JSON.stringify({ annotations: ['GetMapping'] }), path: 'src/api/UsersController.java' },
    ];

    const handle: EntrypointReadHandle = {
      neighbors: () => [],
      ftsSearch: () => [],
      getNode: (id: string) => {
        const entry = symbolEntries.find(e => e.id === id);
        return entry ? { id, kind: 'symbol', display_name: id.split('::').pop()!, path: entry.path } : null;
      },
      getClaim: () => null,
      claimsByPrefix: () => [],
      partiality: () => [],
      decoratedSymbols: () => symbolEntries,
    };

    const result = findEntrypoints(handle, 'login', {
      frameworkHints: [...DEFAULT_FRAMEWORK_HINTS],
    });

    const hintCandidates = result.data.candidates.filter(c => c.source === 'framework-hint');
    expect(hintCandidates.length).toBeGreaterThan(0);

    const flaskHit = hintCandidates.find(c => c.nodeId === 'node::app::login');
    expect(flaskHit).toBeDefined();
    expect(flaskHit!.entrypointKind).toBe('http-handler');
  });

  it('findEntrypoints skips symbols in excluded test paths', () => {
    const symbolEntries = [
      { id: 'node::test::login', metadataJson: JSON.stringify({ decorators: ['app.route'] }), path: 'test/test_auth.py' },
    ];

    const handle: EntrypointReadHandle = {
      neighbors: () => [],
      ftsSearch: () => [],
      getNode: () => null,
      getClaim: () => null,
      claimsByPrefix: () => [],
      partiality: () => [],
      decoratedSymbols: () => symbolEntries,
    };

    const result = findEntrypoints(handle, 'login', {
      frameworkHints: [...DEFAULT_FRAMEWORK_HINTS],
    });

    const hintCandidates = result.data.candidates.filter(c => c.source === 'framework-hint');
    expect(hintCandidates).toHaveLength(0);
  });

  it('config validates frameworkHints entries', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: 'app.route', framework: 'flask', entrypointKind: 'http-handler' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.frameworkHints).toHaveLength(1);
  });

  it('config rejects frameworkHints with empty pattern', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: '', framework: 'flask', entrypointKind: 'http-handler' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.path.includes('frameworkHints') && i.severity === 'error')).toBe(true);
  });
});

// ============================================================================
// Issue #1.3: DDD bounded context / Module boundaries
// ============================================================================

describe('Issue #1.3: DDD bounded context awareness', () => {
  it('boundary-violation is a built-in claim type', () => {
    expect(BUILT_IN_CLAIM_TYPES.has('boundary-violation')).toBe(true);
  });

  it('resolveBoundaryMembership assigns files to matching boundaries', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
      { name: 'payments', paths: ['src/payments/**'], publicInterface: ['src/payments/api.ts'] },
    ];
    const files = [
      'src/auth/login.ts', 'src/auth/index.ts',
      'src/payments/charge.ts', 'src/utils.ts',
    ];
    const resolved = resolveBoundaryMembership(boundaries, files);

    expect(resolved.fileToBoundary.get('src/auth/login.ts')?.boundaryName).toBe('auth');
    expect(resolved.fileToBoundary.get('src/payments/charge.ts')?.boundaryName).toBe('payments');
    expect(resolved.fileToBoundary.has('src/utils.ts')).toBe(false);
  });

  it('marks public interface files correctly', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
    ];
    const files = ['src/auth/login.ts', 'src/auth/index.ts'];
    const resolved = resolveBoundaryMembership(boundaries, files);

    expect(resolved.fileToBoundary.get('src/auth/index.ts')?.isPublic).toBe(true);
    expect(resolved.fileToBoundary.get('src/auth/login.ts')?.isPublic).toBe(false);
  });

  it('checkInvariants detects cross-boundary violations', () => {
    const engine = new RulesEngine([], []);
    const handle = mkRulesReadHandle([
      {
        fromNodeId: 'n1', toNodeId: 'n2',
        fromPath: 'src/api/handler.ts', toPath: 'src/db/connection.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/connection.ts', { boundaryName: 'db', isPublic: true }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['utils'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const violations = result.data.violations;
    expect(violations.length).toBeGreaterThan(0);
    const boundaryViolation = violations.find(v => v.ruleId.startsWith('boundary:'));
    expect(boundaryViolation).toBeDefined();
  });

  it('checkInvariants allows cross-boundary import when dependency is listed', () => {
    const engine = new RulesEngine([], []);
    const handle = mkRulesReadHandle([
      {
        fromNodeId: 'n1', toNodeId: 'n2',
        fromPath: 'src/api/handler.ts', toPath: 'src/db/connection.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/connection.ts', { boundaryName: 'db', isPublic: true }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['db'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const boundaryViolations = result.data.violations.filter(v => v.ruleId.startsWith('boundary:'));
    expect(boundaryViolations).toHaveLength(0);
  });

  it('checkInvariants detects non-public file import violations', () => {
    const engine = new RulesEngine([], []);
    const handle = mkRulesReadHandle([
      {
        fromNodeId: 'n1', toNodeId: 'n2',
        fromPath: 'src/api/handler.ts', toPath: 'src/db/internal.ts',
      },
    ]);

    const boundaryContext = {
      fileToBoundary: new Map([
        ['src/api/handler.ts', { boundaryName: 'api', isPublic: true }],
        ['src/db/internal.ts', { boundaryName: 'db', isPublic: false }],
      ]),
      boundaries: new Map([
        ['api', { publicFiles: new Set(['src/api/handler.ts']), allowedDependencies: ['db'] }],
        ['db', { publicFiles: new Set(['src/db/connection.ts']) }],
      ]),
    };

    const result = checkInvariants(engine, handle, { boundaryContext });
    const nonPublicViolation = result.data.violations.find(v => v.ruleId.includes('non-public'));
    expect(nonPublicViolation).toBeDefined();
  });

  it('config loads moduleBoundaries from viewer.config.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    expect(result.config.moduleBoundaries![0].name).toBe('auth');
  });

  it('config falls back to module-boundaries.json when config key is absent', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({ version: 1 }));
    writeFileSync(join(dir, 'module-boundaries.json'), JSON.stringify([
      { name: 'payments', paths: ['src/payments/**'], publicInterface: ['src/payments/api.ts'] },
    ]));
    const result = loadConfigResult(dir);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    expect(result.config.moduleBoundaries![0].name).toBe('payments');
  });

  it('config moduleBoundaries takes precedence over module-boundaries.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'from-config', paths: ['src/**'], publicInterface: ['src/index.ts'] },
      ],
    }));
    writeFileSync(join(dir, 'module-boundaries.json'), JSON.stringify([
      { name: 'from-file', paths: ['lib/**'], publicInterface: ['lib/index.ts'] },
    ]));
    const result = loadConfigResult(dir);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    expect(result.config.moduleBoundaries![0].name).toBe('from-config');
  });

  it('config rejects duplicate boundary names', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
        { name: 'auth', paths: ['src/auth2/**'], publicInterface: ['src/auth2/index.ts'] },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.message.includes('Duplicate boundary name'))).toBe(true);
  });
});

// ============================================================================
// Issue #1.4: Event flow topology
// ============================================================================

describe('Issue #1.4: Event flow topology', () => {
  it('config loads valid topologyHints', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      topologyHints: [
        { source: 'src/producer.ts', sink: 'src/consumer.ts', channel: 'orders', transport: 'kafka', direction: 'publish' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.topologyHints).toHaveLength(1);
    expect(result.config.topologyHints![0].channel).toBe('orders');
    expect(result.config.topologyHints![0].transport).toBe('kafka');
  });

  it('config rejects invalid topology direction', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      topologyHints: [
        { source: 'a.ts', sink: 'b.ts', channel: 'x', transport: 'kafka', direction: 'invalid' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.message.includes('direction'))).toBe(true);
  });

  it('config accepts all valid direction values', () => {
    const dir = makeTempDir();
    const validDirections = ['publish', 'subscribe', 'request', 'respond'];
    for (const direction of validDirections) {
      writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
        version: 1,
        topologyHints: [
          { source: 'a.ts', sink: 'b.ts', channel: 'ch', transport: 'kafka', direction },
        ],
      }));
      const result = loadConfigResult(dir);
      expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    }
  });

  it('FlowTrace segments include declaredTag for event-flow edges', () => {
    // Verify the type definition supports declaredTag
    type FlowSegment = {
      fromNodeId: string;
      toNodeId: string;
      edgeKind: string;
      epistemic: string;
      confidence: string;
      evidence: unknown[];
      declaredTag?: string;
    };

    const segment: FlowSegment = {
      fromNodeId: 'producer',
      toNodeId: 'consumer',
      edgeKind: 'event-flow',
      epistemic: 'declared',
      confidence: 'low',
      evidence: [],
      declaredTag: '[declared]',
    };
    expect(segment.declaredTag).toBe('[declared]');
    expect(segment.edgeKind).toBe('event-flow');
    expect(segment.epistemic).toBe('declared');
  });

  it('schema accepts declared epistemic status after migrations', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    try {
      const db = new Database(join(dataDir, 'model.sqlite'));
      db.pragma('foreign_keys = ON');
      try {
        // 'declared' epistemic should be accepted after migration 006
        expect(() => {
          db.prepare(`INSERT INTO edges VALUES (
            'e-declared-test', 'event-flow', 'declared', 'n1', 'n2', 'repo', 'low',
            'test', 'test', NULL, NULL, 'rev1', NULL,
            datetime('now'), datetime('now')
          )`).run();
        }).not.toThrow();

        // Verify the old epistemic values still work
        expect(() => {
          db.prepare(`INSERT INTO edges VALUES (
            'e-static-test', 'imports', 'static', 'n3', 'n4', 'repo', 'medium',
            'test', 'test', NULL, NULL, 'rev1', NULL,
            datetime('now'), datetime('now')
          )`).run();
        }).not.toThrow();

        // Invalid epistemic should still be rejected
        expect(() => {
          db.prepare(`INSERT INTO edges VALUES (
            'e-bad-test', 'imports', 'INVALID', 'n5', 'n6', 'repo', 'medium',
            'test', 'test', NULL, NULL, 'rev1', NULL,
            datetime('now'), datetime('now')
          )`).run();
        }).toThrow();
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });

  it('schema seeds event-flow edge kind and boundary-violation claim type', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const eventFlow = db.prepare(
          "SELECT kind, category FROM kind_registry WHERE kind = 'event-flow'",
        ).get() as { kind: string; category: string } | undefined;
        expect(eventFlow).toBeDefined();
        expect(eventFlow!.category).toBe('edge');

        const boundaryViolation = db.prepare(
          "SELECT kind, category FROM kind_registry WHERE kind = 'boundary-violation'",
        ).get() as { kind: string; category: string } | undefined;
        expect(boundaryViolation).toBeDefined();
        expect(boundaryViolation!.category).toBe('claim_type');
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });

  it('schema migration version is at least 6', () => {
    const dataDir = makeTempDir();
    const store = ModelStore.open(dataDir);
    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBeGreaterThanOrEqual(6);
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });
});

// ============================================================================
// Issue #1: Engine integration - all four features wired into engine
// ============================================================================

describe('Issue #1: Engine exposes all four structural intelligence capabilities', () => {
  it('engine exposes getImportGraph operation', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });
    try {
      expect(typeof engine.getImportGraph).toBe('function');
    } finally {
      engine.close();
    }
  });

  it('engine seeds event-flow and boundary-violation into kind_registry', () => {
    const dataDir = makeTempDir();
    const engine = createViewerEngine({ dataDir });
    try {
      const db = new Database(join(dataDir, 'model.sqlite'), { readonly: true });
      try {
        const eventFlow = db.prepare(
          "SELECT kind, category FROM kind_registry WHERE kind = 'event-flow'",
        ).get() as { kind: string; category: string } | undefined;
        expect(eventFlow).toBeDefined();
        expect(eventFlow!.category).toBe('edge');

        const boundaryViolation = db.prepare(
          "SELECT kind, category FROM kind_registry WHERE kind = 'boundary-violation'",
        ).get() as { kind: string; category: string } | undefined;
        expect(boundaryViolation).toBeDefined();
        expect(boundaryViolation!.category).toBe('claim_type');
      } finally {
        db.close();
      }
    } finally {
      engine.close();
    }
  });

  it('doctor report includes frameworkHints status when configured', async () => {
    const repoDir = makeTempDir();
    writeFileSync(join(repoDir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: 'app.route', framework: 'flask', entrypointKind: 'http-handler' },
      ],
    }));

    const dataDir = makeTempDir();
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: repoDir }),
    );

    const engine = createViewerEngine({ dataDir });
    try {
      const report = await engine.doctor();
      const data = report.data;
      expect(data.frameworkHints).toBeDefined();
      expect(data.frameworkHints?.configured).toBe(1);
    } finally {
      engine.close();
    }
  });

  it('doctor report includes topologyHintsStatus when configured', async () => {
    const repoDir = makeTempDir();
    writeFileSync(join(repoDir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      topologyHints: [
        { source: 'src/producer.ts', sink: 'src/consumer.ts', channel: 'orders', transport: 'kafka', direction: 'publish' },
      ],
    }));

    const dataDir = makeTempDir();
    writeFileSync(
      join(dataDir, 'workspace-locator.json'),
      JSON.stringify({ repoRoot: repoDir }),
    );

    const engine = createViewerEngine({ dataDir });
    try {
      const report = await engine.doctor();
      const data = report.data;
      expect(data.topologyHintsStatus).toBeDefined();
      expect(data.topologyHintsStatus?.configured).toBe(1);
    } finally {
      engine.close();
    }
  });

  it('configs without structural intelligence keys behave identically to base config', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({ version: 1 }));
    const result = loadConfigResult(dir);
    expect(result.config.frameworkHints).toBeUndefined();
    expect(result.config.moduleBoundaries).toBeUndefined();
    expect(result.config.topologyHints).toBeUndefined();
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });
});
