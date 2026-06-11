import type { SymbolInfo, ImportInfo } from '../types.js';
import type { TreeSitterNode, LanguageVisitor } from '../grammar-registry.js';

/**
 * Checks whether a Go identifier name is exported.
 * Go export convention: identifiers starting with an uppercase letter are exported.
 * Unicode-aware: checks that the first character has a distinct upper/lower case
 * (filters out non-letter characters like _ or digits).
 */
function isGoExported(name: string): boolean {
  if (name.length === 0) return false;
  const first = name.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Extracts the receiver type string from a method_declaration's receiver field.
 * Walks into the parameter_list → parameter_declaration → type to get the text.
 */
function extractReceiverType(receiverNode: TreeSitterNode): string | null {
  for (const paramDecl of receiverNode.namedChildren) {
    if (paramDecl.type === 'parameter_declaration') {
      const typeNode = paramDecl.childForFieldName('type');
      if (typeNode) return typeNode.text;
    }
  }
  return null;
}

/**
 * Counts func_literal nodes (anonymous functions) in a subtree.
 * Recurses into all children to find nested anonymous functions.
 */
function countFuncLiterals(node: TreeSitterNode): number {
  let count = 0;
  for (const child of node.namedChildren) {
    if (child.type === 'func_literal') {
      count++;
    }
    count += countFuncLiterals(child);
  }
  return count;
}

/**
 * Extracts symbols from a Go type_declaration node.
 * A type_declaration may contain one or more type_spec children.
 * Each type_spec has a name and a type (struct_type, interface_type, etc.).
 * For interface types, also extracts declared method signatures.
 */
function extractTypeDecl(node: TreeSitterNode, symbols: SymbolInfo[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'type_spec') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode) continue;

      const name = nameNode.text;
      const typeNode = child.childForFieldName('type');
      let kind: SymbolInfo['kind'] = 'type';

      if (typeNode) {
        if (typeNode.type === 'struct_type') {
          kind = 'class';
        } else if (typeNode.type === 'interface_type') {
          kind = 'interface';
        }
      }

      const exported = isGoExported(name);

      symbols.push({
        name,
        kind,
        exported,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });

      if (typeNode && typeNode.type === 'interface_type') {
        for (const methodNode of typeNode.namedChildren) {
          if (methodNode.type === 'method_spec') {
            const methodNameNode = methodNode.childForFieldName('name');
            if (methodNameNode) {
              symbols.push({
                name: methodNameNode.text,
                kind: 'method',
                exported,
                startLine: methodNode.startPosition.row + 1,
                endLine: methodNode.endPosition.row + 1,
                metadata: { parentInterface: name },
              });
            }
          }
        }
      }
    }
  }
}

/**
 * Extracts symbols from a Go var_declaration node.
 * A var_declaration may contain one or more var_spec children.
 */
