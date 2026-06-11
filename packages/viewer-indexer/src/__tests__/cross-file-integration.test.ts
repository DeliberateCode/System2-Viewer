/**
 * Integration tests for cross-file resolution via GlobalSymbolMap.
 *
 * These tests exercise the full indexing pipeline (real ModelStore, real
 * tree-sitter extraction when grammars are available) and verify that
 * cross-file import edges are created through the GlobalSymbolMap fallback
 * for Python, Rust, and Go.
 *
 * Each test scenario builds a small multi-file fixture on disk, indexes it
 * with the Indexer, and queries the store to verify edges.
 *

 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '@system2-viewer/viewer-store';
import { deriveRepositoryId } from '@system2-viewer/viewer-core';
import { Indexer } from '../indexer.js';

// ---------------------------------------------------------------------------
// Grammar availability probes
// ---------------------------------------------------------------------------

function isGrammarInstalled(pkgName: string): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve(`${pkgName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

const HAS_PYTHON_GRAMMAR = isGrammarInstalled('tree-sitter-python');
const HAS_RUST_GRAMMAR = isGrammarInstalled('tree-sitter-rust');
const HAS_GO_GRAMMAR = isGrammarInstalled('tree-sitter-go');

// ---------------------------------------------------------------------------
// Scenario 1: Python 3-file cross-file resolution
// File A imports `bar` from file B (module path does not resolve via file-path)
// ---------------------------------------------------------------------------
describe('Python cross-file resolution via GlobalSymbolMap', () => {
  let fixtureDir: string;
  let dataDir: string;
  let store: ModelStore;
  let revision: string;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'py-cross-file-'));
    dataDir = mkdtempSync(join(tmpdir(), 'py-cross-file-data-'));

    // File A: imports `bar` from a module that file-path resolution cannot resolve
    mkdirSync(join(fixtureDir, 'app'), { recursive: true });
    writeFileSync(join(fixtureDir, 'app', 'main.py'), `
from external_lib import bar

def run():
    return bar()
`);

    // File B: defines `bar`
    mkdirSync(join(fixtureDir, 'lib'), { recursive: true });
    writeFileSync(join(fixtureDir, 'lib', 'helpers.py'), `
def bar():
    return 42

def baz():
    return 99
`);

    // File C: unrelated file
    writeFileSync(join(fixtureDir, 'lib', 'other.py'), `
def unrelated():
    return 0
`);

    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }, 60_000);

  afterAll(() => {
    if (store) store.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!HAS_PYTHON_GRAMMAR)(
    'creates import edge from A to B via symbol map with medium confidence',
    () => {
      const rh = store.read();
      try {
        const repoId = deriveRepositoryId(fixtureDir);
        const mainFileId = `node::file::${repoId}::app/main.py`;
        const helpersFileId = `node::file::${repoId}::lib/helpers.py`;

        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const toHelpers = edges.filter((e) => e.toNodeId === helpersFileId);

        // `from external_lib import bar` cannot resolve via file-path
        // (no external_lib.py or external_lib/__init__.py in the fixture).
        // The GlobalSymbolMap should find `bar` in lib/helpers.py and
        // create an inferred edge with medium confidence (single match).
        expect(toHelpers.length).toBeGreaterThanOrEqual(1);
        expect(toHelpers[0]!.confidenceBand).toBe('medium');
        expect(toHelpers[0]!.epistemic).toBe('inferred');
      } finally {
        rh.close();
      }
    },
  );

  it.skipIf(!HAS_PYTHON_GRAMMAR)(
    'does NOT create an edge from A to unrelated file C',
    () => {
      const rh = store.read();
      try {
        const repoId = deriveRepositoryId(fixtureDir);
        const mainFileId = `node::file::${repoId}::app/main.py`;
        const otherFileId = `node::file::${repoId}::lib/other.py`;

        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const toOther = edges.filter((e) => e.toNodeId === otherFileId);
        expect(toOther).toHaveLength(0);
      } finally {
        rh.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario 2: Rust cross-crate resolution
// File A uses `pub fn process` from file B via an unresolvable crate path.
// ---------------------------------------------------------------------------
describe('Rust cross-crate resolution via GlobalSymbolMap', () => {
  let fixtureDir: string;
  let dataDir: string;
  let store: ModelStore;
  let revision: string;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'rs-cross-file-'));
    dataDir = mkdtempSync(join(tmpdir(), 'rs-cross-file-data-'));

    // File A: uses a symbol from an external crate that does not resolve via file-path
    mkdirSync(join(fixtureDir, 'src'), { recursive: true });
    writeFileSync(join(fixtureDir, 'src', 'main.rs'), `
use external_crate::process;

fn main() {
    process();
}
`);

    // File B: defines `pub fn process`
    writeFileSync(join(fixtureDir, 'src', 'worker.rs'), `
pub fn process() {
    println!("processing");
}

fn private_helper() {
    // not visible
}
`);

    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }, 60_000);

  afterAll(() => {
    if (store) store.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!HAS_RUST_GRAMMAR)(
    'creates import edge from A to B via symbol map with medium confidence',
    () => {
      const rh = store.read();
      try {
        const repoId = deriveRepositoryId(fixtureDir);
        const mainFileId = `node::file::${repoId}::src/main.rs`;
        const workerFileId = `node::file::${repoId}::src/worker.rs`;

        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const toWorker = edges.filter((e) => e.toNodeId === workerFileId);

        // `use external_crate::process` is not resolvable via file-path
        // (external_crate is not crate::, super::, or self::).
        // The GlobalSymbolMap should find `process` in src/worker.rs.
        expect(toWorker.length).toBeGreaterThanOrEqual(1);
        expect(toWorker[0]!.confidenceBand).toBe('medium');
        expect(toWorker[0]!.epistemic).toBe('inferred');
      } finally {
        rh.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: Go cross-package resolution via GlobalSymbolMap
// The Go visitor extracts the last segment of the import path as the name
// (via defaultPkgName). When that name matches an exported symbol in the
// global symbol map, an edge is created.
// ---------------------------------------------------------------------------
describe('Go cross-package resolution via GlobalSymbolMap', () => {
  let fixtureDir: string;
  let dataDir: string;
  let store: ModelStore;
  let revision: string;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'go-cross-file-'));
    dataDir = mkdtempSync(join(tmpdir(), 'go-cross-file-data-'));

    // File A: imports a package whose last segment "Transform" matches a symbol name
    // in file B. The Go visitor uses defaultPkgName to extract the last segment
    // as the import name.
    mkdirSync(join(fixtureDir, 'cmd'), { recursive: true });
    writeFileSync(join(fixtureDir, 'cmd', 'main.go'), `
package main

import (
	"github.com/org/repo/Transform"
)

func main() {
	Transform()
}
`);

    // File B: defines exported function `Transform`
    mkdirSync(join(fixtureDir, 'internal'), { recursive: true });
    writeFileSync(join(fixtureDir, 'internal', 'transform.go'), `
package compute

func Transform() string {
	return "transformed"
}

func helper() string {
	return "internal"
}
`);

    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }, 60_000);

  afterAll(() => {
    if (store) store.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!HAS_GO_GRAMMAR)(
    'creates import edge when last path segment matches a symbol name',
    () => {
      const rh = store.read();
      try {
        const repoId = deriveRepositoryId(fixtureDir);
        const mainFileId = `node::file::${repoId}::cmd/main.go`;
        const transformFileId = `node::file::${repoId}::internal/transform.go`;

        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const toTransform = edges.filter((e) => e.toNodeId === transformFileId);

        // The Go visitor extracts:
        //   specifier: "github.com/org/repo/Transform", names: ["Transform"]
        // File-path resolution fails (no directory suffix matches).
        // The GlobalSymbolMap should find `Transform` in internal/transform.go
        // and create an edge with medium confidence (single match).
        expect(toTransform.length).toBeGreaterThanOrEqual(1);
        expect(toTransform[0]!.confidenceBand).toBe('medium');
        expect(toTransform[0]!.epistemic).toBe('inferred');
      } finally {
        rh.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario 4: Ambiguity handling
// `Process` is defined in both file B and file C. File A imports `Process`.
// ---------------------------------------------------------------------------
describe('Ambiguous symbol resolution via GlobalSymbolMap', () => {
  let fixtureDir: string;
  let dataDir: string;
  let store: ModelStore;
  let revision: string;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'ambig-cross-file-'));
    dataDir = mkdtempSync(join(tmpdir(), 'ambig-cross-file-data-'));

    // File A: imports Process from an unresolvable module
    mkdirSync(join(fixtureDir, 'app'), { recursive: true });
    writeFileSync(join(fixtureDir, 'app', 'main.py'), `
from some_external_module import Process

def run():
    return Process()
`);

    // File B: defines Process
    mkdirSync(join(fixtureDir, 'services'), { recursive: true });
    writeFileSync(join(fixtureDir, 'services', 'handler.py'), `
def Process():
    return "handled"
`);

    // File C: also defines Process
    mkdirSync(join(fixtureDir, 'utils'), { recursive: true });
    writeFileSync(join(fixtureDir, 'utils', 'processor.py'), `
def Process():
    return "processed"
`);

    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }, 60_000);

  afterAll(() => {
    if (store) store.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!HAS_PYTHON_GRAMMAR)(
    'creates 2 edges with low confidence when symbol is ambiguous',
    () => {
      const rh = store.read();
      try {
        const repoId = deriveRepositoryId(fixtureDir);
        const mainFileId = `node::file::${repoId}::app/main.py`;
        const handlerFileId = `node::file::${repoId}::services/handler.py`;
        const processorFileId = `node::file::${repoId}::utils/processor.py`;

        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const importEdges = edges.filter(
          (e) => e.toNodeId === handlerFileId || e.toNodeId === processorFileId,
        );

        // `from some_external_module import Process` cannot resolve via file-path.
        // The GlobalSymbolMap finds `Process` in both handler.py and processor.py.
        // This should create 2 edges with low confidence (ambiguous).
        expect(importEdges).toHaveLength(2);

        const toFileIds = importEdges.map((e) => e.toNodeId).sort();
        expect(toFileIds).toEqual(
          [handlerFileId, processorFileId].sort(),
        );

        for (const edge of importEdges) {
          expect(edge.confidenceBand).toBe('low');
          expect(edge.epistemic).toBe('inferred');
        }
      } finally {
        rh.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario 5: No false positives -- TypeScript path-resolved imports
// should NOT use the symbol map and should NOT produce duplicate edges.
// ---------------------------------------------------------------------------
describe('TypeScript no-false-positive: path resolution only', () => {
  let fixtureDir: string;
  let dataDir: string;
  let store: ModelStore;
  let revision: string;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'ts-no-dup-'));
    dataDir = mkdtempSync(join(tmpdir(), 'ts-no-dup-data-'));

    // File A: imports helper from file B using a relative path
    mkdirSync(join(fixtureDir, 'src'), { recursive: true });
    writeFileSync(join(fixtureDir, 'src', 'main.ts'), `
import { helper } from './utils.js';

export function run() {
  return helper();
}
`);

    // File B: exports helper
    writeFileSync(join(fixtureDir, 'src', 'utils.ts'), `
export function helper(): string {
  return "ok";
}
`);

    // File C: also exports helper (different file, same name)
    writeFileSync(join(fixtureDir, 'src', 'other.ts'), `
export function helper(): string {
  return "other";
}
`);

    store = ModelStore.open(dataDir);
    const indexer = new Indexer(store);
    const result = await indexer.index({ repoRoot: fixtureDir });
    revision = result.revision;
  }, 60_000);

  afterAll(() => {
    if (store) store.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('resolves via path only, no symbol map fallback for TypeScript', () => {
    const rh = store.read();
    try {
      const repoId = deriveRepositoryId(fixtureDir);
      const mainFileId = `node::file::${repoId}::src/main.ts`;
      const utilsFileId = `node::file::${repoId}::src/utils.ts`;
      const otherFileId = `node::file::${repoId}::src/other.ts`;

      const edges = rh.neighbors(mainFileId, 'imports', 1);
      const toUtils = edges.filter((e) => e.toNodeId === utilsFileId);
      const toOther = edges.filter((e) => e.toNodeId === otherFileId);

      // The path-based resolution should find src/utils.ts (high confidence).
      // The symbol map should NOT be consulted for TypeScript, so there should
      // be exactly one edge to utils.ts and zero edges to other.ts.
      expect(toUtils).toHaveLength(1);
      expect(toUtils[0]!.confidenceBand).toBe('high');
      expect(toUtils[0]!.epistemic).toBe('static');

      // No edge to other.ts (symbol map not used for TS)
      expect(toOther).toHaveLength(0);
    } finally {
      rh.close();
    }
  });

  it('no duplicate edges for path-resolved imports', () => {
    const rh = store.read();
    try {
      const repoId = deriveRepositoryId(fixtureDir);
      const mainFileId = `node::file::${repoId}::src/main.ts`;
      const utilsFileId = `node::file::${repoId}::src/utils.ts`;

      const edges = rh.neighbors(mainFileId, 'imports', 1);
      const toUtils = edges.filter((e) => e.toNodeId === utilsFileId);

      // Should be exactly 1 edge, not 2 (no symbol-map duplicate)
      expect(toUtils).toHaveLength(1);
    } finally {
      rh.close();
    }
  });
});
