import { extname } from 'node:path';
import type { SymbolInfo, ImportInfo } from './types.js';

/**
 * Tree-sitter AST node shape used by language visitors.
 */
export type TreeSitterNode = {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
  namedChildren: TreeSitterNode[];
};

/**
 * A language visitor traverses a tree-sitter AST and extracts symbols and imports.
 */
export interface LanguageVisitor {
  (rootNode: TreeSitterNode, content: string): {
    symbols: SymbolInfo[];
    imports: ImportInfo[];
  };
}

/**
 * Registry entry mapping a language to its grammar package and visitor.
 */
export interface GrammarEntry {
  language: string;
  extensions: string[];
  wasmPackage: string;
  wasmFileName: string;
  visitor: LanguageVisitor;
}

// --- TypeScript/JavaScript visitor (refactored from extract.ts) ---

function extractImportNames(node: TreeSitterNode, names: string[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'identifier') {
      names.push(child.text);
    } else if (child.type === 'import_specifier') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) names.push(nameNode.text);
    } else if (child.type === 'named_imports') {
      extractImportNames(child, names);
    } else if (child.type === 'namespace_import') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) names.push(`* as ${nameNode.text}`);
    }
  }
}

function visitTsNode(
  node: TreeSitterNode,
  symbols: SymbolInfo[],
  imports: ImportInfo[],
  isExported: boolean,
): void {
  switch (node.type) {
    case 'export_statement': {
      for (const child of node.namedChildren) {
        visitTsNode(child, symbols, imports, true);
      }
      return;
    }

    case 'function_declaration':
    case 'generator_function_declaration': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'function',
          exported: isExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      return;
    }

    case 'class_declaration': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'class',
          exported: isExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      return;
    }

    case 'interface_declaration': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'interface',
          exported: isExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      return;
    }

    case 'type_alias_declaration': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'type',
          exported: isExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      return;
    }

    case 'enum_declaration': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'enum',
          exported: isExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      return;
    }

    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const child of node.namedChildren) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              kind: 'variable',
              exported: isExported,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
        }
      }
      return;
    }

    case 'import_statement': {
      const source = node.childForFieldName('source');
      if (source) {
        const specifier = source.text.replace(/^['"]|['"]$/g, '');
        const names: string[] = [];
        let isTypeOnly = false;

        for (const child of node.children) {
          if (child.type === 'type') {
            isTypeOnly = true;
          }
        }

        for (const child of node.namedChildren) {
          if (child.type === 'import_clause') {
            extractImportNames(child, names);
          }
          if (child.type === 'named_imports') {
            extractImportNames(child, names);
          }
        }

        imports.push({
          specifier,
          names,
          isTypeOnly,
          line: node.startPosition.row + 1,
        });
      }
      return;
    }
  }

  for (const child of node.namedChildren) {
    visitTsNode(child, symbols, imports, false);
  }
}

export const visitTypeScript: LanguageVisitor = (rootNode, _content) => {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  visitTsNode(rootNode, symbols, imports, false);
  return { symbols, imports };
};

// --- JSON visitor (refactored from extract.ts) ---

export const visitJson: LanguageVisitor = (_rootNode, content) => {
  try {
    const parsed: unknown = JSON.parse(content);
    const symbols: SymbolInfo[] = [];

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed as Record<string, unknown>)) {
        symbols.push({
          name: key,
          kind: 'variable',
          exported: true,
          startLine: 1,
          endLine: 1,
        });
      }
    }

    return { symbols, imports: [] };
  } catch {
    return { symbols: [], imports: [] };
  }
};

import { visitPython } from './visitors/python-visitor.js';
import { visitRust } from './visitors/rust-visitor.js';
import { visitGo } from './visitors/go-visitor.js';
import { visitJava } from './visitors/java-visitor.js';

// --- Grammar Registry ---

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

export const GRAMMAR_REGISTRY: readonly GrammarEntry[] = [
  {
    language: 'typescript',
    extensions: TS_EXTENSIONS,
    wasmPackage: 'tree-sitter-typescript',
    wasmFileName: 'tree-sitter-typescript.wasm',
    visitor: visitTypeScript,
  },
  {
    language: 'javascript',
    extensions: JS_EXTENSIONS,
    wasmPackage: 'tree-sitter-typescript',
    wasmFileName: 'tree-sitter-typescript.wasm',
    visitor: visitTypeScript,
  },
  {
    language: 'json',
    extensions: ['.json'],
    wasmPackage: 'tree-sitter-json',
    wasmFileName: 'tree-sitter-json.wasm',
    visitor: visitJson,
  },
  {
    language: 'python',
    extensions: ['.py'],
    wasmPackage: 'tree-sitter-python',
    wasmFileName: 'tree-sitter-python.wasm',
    visitor: visitPython,
  },
  {
    language: 'rust',
    extensions: ['.rs'],
    wasmPackage: 'tree-sitter-rust',
    wasmFileName: 'tree-sitter-rust.wasm',
    visitor: visitRust,
  },
  {
    language: 'go',
    extensions: ['.go'],
    wasmPackage: 'tree-sitter-go',
    wasmFileName: 'tree-sitter-go.wasm',
    visitor: visitGo,
  },
  {
    language: 'java',
    extensions: ['.java'],
    wasmPackage: 'tree-sitter-java',
    wasmFileName: 'tree-sitter-java.wasm',
    visitor: visitJava,
  },
];

// --- Language Detection ---

const EXTENSION_MAP = new Map<string, string>();
for (const entry of GRAMMAR_REGISTRY) {
  for (const ext of entry.extensions) {
    EXTENSION_MAP.set(ext, entry.language);
  }
}

export function detectLanguage(filePath: string): string {
  const ext = extname(filePath);
  return EXTENSION_MAP.get(ext) ?? 'unknown';
}
