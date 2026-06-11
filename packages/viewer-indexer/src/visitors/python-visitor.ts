import type { TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

/**
 * Maximum nesting depth for extracting inner symbols (methods, nested
 * functions, nested classes). Depth 0 = top-level, 1 = inside a class or
 * function, 2 = e.g. method inside a nested class.
 */
const MAX_NESTING_DEPTH = 2;

/**
 * Scan top-level assignments for `__all__ = [...]`. Returns the set of
 * exported names if found, or null if __all__ is absent or dynamically
 * computed (non-literal).
 */
function extractAllList(rootNode: TreeSitterNode): Set<string> | null {
  for (const child of rootNode.namedChildren) {
    const stmt = child.type === 'expression_statement' ? child : null;
    if (!stmt) continue;

    for (const inner of stmt.namedChildren) {
      if (inner.type !== 'assignment') continue;

      const left = inner.childForFieldName('left');
      if (!left || left.type !== 'identifier' || left.text !== '__all__') continue;

      const right = inner.childForFieldName('right');
      if (!right || right.type !== 'list') return null; // dynamically computed

      const names = new Set<string>();
      for (const elem of right.namedChildren) {
        if (elem.type === 'string') {
          const raw = elem.text;
          const unquoted = raw.replace(/^['"]|['"]$/g, '');
          if (unquoted) names.add(unquoted);
        }
      }
      return names;
    }
  }
  return null;
}

/**
 * Extract the identifier name from a simple assignment target.
 * Handles plain identifiers only (not tuple unpacking, subscripts, etc.).
 */
function assignmentTargetName(node: TreeSitterNode): string | null {
  const left = node.childForFieldName('left');
  if (!left) return null;
  if (left.type === 'identifier') return left.text;
  return null;
}

/**
 * Extract decorator names from a decorated_definition node.
 * Returns an array of decorator name strings (without the @ prefix).
 */
function extractDecorators(node: TreeSitterNode): string[] {
  const decorators: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'decorator') {
      // The decorator text includes '@', strip it
      let name = child.text.replace(/^@/, '').trim();
      // For multi-line or call decorators, take just the name part
      // e.g. "@app.route('/foo')" -> "app.route"
      const parenIdx = name.indexOf('(');
      if (parenIdx >= 0) {
        name = name.slice(0, parenIdx).trim();
      }
      if (name) decorators.push(name);
    }
  }
  return decorators;
}

/**
 * Check if a function_definition node is async by scanning its children
 * for the 'async' keyword.
 */
function isAsyncFunction(node: TreeSitterNode): boolean {
  for (const child of node.children) {
    if (child.type === 'async') return true;
    // tree-sitter may also represent it as text
    if (child.text === 'async' && child.type !== 'identifier') return true;
  }
  // Fallback: check if the full text starts with "async"
  return node.text.trimStart().startsWith('async ');
}

/**
 * Count lambda expressions in a subtree (non-recursive into nested
 * function/class definitions to avoid double-counting).
 */
function countLambdas(node: TreeSitterNode): number {
  let count = 0;
  for (const child of node.namedChildren) {
    if (child.type === 'lambda') {
      count++;
    } else if (
      child.type !== 'function_definition' &&
      child.type !== 'class_definition' &&
      child.type !== 'decorated_definition'
    ) {
      count += countLambdas(child);
    }
  }
  return count;
}

/**
 * Get the body block of a function_definition or class_definition node.
 */
function getBody(node: TreeSitterNode): TreeSitterNode | null {
  const body = node.childForFieldName('body');
  if (body) return body;
  // Fallback: scan for block child
  for (const child of node.namedChildren) {
    if (child.type === 'block') return child;
  }
  return null;
}

/**
 * Determine the method kind from decorators: 'staticmethod', 'classmethod',
 * or 'instance' (default).
 */
function methodKindFromDecorators(decorators: string[]): string {
  if (decorators.includes('staticmethod')) return 'staticmethod';
  if (decorators.includes('classmethod')) return 'classmethod';
  return 'instance';
}

/**
 * Extract symbols from a body block (class body or function body),
 * recursing up to MAX_NESTING_DEPTH.
 */
function extractFromBody(
  bodyNode: TreeSitterNode,
  symbols: SymbolInfo[],
  parentName: string,
  parentKind: 'class' | 'function',
  depth: number,
): void {
  if (depth > MAX_NESTING_DEPTH) return;

  for (const child of bodyNode.namedChildren) {
    switch (child.type) {
      case 'function_definition': {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const isAsync = isAsyncFunction(child);
          const lambdaCount = countLambdas(child);
          const metadata: Record<string, unknown> = {
            nested: true,
            parentName,
          };
          if (isAsync) metadata.async = true;
          if (lambdaCount > 0) metadata.lambdaCount = lambdaCount;

          if (parentKind === 'class') {
            // Methods inside a class
            metadata.parentClass = parentName;
            metadata.methodKind = 'instance';
            symbols.push({
              name,
              kind: 'method',
              exported: false,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              metadata,
            });
          } else {
            // Nested function inside a function
            metadata.parentFunction = parentName;
            symbols.push({
              name,
              kind: 'function',
              exported: false,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              metadata,
            });
          }

          // Recurse into nested function body
          const innerBody = getBody(child);
          if (innerBody) {
            extractFromBody(innerBody, symbols, name, 'function', depth + 1);
          }
        }
        break;
      }

      case 'decorated_definition': {
        const decorators = extractDecorators(child);
        for (const inner of child.namedChildren) {
          if (inner.type === 'function_definition') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              const name = nameNode.text;
              const isAsync = isAsyncFunction(inner);
              const lambdaCount = countLambdas(inner);
              const metadata: Record<string, unknown> = {
                nested: true,
                parentName,
                decorators,
              };
              if (isAsync) metadata.async = true;
              if (lambdaCount > 0) metadata.lambdaCount = lambdaCount;

              if (parentKind === 'class') {
                metadata.parentClass = parentName;
                metadata.methodKind = methodKindFromDecorators(decorators);
                symbols.push({
                  name,
                  kind: 'method',
                  exported: false,
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                  metadata,
                });
              } else {
                metadata.parentFunction = parentName;
                symbols.push({
                  name,
                  kind: 'function',
                  exported: false,
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                  metadata,
                });
              }

              const innerBody = getBody(inner);
              if (innerBody) {
                extractFromBody(innerBody, symbols, name, 'function', depth + 1);
              }
            }
          } else if (inner.type === 'class_definition') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              const name = nameNode.text;
              const metadata: Record<string, unknown> = {
                nested: true,
                parentName,
                decorators,
              };
              symbols.push({
                name,
                kind: 'class',
                exported: false,
                startLine: child.startPosition.row + 1,
                endLine: child.endPosition.row + 1,
                metadata,
              });

              const innerBody = getBody(inner);
              if (innerBody) {
                extractFromBody(innerBody, symbols, name, 'class', depth + 1);
              }
            }
          }
        }
        break;
      }

      case 'class_definition': {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const metadata: Record<string, unknown> = {
            nested: true,
            parentName,
          };
          symbols.push({
            name,
            kind: 'class',
            exported: false,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata,
          });

          const innerBody = getBody(child);
          if (innerBody) {
            extractFromBody(innerBody, symbols, name, 'class', depth + 1);
          }
        }
        break;
      }

      case 'expression_statement': {
        // Detect lambdas in assignments at nested scope
        for (const inner of child.namedChildren) {
          if (inner.type === 'assignment') {
            const targetName = assignmentTargetName(inner);
            if (targetName) {
              const right = inner.childForFieldName('right');
              if (right && right.type === 'lambda') {
                symbols.push({
                  name: targetName,
                  kind: 'lambda',
                  exported: false,
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                  metadata: {
                    nested: true,
                    parentName,
                  },
                });
              }
            }
          }
        }
        break;
      }
    }
  }
}

