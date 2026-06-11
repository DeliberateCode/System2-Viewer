import type { LanguageVisitor, TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

/**
 * Checks whether a Rust item node has bare `pub` visibility (exported).
 * Returns true only for unrestricted `pub` — NOT `pub(crate)`, `pub(super)`, `pub(in ...)`.
 */
function isPubExported(node: TreeSitterNode): boolean {
  for (const child of node.namedChildren) {
    if (child.type === 'visibility_modifier') {
      return child.text === 'pub';
    }
  }
  return false;
}

/**
 * Extracts the name from a Rust item node via its `name` field.
 * Falls back to scanning namedChildren for identifier/type_identifier.
 */
function getItemName(node: TreeSitterNode, fieldName = 'name'): string | null {
  const nameNode = node.childForFieldName(fieldName);
  if (nameNode) return nameNode.text;
  for (const child of node.namedChildren) {
    if (child.type === 'identifier' || child.type === 'type_identifier') {
      return child.text;
    }
  }
  return null;
}

/**
 * Extracts the type name from an impl_item node.
 * For `impl Struct`, returns "Struct".
 * For `impl Trait for Struct`, returns "Struct" (the `type` field).
 */
function getImplTypeName(node: TreeSitterNode): string | null {
  const typeNode = node.childForFieldName('type');
  if (typeNode) return typeNode.text;
  // Fallback: scan for type_identifier, skip visibility_modifier
  for (const child of node.namedChildren) {
    if (child.type === 'type_identifier') {
      return child.text;
    }
  }
  return null;
}

/**
 * Recursively collects identifiers from a use_list node.
 */
function collectUseListNames(node: TreeSitterNode, names: string[]): void {
  for (const child of node.namedChildren) {
    if (child.type === 'identifier') {
      names.push(child.text);
    } else if (child.type === 'use_as_clause') {
      const alias = child.childForFieldName('alias');
      if (alias) {
        names.push(alias.text);
      } else {
        // Fallback: take only the last identifier (the effective local name)
        let last: string | null = null;
        for (const sub of child.namedChildren) {
          if (sub.type === 'identifier') {
            last = sub.text;
          }
        }
        if (last) names.push(last);
      }
    } else if (child.type === 'scoped_identifier') {
      // Nested scoped identifier in a use list, extract the leaf name
      const leafName = getLeafIdentifier(child);
      if (leafName) names.push(leafName);
    } else if (child.type === 'use_list') {
      collectUseListNames(child, names);
    }
  }
}

/**
 * Gets the last (leaf) identifier from a scoped_identifier chain.
 */
function getLeafIdentifier(node: TreeSitterNode): string | null {
  // In a scoped_identifier like std::io::Read, the last identifier is the leaf
  const children = node.namedChildren;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i]!.type === 'identifier' || children[i]!.type === 'type_identifier') {
      return children[i]!.text;
    }
  }
  return null;
}

/**
 * Parses a use_declaration subtree into an ImportInfo.
 * Handles simple paths, groups, wildcards, and aliases.
 */
function parseUseDeclaration(node: TreeSitterNode): ImportInfo | null {
  const line = node.startPosition.row + 1;
  // The use tree is the first named child that is not a keyword
  for (const child of node.namedChildren) {
    switch (child.type) {
      case 'scoped_identifier': {
        // use foo::bar::Baz; → specifier = full path text, names = [leaf]
        const leafName = getLeafIdentifier(child);
        return {
          specifier: child.text,
          names: leafName ? [leafName] : [],
          isTypeOnly: false,
          line,
        };
      }
      case 'scoped_use_list': {
        // use foo::bar::{A, B}; → specifier = full text, names = [A, B]
        const names: string[] = [];
        for (const sub of child.namedChildren) {
          if (sub.type === 'use_list') {
            collectUseListNames(sub, names);
          }
        }
        return {
          specifier: child.text,
          names,
          isTypeOnly: false,
          line,
        };
      }
      case 'use_wildcard': {
        // use foo::bar::*; → specifier = full text, names = ['*']
        return {
          specifier: child.text,
          names: ['*'],
          isTypeOnly: false,
          line,
        };
      }
      case 'use_as_clause': {
        // use foo::bar as baz; → specifier = full clause text, names = [alias]
        const alias = child.childForFieldName('alias');
        const names: string[] = [];
        if (alias) {
          names.push(alias.text);
        } else {
          // Fallback: take only the last identifier (the effective local name)
          let last: string | null = null;
          for (const sub of child.namedChildren) {
            if (sub.type === 'identifier') {
              last = sub.text;
            }
          }
          if (last) names.push(last);
        }
        return {
          specifier: child.text,
          names,
          isTypeOnly: false,
          line,
        };
      }
      case 'identifier': {
        // use foo; (simple single-segment use)
        return {
          specifier: child.text,
          names: [child.text],
          isTypeOnly: false,
          line,
        };
      }
    }
  }
  return null;
}

/**
 * Checks whether a mod_item is a file-level declaration (mod foo;)
 * vs an inline module (mod foo { ... }).
 * File-level declarations have no body/declaration_list child.
 */
function isFileModDeclaration(node: TreeSitterNode): boolean {
  const body = node.childForFieldName('body');
  if (body) return false;
  for (const child of node.namedChildren) {
    if (child.type === 'declaration_list') return false;
  }
  return true;
}