function extractVarDecl(node: TreeSitterNode, symbols: SymbolInfo[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'var_spec') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'variable',
          exported: isGoExported(nameNode.text),
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        });
      } else {
        for (const specChild of child.namedChildren) {
          if (specChild.type === 'identifier') {
            symbols.push({
              name: specChild.text,
              kind: 'variable',
              exported: isGoExported(specChild.text),
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * Extracts symbols from a Go const_declaration node.
 * A const_declaration may contain one or more const_spec children.
 */
function extractConstDecl(node: TreeSitterNode, symbols: SymbolInfo[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'const_spec') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'variable',
          exported: isGoExported(nameNode.text),
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        });
      } else {
        for (const specChild of child.namedChildren) {
          if (specChild.type === 'identifier') {
            symbols.push({
              name: specChild.text,
              kind: 'variable',
              exported: isGoExported(specChild.text),
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * Strips surrounding quotes from a Go string literal.
 */
function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('`') && text.endsWith('`'))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Extracts the last path segment from a Go import path as the default package name.
 * e.g., "fmt" -> "fmt", "net/http" -> "http", "github.com/pkg/errors" -> "errors"
 */
function defaultPkgName(importPath: string): string {
  // Go import paths always use POSIX separators (/)
  const parts = importPath.split('/');
  return parts[parts.length - 1] ?? importPath;
}

/**
 * Extracts imports from a single import_spec node.
 */
function extractImportSpec(spec: TreeSitterNode, imports: ImportInfo[]): void {
  const pathNode = spec.childForFieldName('path');
  if (!pathNode) return;

  const specifier = stripQuotes(pathNode.text);
  const nameNode = spec.childForFieldName('name');
  const names: string[] = [];
  let alias: string | undefined;

  if (nameNode) {
    if (nameNode.text === '.') {
      names.push('*');
    } else if (nameNode.text === '_') {
      names.push('_');
      alias = '_';
    } else {
      alias = nameNode.text;
      names.push(defaultPkgName(specifier));
    }
  } else {
    names.push(defaultPkgName(specifier));
  }

  const imp: ImportInfo = {
    specifier,
    names,
    isTypeOnly: false,
    line: spec.startPosition.row + 1,
  };

  if (alias !== undefined) {
    (imp as ImportInfo & { alias?: string }).alias = alias;
  }

  imports.push(imp);
}

/**
 * Extracts imports from an import_declaration node.
 * Handles both single imports and grouped imports (import_spec_list).
 */
function extractImportDecl(node: TreeSitterNode, imports: ImportInfo[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'import_spec_list') {
      for (const spec of child.namedChildren) {
        if (spec.type === 'import_spec') {
          extractImportSpec(spec, imports);
        }
      }
    } else if (child.type === 'import_spec') {
      extractImportSpec(child, imports);
    }
  }
}

/**
 * Go AST visitor. Extracts symbols and imports from tree-sitter-go AST.
 *
 * Symbol extraction:
 * - function_declaration → kind='function'
 * - method_declaration → kind='function' (with receiver)
 * - type_declaration (struct) → kind='class'
 * - type_declaration (interface) → kind='interface'
 * - type_declaration (other) → kind='type'
 * - var_declaration → kind='variable'
 * - const_declaration → kind='variable'
 *
 * Export rule: Go convention — name starts with uppercase → exported: true.
 */
export const visitGo: LanguageVisitor = (rootNode, _content) => {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  for (const node of rootNode.namedChildren) {
    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const metadata: Record<string, unknown> = {};

          if (name === 'init') {
            metadata.isInit = true;
          }

          const bodyNode = node.childForFieldName('body');
          if (bodyNode) {
            const anonCount = countFuncLiterals(bodyNode);
            if (anonCount > 0) {
              metadata.anonymousFunctions = anonCount;
            }
          }

          symbols.push({
            name,
            kind: 'function',
            exported: isGoExported(name),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });
        }
        break;
      }

      case 'method_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const metadata: Record<string, unknown> = {};

          const receiverNode = node.childForFieldName('receiver');
          if (receiverNode) {
            const receiverType = extractReceiverType(receiverNode);
            if (receiverType) {
              metadata.receiver = receiverType;
            }
          }

          const bodyNode = node.childForFieldName('body');
          if (bodyNode) {
            const anonCount = countFuncLiterals(bodyNode);
            if (anonCount > 0) {
              metadata.anonymousFunctions = anonCount;
            }
          }

          symbols.push({
            name: nameNode.text,
            kind: 'function',
            exported: isGoExported(nameNode.text),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });
        }
        break;
      }

      case 'type_declaration': {
        extractTypeDecl(node, symbols);
        break;
      }

      case 'var_declaration': {
        extractVarDecl(node, symbols);
        break;
      }

      case 'const_declaration': {
        extractConstDecl(node, symbols);
        break;
      }

      case 'import_declaration': {
        extractImportDecl(node, imports);
        break;
      }
    }
  }

  return { symbols, imports };
};
