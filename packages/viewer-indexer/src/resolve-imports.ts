import { dirname, join, extname } from 'node:path';
import type { ImportInfo, ResolvedImport } from './types.js';
import type { ConfidenceBand, Epistemic } from '@system2-viewer/viewer-core';
import { detectLanguage } from './grammar-registry.js';
import type { GlobalSymbolMap } from './global-symbol-map.js';

/**
 * Resolve import specifiers to file node ids, creating imports edges.
 *
 * @param imports - Map of fileId -> ImportInfo[] extracted from each file
 * @param fileMap - Map of relative path -> node id for all discovered files
 * @param globalSymbolMap - Optional cross-file symbol registry for fallback resolution
 * @returns Array of resolved import edges
 */
export function resolveImports(
  imports: Map<string, { relativePath: string; imports: ImportInfo[] }>,
  fileMap: Map<string, string>,
  globalSymbolMap?: GlobalSymbolMap,
): ResolvedImport[] {
  const results: ResolvedImport[] = [];

  for (const [fromFileId, entry] of imports) {
    const lang = detectLanguage(entry.relativePath);
    const useSymbolMapFallback = lang === 'python' || lang === 'rust' || lang === 'go' || lang === 'java';

    for (const imp of entry.imports) {
      let resolved: ResolvedSpecifier | null = null;

      switch (lang) {
        case 'python':
          resolved = resolvePythonSpecifier(imp.specifier, entry.relativePath, fileMap);
          break;
        case 'rust':
          resolved = resolveRustSpecifier(imp.specifier, entry.relativePath, fileMap);
          break;
        case 'go':
          resolved = resolveGoSpecifier(imp.specifier, entry.relativePath, fileMap);
          break;
        case 'java':
          resolved = resolveJavaSpecifier(imp.specifier, fileMap);
          break;
        default:
          resolved = resolveSpecifier(imp.specifier, entry.relativePath, fileMap);
          break;
      }

      if (resolved) {
        results.push({
          fromFileId,
          toFileId: resolved.nodeId,
          specifier: imp.specifier,
          names: imp.names,
          confidence: resolved.confidence,
          epistemic: resolved.epistemic,
        });
      } else if (useSymbolMapFallback && globalSymbolMap && imp.names.length > 0) {
        // Fallback: look up imported names in the global symbol map
        const fallbackResults = resolveViaSymbolMap(
          fromFileId, imp, fileMap, globalSymbolMap,
        );
        for (const r of fallbackResults) {
          results.push(r);
        }
      }
    }
  }

  return results;
}

/**
 * Attempt to resolve an import by looking up its named imports in the
 * global symbol map. Used as a fallback when file-path resolution fails
 * for Python, Rust, and Go imports.
 */
function resolveViaSymbolMap(
  fromFileId: string,
  imp: ImportInfo,
  fileMap: Map<string, string>,
  globalSymbolMap: GlobalSymbolMap,
): ResolvedImport[] {
  // Collect unique target file IDs across all imported names
  const targetFileIds = new Set<string>();

  for (const name of imp.names) {
    const entries = globalSymbolMap.lookup(name);
    for (const entry of entries) {
      const fileNodeId = fileMap.get(entry.filePath);
      if (fileNodeId && fileNodeId !== fromFileId) {
        targetFileIds.add(fileNodeId);
      }
    }
  }

  if (targetFileIds.size === 0) return [];

  const confidence: ConfidenceBand = targetFileIds.size === 1 ? 'medium' : 'low';

  const results: ResolvedImport[] = [];
  for (const toFileId of targetFileIds) {
    results.push({
      fromFileId,
      toFileId,
      specifier: imp.specifier,
      names: imp.names,
      confidence,
      epistemic: 'inferred',
    });
  }
  return results;
}

interface ResolvedSpecifier {
  nodeId: string;
  confidence: ConfidenceBand;
  epistemic: Epistemic;
}

const TS_RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function resolveSpecifier(
  specifier: string,
  fromRelativePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  // Skip external packages (not relative paths)
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    // Could be a workspace package or npm package
    // Try to resolve as workspace package
    const packageMatch = resolvePackageSpecifier(specifier, fileMap);
    if (packageMatch) return packageMatch;
    return null;
  }

  // Resolve relative import
  const fromDir = dirname(fromRelativePath);
  const rawResolved = join(fromDir, specifier);
  // Normalize to forward slashes
  const normalized = rawResolved.split('\\').join('/');

  // Try exact match first
  const exactId = fileMap.get(normalized);
  if (exactId) {
    return { nodeId: exactId, confidence: 'high', epistemic: 'static' };
  }

  // Try with various extensions
  for (const ext of TS_RESOLVE_EXTENSIONS) {
    const withExt = normalized + ext;
    const id = fileMap.get(withExt);
    if (id) {
      return { nodeId: id, confidence: 'high', epistemic: 'static' };
    }
  }

  // Strip existing .js extension and try .ts
  const existingExt = extname(normalized);
  if (existingExt === '.js') {
    const withoutExt = normalized.slice(0, -3);
    for (const ext of ['.ts', '.tsx']) {
      const candidate = withoutExt + ext;
      const id = fileMap.get(candidate);
      if (id) {
        return { nodeId: id, confidence: 'high', epistemic: 'static' };
      }
    }
  }

  // Try /index variants
  for (const ext of TS_RESOLVE_EXTENSIONS) {
    const indexPath = normalized + '/index' + ext;
    const id = fileMap.get(indexPath);
    if (id) {
      return { nodeId: id, confidence: 'medium', epistemic: 'inferred' };
    }
  }

  return null;
}