const ITEM_KIND_MAP: Record<string, SymbolInfo['kind']> = {
  function_item: 'function',
  struct_item: 'class',
  enum_item: 'class',
  trait_item: 'interface',
  type_item: 'type',
  const_item: 'variable',
  static_item: 'variable',
};

/**
 * Recursively counts closure_expression nodes in a subtree.
 * Does not recurse into nested function_item nodes.
 */
function countClosures(node: TreeSitterNode): number {
  let count = 0;
  for (const child of node.namedChildren) {
    if (child.type === 'closure_expression') {
      count++;
    } else if (child.type !== 'function_item') {
      count += countClosures(child);
    }
  }
  return count;
}

/**
 * Parses an attribute_item text like '#[derive(Debug)]' into the inner
 * attribute name, stripping the '#[' prefix and ']' suffix.
 */
function parseAttributeName(attrText: string): string {
  let inner = attrText;
  if (inner.startsWith('#[')) inner = inner.slice(2);
  if (inner.endsWith(']')) inner = inner.slice(0, -1);
  return inner.trim();
}

/**
 * Builds metadata with optional closureCount for a function_item.
 */
function buildFunctionMetadata(
  node: TreeSitterNode,
  extra?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const body = node.childForFieldName('body');
  const closureCount = body ? countClosures(body) : 0;
  const hasExtra = extra && Object.keys(extra).length > 0;
  if (closureCount === 0 && !hasExtra) return undefined;
  const metadata: Record<string, unknown> = {};
  if (extra) Object.assign(metadata, extra);
  if (closureCount > 0) metadata.closureCount = closureCount;
  return metadata;
}

/**
 * Extracts methods from an impl block's declaration_list body.
 */
function extractImplMethods(
  implNode: TreeSitterNode,
  typeName: string,
  symbols: SymbolInfo[],
): void {
  const body = implNode.childForFieldName('body');
  if (!body) return;

  let pendingAttrs: string[] = [];
  for (const child of body.namedChildren) {
    if (child.type === 'attribute_item') {
      pendingAttrs.push(parseAttributeName(child.text));
      continue;
    }

    if (child.type === 'function_item') {
      const name = getItemName(child);
      if (name) {
        const extra: Record<string, unknown> = { parentImpl: typeName };
        if (pendingAttrs.length > 0) {
          extra.attributes = pendingAttrs;
        }
        symbols.push({
          name,
          kind: 'method',
          exported: isPubExported(child),
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          metadata: buildFunctionMetadata(child, extra) ?? extra,
        });
      }
    }

    pendingAttrs = [];
  }
}

/**
 * Rust AST visitor for tree-sitter-rust.
 *
 * Extracts symbols and imports from top-level items in a Rust source file.
 * Visibility rules: bare `pub` = exported; `pub(crate)`, `pub(super)`, no modifier = not exported.
 * Impl blocks are always not exported; individual methods within are extracted separately.
 * Attributes (#[...]) are captured in metadata.attributes for the immediately following item.
 * Closure expressions within function bodies are counted in metadata.closureCount.
 */
export const visitRust: LanguageVisitor = (rootNode, _content) => {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  let pendingAttrs: string[] = [];

  for (const child of rootNode.namedChildren) {
    // Collect attribute_item nodes for the next symbol-producing item
    if (child.type === 'attribute_item') {
      pendingAttrs.push(parseAttributeName(child.text));
      continue;
    }

    // Symbol-producing items
    const kind = ITEM_KIND_MAP[child.type];
    if (kind) {
      const name = getItemName(child);
      if (name) {
        let metadata: Record<string, unknown> | undefined;
        if (pendingAttrs.length > 0) {
          metadata = { attributes: pendingAttrs };
        }
        if (kind === 'function') {
          metadata = buildFunctionMetadata(child, metadata) ?? metadata;
        }
        symbols.push({
          name,
          kind,
          exported: isPubExported(child),
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          metadata,
        });
      }
      pendingAttrs = [];
      continue;
    }

    // Impl blocks — always not exported, extract type name + individual methods
    if (child.type === 'impl_item') {
      const typeName = getImplTypeName(child);
      if (typeName) {
        symbols.push({
          name: typeName,
          kind: 'class',
          exported: false,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        });
        extractImplMethods(child, typeName, symbols);
      }
      pendingAttrs = [];
      continue;
    }

    // Use declarations
    if (child.type === 'use_declaration') {
      const imp = parseUseDeclaration(child);
      if (imp) imports.push(imp);
      pendingAttrs = [];
      continue;
    }

    // Extern crate declarations
    if (child.type === 'extern_crate_declaration') {
      const crateName = getItemName(child, 'name');
      if (crateName) {
        imports.push({
          specifier: crateName,
          names: [],
          isTypeOnly: false,
          line: child.startPosition.row + 1,
        });
      }
      pendingAttrs = [];
      continue;
    }

    // Mod declarations (file-level only, not inline modules)
    if (child.type === 'mod_item' && isFileModDeclaration(child)) {
      const modName = getItemName(child, 'name');
      if (modName) {
        imports.push({
          specifier: `./${modName}`,
          names: [],
          isTypeOnly: false,
          line: child.startPosition.row + 1,
        });
      }
    }

    // Reset pending attrs for any non-attribute node
    pendingAttrs = [];
  }

  return { symbols, imports };
};
