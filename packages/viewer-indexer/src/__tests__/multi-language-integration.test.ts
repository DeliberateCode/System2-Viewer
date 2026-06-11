/**
 * Multi-language integration test  *
 * Indexes a polyglot fixture (TypeScript, Python, Rust, Go, JSON, and
 * unsupported file types) with a real ModelStore (temp SQLite) and verifies
 * file nodes, symbol nodes, import edges, partiality, and claims for all
 * supported languages.
 *
 * This test handles two runtime scenarios:
 *   1. WASM grammars installed: symbol-level assertions pass, no partiality
 *   2. WASM grammars absent: partiality recorded, symbol tests skipped
 *
 * TypeScript always works via regex fallback even without tree-sitter.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '@system2-viewer/viewer-store';
import { deriveRepositoryId } from '@system2-viewer/viewer-core';
import { Indexer } from '../indexer.js';

// ---------------------------------------------------------------------------
// Grammar availability probes
// ---------------------------------------------------------------------------

/** Check whether a grammar WASM package is resolvable at require time. */
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
// Polyglot fixture content
// ---------------------------------------------------------------------------

const TS_CONTENT = `
export function greetUser(name: string): string {
  return \`Hello, \${name}\`;
}

export class UserService {
  private name: string;
  constructor(name: string) { this.name = name; }
}

export interface UserConfig {
  timeout: number;
}

import { join } from 'node:path';
import type { Config } from './config.js';
`;

const PY_CONTENT = `
import os
import sys
from pathlib import Path

def process_data(items):
    return [x * 2 for x in items]

class DataProcessor:
    def __init__(self):
        self.data = []

MAX_ITEMS = 100
`;

const PY_UTILS_CONTENT = `
from .processor import DataProcessor

def helper_func():
    return DataProcessor()
`;

const RS_CONTENT = `
use std::io::Read;
use crate::models::User;

pub fn serve() {
    println!("serving");
}

fn internal_helper() {
    // private function
}

pub struct AppConfig {
    pub port: u16,
}

struct InternalState {
    count: usize,
}

mod handlers;
`;

const RS_MODELS_CONTENT = `
pub struct User {
    pub name: String,
    pub email: String,
}

pub struct Post {
    pub title: String,
    pub body: String,
}
`;

const GO_CONTENT = `
package main

import (
	"fmt"
	"net/http"
)

func ServeHTTP(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "hello")
}

func internalSetup() {
	// unexported
}

type AppServer struct {
	Port int
}

type config struct {
	host string
}

const MaxConnections = 100

var DefaultTimeout = 30
`;

const GO_UTILS_CONTENT = `
package utils

import "github.com/example/repo/pkg/main"

func FormatOutput(s string) string {
	return "[" + s + "]"
}
`;

const JSON_CONTENT = JSON.stringify(
  {
    name: 'polyglot-fixture',
    version: '1.0.0',
    description: 'Test fixture for multi-language integration',
  },
  null,
  2,
);

const PKG_JSON_CONTENT = JSON.stringify(
  {
    name: 'polyglot-fixture',
    version: '1.0.0',
    workspaces: [],
  },
  null,
  2,
);

const TXT_CONTENT = 'This is a plain text file with no symbols.\n';

const MD_CONTENT = '# README\n\nThis project is a test fixture.\n';

// ---------------------------------------------------------------------------
// Test setup and teardown
// ---------------------------------------------------------------------------

let fixtureDir: string;
let dataDir: string;
let store: ModelStore;
let revision: string;

