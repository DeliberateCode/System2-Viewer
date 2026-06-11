/**
 * Tests for per-language import resolution.
 *
 * Covers Python, Rust, Go resolution strategies as well as
 * existing TypeScript resolution. Uses synthetic file maps
 * (no real filesystem or tree-sitter required).
 *
 */
import { describe, it, expect } from 'vitest';
import { resolveImports } from '../resolve-imports.js';
import { GlobalSymbolMap } from '../global-symbol-map.js';
import type { ImportInfo } from '../types.js';

// Helper to build the imports map expected by resolveImports
function mkImportMap(
  entries: Array<{
    fileId: string;
    relativePath: string;
    imports: ImportInfo[];
  }>,
): Map<string, { relativePath: string; imports: ImportInfo[] }> {
  const map = new Map<string, { relativePath: string; imports: ImportInfo[] }>();
  for (const e of entries) {
    map.set(e.fileId, { relativePath: e.relativePath, imports: e.imports });
  }
  return map;
}

function mkFileMap(
  entries: Record<string, string>,
): Map<string, string> {
  return new Map(Object.entries(entries));
}

function mkImport(specifier: string, names: string[] = []): ImportInfo {
  return { specifier, names, isTypeOnly: false, line: 1 };
}

// ---------------------------------------------------------------------------
// Python import resolution
// ---------------------------------------------------------------------------
describe('Python import resolution', () => {
  it('resolves absolute import to .py file', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('utils', ['utils'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
      'utils.py': 'node::file::r1::utils.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::utils.py');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('resolves dotted absolute import (foo.bar) to foo/bar.py', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::main.py',
        relativePath: 'main.py',
        imports: [mkImport('foo.bar', ['foo.bar'])],
      },
    ]);
    const fileMap = mkFileMap({
      'main.py': 'node::file::r1::main.py',
      'foo/bar.py': 'node::file::r1::foo/bar.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::foo/bar.py');
  });

  it('resolves dotted absolute import to __init__.py when .py not found', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::main.py',
        relativePath: 'main.py',
        imports: [mkImport('foo.bar', ['baz'])],
      },
    ]);
    const fileMap = mkFileMap({
      'main.py': 'node::file::r1::main.py',
      'foo/bar/__init__.py': 'node::file::r1::foo/bar/__init__.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::foo/bar/__init__.py');
  });

  it('resolves relative import (from . import x)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/pkg/main.py',
        relativePath: 'src/pkg/main.py',
        imports: [mkImport('.', ['utils'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/pkg/main.py': 'node::file::r1::src/pkg/main.py',
      'src/pkg/utils.py': 'node::file::r1::src/pkg/utils.py',
    });

    // from . import utils → resolve utils relative to current package (src/pkg/)
    // The specifier is "." and names includes "utils", but we resolve the module "."
    // which means current package → __init__.py
    // Actually per the task, from . import x → resolve relative to current dir
    // The specifier "." means the current package, resolution target is __init__.py
    const result = resolveImports(imports, fileMap);
    // "." resolves to the current package's __init__.py if present
    // But if __init__.py is not in fileMap, no resolution
    expect(result).toHaveLength(0);
  });

  it('resolves relative import (from . import x) when __init__.py exists', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/pkg/main.py',
        relativePath: 'src/pkg/main.py',
        imports: [mkImport('.', ['utils'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/pkg/main.py': 'node::file::r1::src/pkg/main.py',
      'src/pkg/__init__.py': 'node::file::r1::src/pkg/__init__.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/pkg/__init__.py');
  });

  it('resolves relative import with module (from .foo import bar)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/pkg/main.py',
        relativePath: 'src/pkg/main.py',
        imports: [mkImport('.utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/pkg/main.py': 'node::file::r1::src/pkg/main.py',
      'src/pkg/utils.py': 'node::file::r1::src/pkg/utils.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/pkg/utils.py');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('resolves parent-relative import (from ..common import base)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/pkg/sub/mod.py',
        relativePath: 'src/pkg/sub/mod.py',
        imports: [mkImport('..common', ['base'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/pkg/sub/mod.py': 'node::file::r1::src/pkg/sub/mod.py',
      'src/pkg/common.py': 'node::file::r1::src/pkg/common.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/pkg/common.py');
  });

  it('skips unresolvable external Python imports', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::main.py',
        relativePath: 'main.py',
        imports: [mkImport('numpy', ['array'])],
      },
    ]);
    const fileMap = mkFileMap({
      'main.py': 'node::file::r1::main.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rust import resolution
// ---------------------------------------------------------------------------
describe('Rust import resolution', () => {
  it('resolves crate-relative use to .rs file', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/handlers/auth.rs',
        relativePath: 'src/handlers/auth.rs',
        imports: [mkImport('crate::models::User', ['User'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/handlers/auth.rs': 'node::file::r1::src/handlers/auth.rs',
      'src/models.rs': 'node::file::r1::src/models.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/models.rs');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('resolves crate-relative use to mod.rs when .rs not found', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.rs',
        relativePath: 'src/main.rs',
        imports: [mkImport('crate::models::User', ['User'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.rs': 'node::file::r1::src/main.rs',
      'src/models/mod.rs': 'node::file::r1::src/models/mod.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/models/mod.rs');
  });

  it('resolves super::foo relative to parent module (named file)', () => {
    // src/handlers/auth.rs is module crate::handlers::auth
    // super = crate::handlers, so super::utils = crate::handlers::utils
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/handlers/auth.rs',
        relativePath: 'src/handlers/auth.rs',
        imports: [mkImport('super::utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/handlers/auth.rs': 'node::file::r1::src/handlers/auth.rs',
      'src/handlers/utils.rs': 'node::file::r1::src/handlers/utils.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/handlers/utils.rs');
  });

  it('resolves super::foo relative to parent module (mod.rs)', () => {
    // src/handlers/mod.rs is module crate::handlers
    // super = crate, so super::utils = crate::utils → src/utils.rs
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/handlers/mod.rs',
        relativePath: 'src/handlers/mod.rs',
        imports: [mkImport('super::utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/handlers/mod.rs': 'node::file::r1::src/handlers/mod.rs',
      'src/utils.rs': 'node::file::r1::src/utils.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/utils.rs');
  });

  it('resolves self::foo relative to current module', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/handlers/mod.rs',
        relativePath: 'src/handlers/mod.rs',
        imports: [mkImport('self::auth::Login', ['Login'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/handlers/mod.rs': 'node::file::r1::src/handlers/mod.rs',
      'src/handlers/auth.rs': 'node::file::r1::src/handlers/auth.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/handlers/auth.rs');
  });

  it('resolves mod declaration (./submodule) to .rs file', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/lib.rs',
        relativePath: 'src/lib.rs',
        imports: [mkImport('./handlers', [])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/lib.rs': 'node::file::r1::src/lib.rs',
      'src/handlers.rs': 'node::file::r1::src/handlers.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/handlers.rs');
  });

  it('resolves mod declaration (./submodule) to mod.rs', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/lib.rs',
        relativePath: 'src/lib.rs',
        imports: [mkImport('./handlers', [])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/lib.rs': 'node::file::r1::src/lib.rs',
      'src/handlers/mod.rs': 'node::file::r1::src/handlers/mod.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/handlers/mod.rs');
  });

  it('skips external crate imports (std, serde, etc.)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.rs',
        relativePath: 'src/main.rs',
        imports: [
          mkImport('std::io::Read', ['Read']),
          mkImport('serde::Serialize', ['Serialize']),
        ],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.rs': 'node::file::r1::src/main.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(0);
  });

  it('resolves use with group syntax extracting first path segment', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.rs',
        relativePath: 'src/main.rs',
        imports: [mkImport('crate::models::{User, Post}', ['User', 'Post'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.rs': 'node::file::r1::src/main.rs',
      'src/models.rs': 'node::file::r1::src/models.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/models.rs');
  });
});

// ---------------------------------------------------------------------------
// Go import resolution
// ---------------------------------------------------------------------------
describe('Go import resolution', () => {
  it('resolves local Go import matching directory path in file map', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::cmd/main.go',
        relativePath: 'cmd/main.go',
        imports: [mkImport('github.com/user/repo/pkg/utils', ['utils'])],
      },
    ]);
    const fileMap = mkFileMap({
      'cmd/main.go': 'node::file::r1::cmd/main.go',
      'pkg/utils/helpers.go': 'node::file::r1::pkg/utils/helpers.go',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::pkg/utils/helpers.go');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('skips standard library Go imports (no dots in path)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::main.go',
        relativePath: 'main.go',
        imports: [
          mkImport('fmt', ['fmt']),
          mkImport('net/http', ['http']),
          mkImport('os', ['os']),
        ],
      },
    ]);
    const fileMap = mkFileMap({
      'main.go': 'node::file::r1::main.go',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(0);
  });

  it('skips external Go imports not found in file map', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::main.go',
        relativePath: 'main.go',
        imports: [mkImport('github.com/external/pkg', ['pkg'])],
      },
    ]);
    const fileMap = mkFileMap({
      'main.go': 'node::file::r1::main.go',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(0);
  });

  it('resolves Go import to first .go file in matching directory', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::cmd/main.go',
        relativePath: 'cmd/main.go',
        imports: [mkImport('github.com/user/repo/internal/db', ['db'])],
      },
    ]);
    const fileMap = mkFileMap({
      'cmd/main.go': 'node::file::r1::cmd/main.go',
      'internal/db/connection.go': 'node::file::r1::internal/db/connection.go',
      'internal/db/query.go': 'node::file::r1::internal/db/query.go',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    // Should resolve to one of the .go files in the directory
    expect(result[0]!.toFileId).toMatch(/^node::file::r1::internal\/db\//);
  });
});

// ---------------------------------------------------------------------------
// Java import resolution
// ---------------------------------------------------------------------------
describe('Java import resolution', () => {
  it('resolves fully-qualified import to .java file', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::com/example/Main.java',
        relativePath: 'com/example/Main.java',
        imports: [mkImport('com.example.Foo', ['Foo'])],
      },
    ]);
    const fileMap = mkFileMap({
      'com/example/Main.java': 'node::file::r1::com/example/Main.java',
      'com/example/Foo.java': 'node::file::r1::com/example/Foo.java',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::com/example/Foo.java');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('resolves deeply nested package import', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::app/App.java',
        relativePath: 'app/App.java',
        imports: [mkImport('com.example.service.UserService', ['UserService'])],
      },
    ]);
    const fileMap = mkFileMap({
      'app/App.java': 'node::file::r1::app/App.java',
      'com/example/service/UserService.java': 'node::file::r1::com/example/service/UserService.java',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::com/example/service/UserService.java');
  });

  it('resolves wildcard import to a .java file in the directory', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::app/Main.java',
        relativePath: 'app/Main.java',
        imports: [mkImport('java.util.*', ['List', 'Map'])],
      },
    ]);
    const fileMap = mkFileMap({
      'app/Main.java': 'node::file::r1::app/Main.java',
      'java/util/List.java': 'node::file::r1::java/util/List.java',
      'java/util/Map.java': 'node::file::r1::java/util/Map.java',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toMatch(/^node::file::r1::java\/util\//);
    expect(result[0]!.confidence).toBe('medium');
  });

  it('resolves static import to the containing class file', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::app/Calc.java',
        relativePath: 'app/Calc.java',
        imports: [mkImport('static java.lang.Math.PI', ['PI'])],
      },
    ]);
    const fileMap = mkFileMap({
      'app/Calc.java': 'node::file::r1::app/Calc.java',
      'java/lang/Math.java': 'node::file::r1::java/lang/Math.java',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::java/lang/Math.java');
  });

  it('skips unresolvable external Java imports', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::app/Main.java',
        relativePath: 'app/Main.java',
        imports: [mkImport('org.springframework.boot.SpringApplication', ['SpringApplication'])],
      },
    ]);
    const fileMap = mkFileMap({
      'app/Main.java': 'node::file::r1::app/Main.java',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(0);
  });

  it('Java uses symbol map fallback when file-path resolution fails', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::app/Main.java',
        relativePath: 'app/Main.java',
        imports: [mkImport('com.external.Helper', ['Helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'app/Main.java': 'node::file::r1::app/Main.java',
      'lib/Helper.java': 'node::file::r1::lib/Helper.java',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('Helper', {
      nodeId: 'node::symbol::r1::lib/Helper.java::Helper',
      filePath: 'lib/Helper.java',
      exported: true,
      language: 'java',
      kind: 'class',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::lib/Helper.java');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// Confidence and epistemic values for non-TS imports
// ---------------------------------------------------------------------------
describe('confidence and epistemic for non-TypeScript imports', () => {
  it('Python imports always have medium confidence and inferred epistemic', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::pkg/main.py',
        relativePath: 'pkg/main.py',
        imports: [mkImport('.utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'pkg/main.py': 'node::file::r1::pkg/main.py',
      'pkg/utils.py': 'node::file::r1::pkg/utils.py',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('Rust imports always have medium confidence and inferred epistemic', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.rs',
        relativePath: 'src/main.rs',
        imports: [mkImport('./utils', [])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.rs': 'node::file::r1::src/main.rs',
      'src/utils.rs': 'node::file::r1::src/utils.rs',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('Go imports always have medium confidence and inferred epistemic', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::cmd/main.go',
        relativePath: 'cmd/main.go',
        imports: [mkImport('github.com/user/repo/pkg/foo', ['foo'])],
      },
    ]);
    const fileMap = mkFileMap({
      'cmd/main.go': 'node::file::r1::cmd/main.go',
      'pkg/foo/bar.go': 'node::file::r1::pkg/foo/bar.go',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// TypeScript resolution still works (regression guard)
// ---------------------------------------------------------------------------
describe('TypeScript import resolution (regression)', () => {
  it('resolves relative .ts import', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.ts',
        relativePath: 'src/main.ts',
        imports: [mkImport('./utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.ts': 'node::file::r1::src/main.ts',
      'src/utils.ts': 'node::file::r1::src/utils.ts',
    });

    const result = resolveImports(imports, fileMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/utils.ts');
    expect(result[0]!.confidence).toBe('high');
    expect(result[0]!.epistemic).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Cross-file resolution via GlobalSymbolMap
// ---------------------------------------------------------------------------
describe('cross-file resolution via GlobalSymbolMap', () => {
  it('Python: resolves import via symbol map when file-path resolution fails', () => {
    // `from foo import bar` where `bar` is a function defined in another file
    // but `foo` does not resolve to a file path
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('foo', ['bar'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
      'lib/helpers.py': 'node::file::r1::lib/helpers.py',
    });

    // `foo` does not resolve via file-path (no foo.py or foo/__init__.py)
    // but `bar` is registered in the global symbol map as defined in lib/helpers.py
    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('bar', {
      nodeId: 'node::symbol::r1::lib/helpers.py::bar',
      filePath: 'lib/helpers.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.fromFileId).toBe('node::file::r1::src/main.py');
    expect(result[0]!.toFileId).toBe('node::file::r1::lib/helpers.py');
    expect(result[0]!.confidence).toBe('medium');
    expect(result[0]!.epistemic).toBe('inferred');
  });

  it('multiple matches: creates edges to all candidates with low confidence', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('unknown_mod', ['bar'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
      'pkg_a/models.py': 'node::file::r1::pkg_a/models.py',
      'pkg_b/models.py': 'node::file::r1::pkg_b/models.py',
    });

    // `bar` is defined in two different files
    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('bar', {
      nodeId: 'node::symbol::r1::pkg_a/models.py::bar',
      filePath: 'pkg_a/models.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });
    symbolMap.register('bar', {
      nodeId: 'node::symbol::r1::pkg_b/models.py::bar',
      filePath: 'pkg_b/models.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(2);
    const toFileIds = result.map((r) => r.toFileId).sort();
    expect(toFileIds).toEqual([
      'node::file::r1::pkg_a/models.py',
      'node::file::r1::pkg_b/models.py',
    ]);
    // All edges should have low confidence for ambiguous resolution
    for (const r of result) {
      expect(r.confidence).toBe('low');
      expect(r.epistemic).toBe('inferred');
    }
  });

  it('no match: no edge created when symbol not in map', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('unknown_pkg', ['nonexistent'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
    });

    const symbolMap = new GlobalSymbolMap();
    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(0);
  });

  it('Rust: resolves unresolved crate import via symbol map', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.rs',
        relativePath: 'src/main.rs',
        // External crate with no file-path match
        imports: [mkImport('tokio::spawn', ['spawn'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.rs': 'node::file::r1::src/main.rs',
      'src/tasks.rs': 'node::file::r1::src/tasks.rs',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('spawn', {
      nodeId: 'node::symbol::r1::src/tasks.rs::spawn',
      filePath: 'src/tasks.rs',
      exported: true,
      language: 'rust',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::src/tasks.rs');
    expect(result[0]!.confidence).toBe('medium');
  });

  it('Go: resolves unresolved Go import via symbol map', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::cmd/main.go',
        relativePath: 'cmd/main.go',
        imports: [mkImport('github.com/other/repo/utils', ['Process'])],
      },
    ]);
    const fileMap = mkFileMap({
      'cmd/main.go': 'node::file::r1::cmd/main.go',
      'internal/proc.go': 'node::file::r1::internal/proc.go',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('Process', {
      nodeId: 'node::symbol::r1::internal/proc.go::Process',
      filePath: 'internal/proc.go',
      exported: true,
      language: 'go',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::internal/proc.go');
    expect(result[0]!.confidence).toBe('medium');
  });

  it('TypeScript: does NOT use symbol map fallback (path-based only)', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.ts',
        relativePath: 'src/main.ts',
        imports: [mkImport('some-external-pkg', ['Helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.ts': 'node::file::r1::src/main.ts',
      'lib/helper.ts': 'node::file::r1::lib/helper.ts',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('Helper', {
      nodeId: 'node::symbol::r1::lib/helper.ts::Helper',
      filePath: 'lib/helper.ts',
      exported: true,
      language: 'typescript',
      kind: 'class',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    // TS resolution does not fall back to symbol map
    expect(result).toHaveLength(0);
  });

  it('does not use symbol map when file-path resolution succeeds', () => {
    // When the file-path resolution works, we should NOT additionally consult the symbol map
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('utils', ['helper'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
      'utils.py': 'node::file::r1::utils.py',
      'other/utils.py': 'node::file::r1::other/utils.py',
    });

    const symbolMap = new GlobalSymbolMap();
    // Register helper in a different file
    symbolMap.register('helper', {
      nodeId: 'node::symbol::r1::other/utils.py::helper',
      filePath: 'other/utils.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    // File-path resolution to utils.py wins; no symbol map fallback
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::utils.py');
    expect(result[0]!.confidence).toBe('medium');
  });

  it('skips symbol map entries whose filePath is not in fileMap', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('orphan_mod', ['ghost'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('ghost', {
      nodeId: 'node::symbol::r1::nonexistent/file.py::ghost',
      filePath: 'nonexistent/file.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    // The symbol's file is not in our file map, so no edge
    expect(result).toHaveLength(0);
  });

  it('deduplicates symbol map results by target file', () => {
    // If two symbols in the same file both match imported names,
    // we should only create one edge to that file
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/main.py',
        relativePath: 'src/main.py',
        imports: [mkImport('some_mod', ['alpha', 'beta'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/main.py': 'node::file::r1::src/main.py',
      'lib/stuff.py': 'node::file::r1::lib/stuff.py',
    });

    const symbolMap = new GlobalSymbolMap();
    symbolMap.register('alpha', {
      nodeId: 'node::symbol::r1::lib/stuff.py::alpha',
      filePath: 'lib/stuff.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });
    symbolMap.register('beta', {
      nodeId: 'node::symbol::r1::lib/stuff.py::beta',
      filePath: 'lib/stuff.py',
      exported: true,
      language: 'python',
      kind: 'function',
    });

    const result = resolveImports(imports, fileMap, symbolMap);
    // Both alpha and beta are in lib/stuff.py, so only one edge
    expect(result).toHaveLength(1);
    expect(result[0]!.toFileId).toBe('node::file::r1::lib/stuff.py');
    expect(result[0]!.confidence).toBe('medium');
  });
});