/**
 * Python AST visitor for tree-sitter-python.
 *
 * Extracts function definitions, class definitions, variable assignments,
 * type alias statements, and import declarations. Supports nested scopes
 * (depth-limited), decorator extraction, lambda detection, and async
 * function identification.
 *
 * Export rules: if `__all__` is defined as a static list literal, only names
 * in `__all__` get `exported: true`. If `__all__` is absent, all top-level
 * defs default to `exported: true` (Python's default visibility). If `__all__`
 * is dynamically computed (not a list literal), fall back to all exported.
 */
export const visitPython = (
  rootNode: TreeSitterNode,
  _content: string,
): { symbols: SymbolInfo[]; imports: ImportInfo[] } => {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  const allList = extractAllList(rootNode);

  for (const child of rootNode.namedChildren) {
    switch (child.type) {
      case 'function_definition': {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const isAsync = isAsyncFunction(child);
          const lambdaCount = countLambdas(child);
          const metadata: Record<string, unknown> = {};
          if (isAsync) metadata.async = true;
          if (lambdaCount > 0) metadata.lambdaCount = lambdaCount;

          symbols.push({
            name,
            kind: 'function',
            exported: allList ? allList.has(name) : true,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });

          // Descend into function body for nested definitions
          const body = getBody(child);
          if (body) {
            extractFromBody(body, symbols, name, 'function', 1);
          }
        }
        break;
      }

      case 'class_definition': {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          symbols.push({
            name,
            kind: 'class',
            exported: allList ? allList.has(name) : true,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
          });

          // Descend into class body for methods and nested classes
          const body = getBody(child);
          if (body) {
            extractFromBody(body, symbols, name, 'class', 1);
          }
        }
        break;
      }

      case 'decorated_definition': {
        const decorators = extractDecorators(child);
        for (const inner of child.namedChildren) {
          if (inner.type === 'function_definition') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              const name = nameNode.text;
              const isAsync = isAsyncFunction(inner);
              const lambdaCount = countLambdas(inner);
              const metadata: Record<string, unknown> = {};
              if (decorators.length > 0) metadata.decorators = decorators;
              if (isAsync) metadata.async = true;
              if (lambdaCount > 0) metadata.lambdaCount = lambdaCount;

              symbols.push({
                name,
                kind: 'function',
                exported: allList ? allList.has(name) : true,
                startLine: child.startPosition.row + 1,
                endLine: child.endPosition.row + 1,
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
              });

              const body = getBody(inner);
              if (body) {
                extractFromBody(body, symbols, name, 'function', 1);
              }
            }
          } else if (inner.type === 'class_definition') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              const name = nameNode.text;
              const metadata: Record<string, unknown> = {};
              if (decorators.length > 0) metadata.decorators = decorators;

              symbols.push({
                name,
                kind: 'class',
                exported: allList ? allList.has(name) : true,
                startLine: child.startPosition.row + 1,
                endLine: child.endPosition.row + 1,
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
              });

              const body = getBody(inner);
              if (body) {
                extractFromBody(body, symbols, name, 'class', 1);
              }
            }
          }
        }
        break;
      }

      case 'expression_statement': {
        for (const inner of child.namedChildren) {
          if (inner.type === 'assignment') {
            const targetName = assignmentTargetName(inner);
            if (targetName && targetName !== '__all__') {
              // Check if RHS is a lambda
              const right = inner.childForFieldName('right');
              if (right && right.type === 'lambda') {
                symbols.push({
                  name: targetName,
                  kind: 'lambda',
                  exported: allList ? allList.has(targetName) : true,
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                });
              } else {
                symbols.push({
                  name: targetName,
                  kind: 'variable',
                  exported: allList ? allList.has(targetName) : true,
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                });
              }
            }
          }
        }
        break;
      }

      case 'type_alias_statement': {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          symbols.push({
            name,
            kind: 'type',
            exported: allList ? allList.has(name) : true,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
          });
        }
        break;
      }

      case 'import_statement': {
        for (const nameChild of child.namedChildren) {
          if (nameChild.type === 'dotted_name') {
            imports.push({
              specifier: nameChild.text,
              names: [nameChild.text],
              isTypeOnly: false,
              line: child.startPosition.row + 1,
            });
          } else if (nameChild.type === 'aliased_import') {
            const nameNode = nameChild.childForFieldName('name');
            if (nameNode) {
              imports.push({
                specifier: nameNode.text,
                names: [nameNode.text],
                isTypeOnly: false,
                line: child.startPosition.row + 1,
              });
            }
          }
        }
        break;
      }

      case 'import_from_statement': {
        const moduleNode = child.childForFieldName('module_name');
        const names: string[] = [];
        let isStar = false;

        for (const nameChild of child.namedChildren) {
          if (nameChild.type === 'dotted_name' && nameChild !== moduleNode) {
            names.push(nameChild.text);
          } else if (nameChild.type === 'aliased_import') {
            const n = nameChild.childForFieldName('name');
            if (n) names.push(n.text);
          } else if (nameChild.type === 'wildcard_import') {
            isStar = true;
            names.push('*');
          }
        }

        let prefix = '';
        for (const c of child.children) {
          if (c.type === 'import_prefix') {
            prefix = c.text;
          } else if (c.type === 'relative_import') {
            prefix = c.text;
          }
        }

        let specifier = '';
        if (prefix) {
          specifier = moduleNode ? prefix + moduleNode.text : prefix;
        } else if (moduleNode) {
          specifier = moduleNode.text;
        }

        if (!specifier && !prefix) {
          for (const c of child.children) {
            if (c.type === 'dotted_name') {
              specifier = c.text;
              break;
            }
          }
        }

        imports.push({
          specifier: specifier || '.',
          names: isStar ? ['*'] : names,
          isTypeOnly: false,
          line: child.startPosition.row + 1,
        });
        break;
      }
    }
  }

  return { symbols, imports };
};