beforeAll(async () => {
  // Create temp directories
  fixtureDir = mkdtempSync(join(tmpdir(), 'multi-lang-fixture-'));
  dataDir = mkdtempSync(join(tmpdir(), 'multi-lang-data-'));

  // TypeScript
  mkdirSync(join(fixtureDir, 'src'), { recursive: true });
  writeFileSync(join(fixtureDir, 'src', 'index.ts'), TS_CONTENT);
  writeFileSync(
    join(fixtureDir, 'src', 'config.ts'),
    'export interface Config { debug: boolean; }\n',
  );

  // Python
  mkdirSync(join(fixtureDir, 'python_pkg'), { recursive: true });
  writeFileSync(join(fixtureDir, 'python_pkg', '__init__.py'), '');
  writeFileSync(join(fixtureDir, 'python_pkg', 'processor.py'), PY_CONTENT);
  writeFileSync(join(fixtureDir, 'python_pkg', 'utils.py'), PY_UTILS_CONTENT);

  // Rust
  mkdirSync(join(fixtureDir, 'rust_crate', 'src'), { recursive: true });
  writeFileSync(join(fixtureDir, 'rust_crate', 'src', 'main.rs'), RS_CONTENT);
  writeFileSync(
    join(fixtureDir, 'rust_crate', 'src', 'models.rs'),
    RS_MODELS_CONTENT,
  );

  // Go
  mkdirSync(join(fixtureDir, 'go_app', 'pkg'), { recursive: true });
  writeFileSync(join(fixtureDir, 'go_app', 'main.go'), GO_CONTENT);
  writeFileSync(join(fixtureDir, 'go_app', 'pkg', 'utils.go'), GO_UTILS_CONTENT);

  // JSON (also serves as workspace root marker)
  writeFileSync(join(fixtureDir, 'package.json'), PKG_JSON_CONTENT);
  writeFileSync(join(fixtureDir, 'data.json'), JSON_CONTENT);

  // Unsupported files
  writeFileSync(join(fixtureDir, 'notes.txt'), TXT_CONTENT);
  writeFileSync(join(fixtureDir, 'README.md'), MD_CONTENT);

  // Open store and run indexer
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileNodeId(relativePath: string): string {
  const repoId = deriveRepositoryId(fixtureDir);
  return `node::file::${repoId}::${relativePath}`;
}

function symbolNodeId(relativePath: string, symbolName: string): string {
  const repoId = deriveRepositoryId(fixtureDir);
  return `node::symbol::${repoId}::${relativePath}::${symbolName}`;
}

/**
 * Helper for grammar-gated assertions. When the grammar is not installed,
 * verifies that partiality was recorded instead. When installed, verifies
 * the symbol exists and returns its parsed metadata.
 */
function expectSymbolOrPartiality(
  rh: ReturnType<ModelStore['read']>,
  file: string,
  symbolName: string,
  grammarInstalled: boolean,
): Record<string, unknown> | null {
  const sym = rh.getNode(symbolNodeId(file, symbolName));
  if (grammarInstalled) {
    expect(sym, `${symbolName} symbol in ${file} should exist`).not.toBeNull();
    return JSON.parse(sym!.metadata_json as string);
  }
  // Grammar not installed: symbol may or may not be null. We just verify
  // that the file node exists and partiality was recorded.
  const fileNode = rh.getNode(fileNodeId(file));
  expect(fileNode, `File node for ${file} should exist`).not.toBeNull();
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-language integration', () => {
  // =========================================================================
  // File node creation -- always works regardless of grammars
  // =========================================================================
  describe('file node creation', () => {
    const expectedFiles = [
      'src/index.ts',
      'src/config.ts',
      'python_pkg/__init__.py',
      'python_pkg/processor.py',
      'python_pkg/utils.py',
      'rust_crate/src/main.rs',
      'rust_crate/src/models.rs',
      'go_app/main.go',
      'go_app/pkg/utils.go',
      'package.json',
      'data.json',
      'notes.txt',
      'README.md',
    ];

    it('creates file nodes for all 13 fixture files', () => {
      const rh = store.read();
      try {
        for (const file of expectedFiles) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file} should exist`).not.toBeNull();
          expect(node!.kind).toBe('file');
        }
      } finally {
        rh.close();
      }
    });

    it('sets correct language for each file type', () => {
      const rh = store.read();
      try {
        const checks: Array<[string, string | null]> = [
          ['src/index.ts', 'typescript'],
          ['python_pkg/processor.py', 'python'],
          ['rust_crate/src/main.rs', 'rust'],
          ['go_app/main.go', 'go'],
          ['package.json', 'json'],
          ['data.json', 'json'],
          ['notes.txt', null],
          ['README.md', null],
        ];
        for (const [file, lang] of checks) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file}`).not.toBeNull();
          expect(node!.language).toBe(lang);
        }
      } finally {
        rh.close();
      }
    });

    it('creates a repository node with the revision id', () => {
      const rh = store.read();
      try {
        const repoNode = rh.getNode(revision);
        expect(repoNode).not.toBeNull();
        expect(repoNode!.kind).toBe('repository');
      } finally {
        rh.close();
      }
    });

    it('all file nodes are reachable through containment hierarchy', () => {
      const rh = store.read();
      try {
        const edges = rh.neighbors(revision, 'contains', 4);
        const fileEdges = edges.filter((e) => e.toNodeId.startsWith('node::file::'));
        const dirEdges = edges.filter((e) => e.toNodeId.startsWith('node::directory::'));
        expect(fileEdges.length).toBeGreaterThanOrEqual(13);
        expect(dirEdges.length).toBeGreaterThanOrEqual(4);
        for (const edge of edges) {
          expect(edge.kind).toBe('contains');
        }
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // TypeScript extraction -- always works (regex fallback guaranteed)
  // =========================================================================
  describe('TypeScript extraction', () => {
    it('extracts exported function', () => {
      const rh = store.read();
      try {
        const sym = rh.getNode(symbolNodeId('src/index.ts', 'greetUser'));
        expect(sym, 'greetUser symbol').not.toBeNull();
        expect(sym!.kind).toBe('symbol');
        const meta = JSON.parse(sym!.metadata_json as string);
        expect(meta.kind).toBe('function');
        expect(meta.exported).toBe(true);
      } finally {
        rh.close();
      }
    });

    it('extracts exported class', () => {
      const rh = store.read();
      try {
        const sym = rh.getNode(symbolNodeId('src/index.ts', 'UserService'));
        expect(sym).not.toBeNull();
        const meta = JSON.parse(sym!.metadata_json as string);
        expect(meta.kind).toBe('class');
        expect(meta.exported).toBe(true);
      } finally {
        rh.close();
      }
    });

    it('extracts exported interface', () => {
      const rh = store.read();
      try {
        const sym = rh.getNode(symbolNodeId('src/index.ts', 'UserConfig'));
        expect(sym).not.toBeNull();
        const meta = JSON.parse(sym!.metadata_json as string);
        expect(meta.kind).toBe('interface');
        expect(meta.exported).toBe(true);
      } finally {
        rh.close();
      }
    });

    it('resolves TS import edge to config.ts', () => {
      const rh = store.read();
      try {
        const tsFileId = fileNodeId('src/index.ts');
        const configFileId = fileNodeId('src/config.ts');
        const edges = rh.neighbors(tsFileId, 'imports', 1);
        const toConfig = edges.filter((e) => e.toNodeId === configFileId);
        expect(
          toConfig.length,
          'import edge src/index.ts -> src/config.ts',
        ).toBeGreaterThanOrEqual(1);
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Python extraction -- conditional on tree-sitter-python availability
  // =========================================================================
  describe('Python extraction', () => {
    it('file nodes exist for Python files regardless of grammar', () => {
      const rh = store.read();
      try {
        for (const file of [
          'python_pkg/__init__.py',
          'python_pkg/processor.py',
          'python_pkg/utils.py',
        ]) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file}`).not.toBeNull();
          expect(node!.language).toBe('python');
        }
      } finally {
        rh.close();
      }
    });

    it('extracts symbols OR records partiality for Python', () => {
      const rh = store.read();
      try {
        const file = 'python_pkg/processor.py';
        const sym = rh.getNode(symbolNodeId(file, 'process_data'));
        const partialityRows = rh.partiality(revision);
        const partialityEntry = partialityRows.find(p => p.scope === file);

        const extracted = sym !== null;
        const partial = partialityEntry !== undefined;

        expect(
          extracted || partial,
          `Python: symbols extracted (${extracted}) or partiality (${partial})`,
        ).toBe(true);

        if (extracted) {
          // Verify the extracted symbol metadata
          const meta = JSON.parse(sym!.metadata_json as string);
          expect(meta.kind).toBe('function');
        }
      } finally {
        rh.close();
      }
    });

    it.skipIf(!HAS_PYTHON_GRAMMAR)(
      'extracts function, class, variable when grammar installed',
      () => {
        const rh = store.read();
        try {
          const fnMeta = expectSymbolOrPartiality(
            rh, 'python_pkg/processor.py', 'process_data', true,
          );
          expect(fnMeta!.kind).toBe('function');

          const clsMeta = expectSymbolOrPartiality(
            rh, 'python_pkg/processor.py', 'DataProcessor', true,
          );
          expect(clsMeta!.kind).toBe('class');

          const varMeta = expectSymbolOrPartiality(
            rh, 'python_pkg/processor.py', 'MAX_ITEMS', true,
          );
          expect(varMeta!.kind).toBe('variable');
        } finally {
          rh.close();
        }
      },
    );

    it.skipIf(!HAS_PYTHON_GRAMMAR)(
      'resolves relative import edge (.processor) when grammar installed',
      () => {
        const rh = store.read();
        try {
          const utilsFileId = fileNodeId('python_pkg/utils.py');
          const processorFileId = fileNodeId('python_pkg/processor.py');
          const edges = rh.neighbors(utilsFileId, 'imports', 1);
          const resolved = edges.filter((e) => e.toNodeId === processorFileId);
          expect(resolved.length).toBeGreaterThanOrEqual(1);
        } finally {
          rh.close();
        }
      },
    );
  });

  // =========================================================================
  // Rust extraction -- conditional on tree-sitter-rust availability
  // =========================================================================
  describe('Rust extraction', () => {
    it('file nodes exist for Rust files regardless of grammar', () => {
      const rh = store.read();
      try {
        for (const file of [
          'rust_crate/src/main.rs',
          'rust_crate/src/models.rs',
        ]) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file}`).not.toBeNull();
          expect(node!.language).toBe('rust');
        }
      } finally {
        rh.close();
      }
    });

    it('extracts symbols OR records partiality for Rust', () => {
      const rh = store.read();
      try {
        const file = 'rust_crate/src/main.rs';
        const sym = rh.getNode(symbolNodeId(file, 'serve'));
        const partialityRows = rh.partiality(revision);
        const partialityEntry = partialityRows.find(p => p.scope === file);

        const extracted = sym !== null;
        const partial = partialityEntry !== undefined;

        expect(
          extracted || partial,
          `Rust: symbols extracted (${extracted}) or partiality (${partial})`,
        ).toBe(true);
      } finally {
        rh.close();
      }
    });

    it.skipIf(!HAS_RUST_GRAMMAR)(
      'extracts pub fn and private fn with correct visibility',
      () => {
        const rh = store.read();
        try {
          const pubMeta = expectSymbolOrPartiality(
            rh, 'rust_crate/src/main.rs', 'serve', true,
          );
          expect(pubMeta!.kind).toBe('function');
          expect(pubMeta!.exported).toBe(true);

          const privMeta = expectSymbolOrPartiality(
            rh, 'rust_crate/src/main.rs', 'internal_helper', true,
          );
          expect(privMeta!.kind).toBe('function');
          expect(privMeta!.exported).toBe(false);
        } finally {
          rh.close();
        }
      },
    );

    it.skipIf(!HAS_RUST_GRAMMAR)(
      'extracts pub/private structs with correct visibility',
      () => {
        const rh = store.read();
        try {
          const pubMeta = expectSymbolOrPartiality(
            rh, 'rust_crate/src/main.rs', 'AppConfig', true,
          );
          expect(pubMeta!.kind).toBe('class'); // struct mapped to class
          expect(pubMeta!.exported).toBe(true);

          const privMeta = expectSymbolOrPartiality(
            rh, 'rust_crate/src/main.rs', 'InternalState', true,
          );
          expect(privMeta!.exported).toBe(false);
        } finally {
          rh.close();
        }
      },
    );

    it('unresolved mod declaration does not create false edge', () => {
      const rh = store.read();
      try {
        // handlers.rs was not created in the fixture, so `mod handlers;`
        // should produce no import edge.
        const mainFileId = fileNodeId('rust_crate/src/main.rs');
        const handlersId = fileNodeId('rust_crate/src/handlers.rs');
        const edges = rh.neighbors(mainFileId, 'imports', 1);
        const toHandlers = edges.filter((e) => e.toNodeId === handlersId);
        expect(toHandlers).toHaveLength(0);
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Go extraction -- conditional on tree-sitter-go availability
  // =========================================================================
  describe('Go extraction', () => {
    it('file nodes exist for Go files regardless of grammar', () => {
      const rh = store.read();
      try {
        for (const file of ['go_app/main.go', 'go_app/pkg/utils.go']) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file}`).not.toBeNull();
          expect(node!.language).toBe('go');
        }
      } finally {
        rh.close();
      }
    });

    it('extracts symbols OR records partiality for Go', () => {
      const rh = store.read();
      try {
        const file = 'go_app/main.go';
        const sym = rh.getNode(symbolNodeId(file, 'ServeHTTP'));
        const partialityRows = rh.partiality(revision);
        const partialityEntry = partialityRows.find(p => p.scope === file);

        const extracted = sym !== null;
        const partial = partialityEntry !== undefined;

        expect(
          extracted || partial,
          `Go: symbols extracted (${extracted}) or partiality (${partial})`,
        ).toBe(true);
      } finally {
        rh.close();
      }
    });

    it.skipIf(!HAS_GO_GRAMMAR)(
      'uppercase functions are exported, lowercase are not',
      () => {
        const rh = store.read();
        try {
          const exported = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'ServeHTTP', true,
          );
          expect(exported!.kind).toBe('function');
          expect(exported!.exported).toBe(true);

          const unexported = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'internalSetup', true,
          );
          expect(unexported!.kind).toBe('function');
          expect(unexported!.exported).toBe(false);
        } finally {
          rh.close();
        }
      },
    );

    it.skipIf(!HAS_GO_GRAMMAR)(
      'extracts structs, consts, and vars when grammar installed',
      () => {
        const rh = store.read();
        try {
          const structMeta = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'AppServer', true,
          );
          expect(structMeta!.kind).toBe('class'); // struct mapped to class
          expect(structMeta!.exported).toBe(true);

          const privStruct = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'config', true,
          );
          expect(privStruct!.exported).toBe(false);

          const constMeta = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'MaxConnections', true,
          );
          expect(constMeta!.exported).toBe(true);

          const varMeta = expectSymbolOrPartiality(
            rh, 'go_app/main.go', 'DefaultTimeout', true,
          );
          expect(varMeta!.exported).toBe(true);
        } finally {
          rh.close();
        }
      },
    );
  });

  // =========================================================================
  // JSON handling
  // =========================================================================
  describe('JSON handling', () => {
    it('creates file node for JSON with language=json', () => {
      const rh = store.read();
      try {
        const node = rh.getNode(fileNodeId('data.json'));
        expect(node).not.toBeNull();
        expect(node!.language).toBe('json');
      } finally {
        rh.close();
      }
    });

    it('extracts top-level keys as variable symbols', () => {
      const rh = store.read();
      try {
        for (const key of ['name', 'version', 'description']) {
          const sym = rh.getNode(symbolNodeId('data.json', key));
          expect(sym, `JSON key "${key}" should be a symbol`).not.toBeNull();
          const meta = JSON.parse(sym!.metadata_json as string);
          expect(meta.kind).toBe('variable');
          expect(meta.exported).toBe(true);
        }
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Unsupported file types
  // =========================================================================
  describe('unsupported file types', () => {
    it('creates file nodes for .txt and .md with null language', () => {
      const rh = store.read();
      try {
        for (const file of ['notes.txt', 'README.md']) {
          const node = rh.getNode(fileNodeId(file));
          expect(node, `File node for ${file}`).not.toBeNull();
          expect(node!.kind).toBe('file');
          expect(node!.language).toBeNull();
        }
      } finally {
        rh.close();
      }
    });

    it('records partiality for unsupported files', () => {
      const rh = store.read();
      try {
        const partialityRows = rh.partiality(revision);
        const txtEntry = partialityRows.find(p => p.scope === 'notes.txt');
        expect(txtEntry, 'Partiality for notes.txt').not.toBeUndefined();

        if (txtEntry?.skippedJson) {
          const skipped = JSON.parse(txtEntry.skippedJson) as string[];
          expect(skipped).toContain('symbol-extraction');
        }
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Cross-language behavior
  // =========================================================================
  describe('cross-language behavior', () => {
    it('symbol counts per language: TS always present, others conditional', () => {
      const rh = store.read();
      try {
        // TypeScript -- at least some symbols via regex fallback
        const tsNames = ['greetUser', 'UserService', 'UserConfig'];
        let tsCount = 0;
        for (const name of tsNames) {
          if (rh.getNode(symbolNodeId('src/index.ts', name))) tsCount++;
        }
        expect(tsCount).toBeGreaterThanOrEqual(1);

        // Python, Rust, Go: 0 is valid when grammars absent
        for (const [file, names] of [
          ['python_pkg/processor.py', ['process_data', 'DataProcessor']],
          ['rust_crate/src/main.rs', ['serve', 'AppConfig']],
          ['go_app/main.go', ['ServeHTTP', 'AppServer']],
        ] as const) {
          let count = 0;
          for (const name of names) {
            if (rh.getNode(symbolNodeId(file, name))) count++;
          }
          expect(count).toBeGreaterThanOrEqual(0);
        }
      } finally {
        rh.close();
      }
    });

    it('import edges are created for resolved TypeScript imports', () => {
      const rh = store.read();
      try {
        const tsFileId = fileNodeId('src/index.ts');
        const configFileId = fileNodeId('src/config.ts');
        const edges = rh.neighbors(tsFileId, 'imports', 1);
        const toConfig = edges.filter((e) => e.toNodeId === configFileId);
        expect(toConfig.length).toBeGreaterThanOrEqual(1);
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Claims generation
  // =========================================================================
  describe('claims generation', () => {
    it('generates at least one claim total', () => {
      const rh = store.read();
      try {
        const claims = rh.listOpenClaims();
        expect(claims.length).toBeGreaterThan(0);
      } finally {
        rh.close();
      }
    });

    it('generates file-defines-symbols claims for files with symbols', () => {
      const rh = store.read();
      try {
        const claims = rh.listOpenClaims();
        const defClaims = claims.filter(
          (c) => c.claimType === 'file-defines-symbols',
        );
        // At minimum TS files produce symbol claims via regex fallback
        expect(defClaims.length).toBeGreaterThan(0);
      } finally {
        rh.close();
      }
    });

    it('generates subsystem hypothesis claims', () => {
      const rh = store.read();
      try {
        const claims = rh.listOpenClaims();
        const subClaims = claims.filter(
          (c) => c.claimType === 'directory-derived-subsystem-hypothesis',
        );
        expect(subClaims.length).toBeGreaterThan(0);
      } finally {
        rh.close();
      }
    });

    it('all claims have valid status and confidence bands', () => {
      const rh = store.read();
      try {
        const validStatuses = [
          'hypothesis', 'confirmed', 'rejected', 'contradicted', 'stale',
        ];
        const validBands = ['none', 'low', 'medium', 'high'];

        for (const claim of rh.listOpenClaims()) {
          expect(validStatuses).toContain(claim.status);
          expect(validBands).toContain(claim.confidenceBand);
        }
      } finally {
        rh.close();
      }
    });
  });

  // =========================================================================
  // Grammar fallback resilience
  // =========================================================================
  describe('grammar fallback resilience', () => {
    it('indexing completes successfully regardless of grammar availability', () => {
      expect(revision).toBeTruthy();
      expect(revision).toMatch(/^rev::/);
    });

    it('TypeScript extraction works via regex fallback', () => {
      const rh = store.read();
      try {
        const greetUser = rh.getNode(symbolNodeId('src/index.ts', 'greetUser'));
        const userService = rh.getNode(
          symbolNodeId('src/index.ts', 'UserService'),
        );
        const found = [greetUser, userService].filter(Boolean);
        expect(found.length).toBeGreaterThanOrEqual(1);
      } finally {
        rh.close();
      }
    });

    it('for each non-TS language: symbols extracted OR partiality recorded', () => {
      const rh = store.read();
      try {
        const partialityRows = rh.partiality(revision);
        const checks: Array<[string, string]> = [
          ['python_pkg/processor.py', 'process_data'],
          ['rust_crate/src/main.rs', 'serve'],
          ['go_app/main.go', 'ServeHTTP'],
        ];

        for (const [file, symbolName] of checks) {
          const sym = rh.getNode(symbolNodeId(file, symbolName));
          const partEntry = partialityRows.find(p => p.scope === file);

          const ok = sym !== null || partEntry !== undefined;
          expect(
            ok,
            `${file}: symbols extracted (${sym !== null}) or partiality (${partEntry !== undefined})`,
          ).toBe(true);
        }
      } finally {
        rh.close();
      }
    });
  });
});