function resolvePackageSpecifier(
  specifier: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  // Try to find a matching package entry point
  // e.g., @system2-viewer/viewer-core -> packages/viewer-core/src/index.ts

  // Package specifiers always use POSIX separators (/)
  let packageDir: string;
  if (specifier.startsWith('@')) {
    // Scoped package: @scope/name -> packages/name or packages/scope-name
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      packageDir = parts[1]!;
    } else {
      return null;
    }
  } else {
    // Package specifiers always use POSIX separators (/)
    const parts = specifier.split('/');
    packageDir = parts[0]!;
  }

  // Common entry point patterns
  const entryPatterns = [
    `packages/${packageDir}/src/index.ts`,
    `packages/${packageDir}/src/index.js`,
    `packages/${packageDir}/index.ts`,
    `packages/${packageDir}/index.js`,
    `node_modules/${specifier}/index.js`,
  ];

  for (const pattern of entryPatterns) {
    const id = fileMap.get(pattern);
    if (id) {
      return { nodeId: id, confidence: 'medium', epistemic: 'inferred' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Python import resolution
// ---------------------------------------------------------------------------

function resolvePythonSpecifier(
  specifier: string,
  fromRelativePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  const fromDir = dirname(fromRelativePath);

  if (specifier.startsWith('.')) {
    // Relative import: count leading dots to determine how many levels up
    let dots = 0;
    while (dots < specifier.length && specifier[dots] === '.') dots++;
    const modulePart = specifier.slice(dots); // e.g. "foo" from ".foo" or "" from "."

    // Navigate up from current directory: 1 dot = current dir, 2 dots = parent, etc.
    let baseDir = fromDir;
    for (let i = 1; i < dots; i++) {
      baseDir = dirname(baseDir);
    }

    if (modulePart) {
      // from .foo import bar → resolve foo relative to baseDir
      const modulePath = modulePart.replace(/\./g, '/');
      return resolvePythonModule(join(baseDir, modulePath), fileMap);
    }
    // from . import x → resolve current package (__init__.py)
    return resolvePythonModule(baseDir, fileMap);
  }

  // Absolute import: convert dots to path separators and resolve from repo root
  const modulePath = specifier.replace(/\./g, '/');
  return resolvePythonModule(modulePath, fileMap);
}

function resolvePythonModule(
  modulePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  const normalized = modulePath.split('\\').join('/');

  // Try module_path.py
  const pyFile = normalized + '.py';
  const pyId = fileMap.get(pyFile);
  if (pyId) {
    return { nodeId: pyId, confidence: 'medium', epistemic: 'inferred' };
  }

  // Try module_path/__init__.py
  const initFile = normalized + '/__init__.py';
  const initId = fileMap.get(initFile);
  if (initId) {
    return { nodeId: initId, confidence: 'medium', epistemic: 'inferred' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rust import resolution
// ---------------------------------------------------------------------------

const RUST_MODULE_ROOTS = ['mod.rs', 'main.rs', 'lib.rs'];

function isRustModuleRoot(relativePath: string): boolean {
  // Stored paths always use POSIX separators (/) for cross-platform consistency
  const filename = relativePath.split('/').pop() ?? '';
  return RUST_MODULE_ROOTS.includes(filename);
}

function resolveRustSpecifier(
  specifier: string,
  fromRelativePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  const fromDir = dirname(fromRelativePath);

  // mod declaration: ./modname → resolve relative to current file directory
  if (specifier.startsWith('./')) {
    const modName = specifier.slice(2);
    return resolveRustModule(join(fromDir, modName), fileMap);
  }

  // Parse the use path segments
  if (specifier.startsWith('crate::')) {
    // crate:: → resolve from src/ (standard Rust crate root)
    const rest = specifier.slice('crate::'.length);
    return resolveRustUsePath(rest, 'src', fileMap);
  }

  if (specifier.startsWith('super::')) {
    const rest = specifier.slice('super::'.length);
    // super goes up one module level
    let baseDir: string;
    if (isRustModuleRoot(fromRelativePath)) {
      // For mod.rs/main.rs/lib.rs, the module IS the directory, so super = parent dir
      baseDir = dirname(fromDir);
    } else {
      // For named files like auth.rs, super = the containing directory (same module)
      baseDir = fromDir;
    }
    return resolveRustUsePath(rest, baseDir, fileMap);
  }

  if (specifier.startsWith('self::')) {
    const rest = specifier.slice('self::'.length);
    // self refers to the current module
    let baseDir: string;
    if (isRustModuleRoot(fromRelativePath)) {
      // For mod.rs/main.rs/lib.rs, self = the directory
      baseDir = fromDir;
    } else {
      // For named files, self refers to same-named directory (submodules)
      const stem = fromRelativePath.replace(/\.rs$/, '');
      baseDir = stem;
    }
    return resolveRustUsePath(rest, baseDir, fileMap);
  }

  // External crate import (std, serde, tokio, etc.) → skip
  return null;
}

function resolveRustUsePath(
  pathAfterPrefix: string,
  baseDir: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  // Strip group syntax: "models::{User, Post}" → "models"
  const cleaned = pathAfterPrefix.replace(/\s*::\s*\{[^}]*\}/, '');
  const segments = cleaned.split('::');

  // Try progressively shorter segment paths (last segments may be symbols, not modules)
  for (let i = segments.length; i >= 1; i--) {
    const pathSegments = segments.slice(0, i).join('/');
    const candidate = join(baseDir, pathSegments).split('\\').join('/');
    const result = resolveRustModule(candidate, fileMap);
    if (result) return result;
  }

  return null;
}

function resolveRustModule(
  modulePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  const normalized = modulePath.split('\\').join('/');

  // Try module_path.rs
  const rsFile = normalized + '.rs';
  const rsId = fileMap.get(rsFile);
  if (rsId) {
    return { nodeId: rsId, confidence: 'medium', epistemic: 'inferred' };
  }

  // Try module_path/mod.rs
  const modFile = normalized + '/mod.rs';
  const modId = fileMap.get(modFile);
  if (modId) {
    return { nodeId: modId, confidence: 'medium', epistemic: 'inferred' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Go import resolution
// ---------------------------------------------------------------------------

function resolveGoSpecifier(
  specifier: string,
  _fromRelativePath: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  // Standard library imports have no dots in the path → skip
  if (!specifier.includes('.')) {
    return null;
  }

  // Go import paths always use POSIX separators (/)
  // Try to match a suffix of the import path against directories
  // containing .go files in the file map.
  // e.g., "github.com/user/repo/pkg/utils" -> "pkg/utils", "utils", etc.
  const segments = specifier.split('/');

  // Try progressively shorter suffixes (skip the domain segments)
  for (let start = 1; start < segments.length; start++) {
    const dirPrefix = segments.slice(start).join('/');
    const match = findGoFileInDir(dirPrefix, fileMap);
    if (match) return match;
  }

  return null;
}

function findGoFileInDir(
  dirPrefix: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  for (const [path, nodeId] of fileMap) {
    if (path.endsWith('.go') && isUnderDir(path, dirPrefix)) {
      return { nodeId, confidence: 'medium', epistemic: 'inferred' };
    }
  }
  return null;
}

function isUnderDir(filePath: string, dirPrefix: string): boolean {
  // Check if filePath is directly inside dirPrefix (not nested deeper)
  const dir = dirname(filePath);
  return dir === dirPrefix || dir.endsWith('/' + dirPrefix);
}

// ---------------------------------------------------------------------------
// Java import resolution
// ---------------------------------------------------------------------------

function resolveJavaSpecifier(
  specifier: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  // Strip 'import ' prefix and 'static ' modifier if present in the specifier
  let cleaned = specifier;
  if (cleaned.startsWith('static ')) {
    cleaned = cleaned.slice('static '.length);
  }

  // Wildcard import: com.example.* -> look for any .java file in com/example/
  if (cleaned.endsWith('.*')) {
    const dirPath = cleaned.slice(0, -2).replace(/\./g, '/');
    return findJavaFileInDir(dirPath, fileMap);
  }

  // Static member import: com.example.Math.PI -> resolve com/example/Math.java
  // Regular import: com.example.Foo -> resolve com/example/Foo.java
  // Try the full path first; if not found, peel off trailing segments
  // (they may be inner classes or static members)
  const segments = cleaned.split('.');
  for (let i = segments.length; i >= 1; i--) {
    const candidate = segments.slice(0, i).join('/') + '.java';
    const nodeId = fileMap.get(candidate);
    if (nodeId) {
      return { nodeId, confidence: 'medium', epistemic: 'inferred' };
    }
  }

  return null;
}

function findJavaFileInDir(
  dirPrefix: string,
  fileMap: Map<string, string>,
): ResolvedSpecifier | null {
  for (const [path, nodeId] of fileMap) {
    if (path.endsWith('.java') && isUnderDir(path, dirPrefix)) {
      return { nodeId, confidence: 'medium', epistemic: 'inferred' };
    }
  }
  return null;
}
