import type { LanguageVisitor, TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

/**
 * Checks whether a Java declaration has `public` visibility.
 * Scans the `modifiers` field for a child with text 'public'.
 */
function isPublicExported(node: TreeSitterNode): boolean {
  const modifiers = node.childForFieldName('modifiers');
  if (!modifiers) return false;
  for (const child of modifiers.children) {
    if (child.text === 'public') return true;
  }
  return false;
}

/**
 * Extracts the name from a Java declaration node via its `name` field.
 */
function getItemName(node: TreeSitterNode): string | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;
  return null;
}

/**
 * Extracts the declarator name(s) from a field_declaration node.
 * A field_declaration contains variable_declarator children, each with a `name` field.
 */
function extractFieldNames(node: TreeSitterNode): string[] {
  const names: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'variable_declarator') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) names.push(nameNode.text);
    }
  }
  return names;
}

function extractAnnotations(node: TreeSitterNode): string[] {
  const annotations: string[] = [];
  const modifiers = node.childForFieldName('modifiers');
  if (!modifiers) return annotations;
  for (const child of modifiers.children) {
    if (child.type === 'marker_annotation' || child.type === 'annotation') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) annotations.push(nameNode.text);
    }
  }
  return annotations;
}

/**
 * Extracts members (methods, constructors, fields, nested classes/interfaces/enums)
 * from a class/interface/enum body node.
 */
function extractMembers(
  bodyNode: TreeSitterNode,
  parentName: string,
  symbols: SymbolInfo[],
): void {
  for (const child of bodyNode.namedChildren) {
    switch (child.type) {
      case 'method_declaration': {
        const name = getItemName(child);
        if (name) {
          const annotations = extractAnnotations(child);
          symbols.push({
            name,
            kind: 'method',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: {
              parentClass: parentName,
              ...(annotations.length > 0 ? { annotations } : {}),
            },
          });
        }
        break;
      }

      case 'constructor_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'function',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { parentClass: parentName, isConstructor: true },
          });
        }
        break;
      }

      case 'field_declaration': {
        const fieldNames = extractFieldNames(child);
        const exported = isPublicExported(child);
        const annotations = extractAnnotations(child);
        for (const fieldName of fieldNames) {
          symbols.push({
            name: fieldName,
            kind: 'variable',
            exported,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: {
              parentClass: parentName,
              ...(annotations.length > 0 ? { annotations } : {}),
            },
          });
        }
        break;
      }

      case 'class_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'class',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { parentClass: parentName },
          });
          const innerBody = child.childForFieldName('body');
          if (innerBody) {
            extractMembers(innerBody, name, symbols);
          }
        }
        break;
      }

      case 'interface_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'interface',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { parentClass: parentName },
          });
          const innerBody = child.childForFieldName('body');
          if (innerBody) {
            extractMembers(innerBody, name, symbols);
          }
        }
        break;
      }

      case 'enum_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'class',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { parentClass: parentName, isEnum: true },
          });
          const innerBody = child.childForFieldName('body');
          if (innerBody) {
            extractMembers(innerBody, name, symbols);
          }
        }
        break;
      }
    }
  }
}

/**
 * Parses an import_declaration node into an ImportInfo.
 * Handles regular imports, static imports, and wildcard imports.
 *
 * tree-sitter-java import_declaration structure:
 * - children include 'import', optionally 'static', a scoped_identifier or identifier, optional asterisk
 * - The full import path is extracted from the scoped_identifier text
 */
function parseImportDeclaration(node: TreeSitterNode): ImportInfo | null {
  let isStatic = false;
  let isWildcard = false;
  let specifier = '';

  for (const child of node.children) {
    if (child.text === 'static') {
      isStatic = true;
    }
    if (child.type === 'scoped_identifier' || child.type === 'identifier') {
      specifier = child.text;
    }
    if (child.type === 'asterisk' || child.text === '*') {
      isWildcard = true;
    }
  }

  if (!specifier && !isWildcard) return null;

  // For wildcard imports, the specifier includes the package path
  // e.g., import java.util.* → specifier = "java.util", names = ["*"]
  // For regular imports, the last segment is the imported name
  // e.g., import java.util.List → specifier = "java.util.List", names = ["List"]
  const names: string[] = [];
  if (isWildcard) {
    names.push('*');
  } else {
    const lastDot = specifier.lastIndexOf('.');
    const simpleName = lastDot >= 0 ? specifier.slice(lastDot + 1) : specifier;
    names.push(simpleName);
  }

  const metadata: Record<string, unknown> = {};
  if (isStatic) metadata.isStatic = true;

  const imp: ImportInfo = {
    specifier,
    names,
    isTypeOnly: false,
    line: node.startPosition.row + 1,
  };

  return imp;
}

/**
 * Java AST visitor for tree-sitter-java.
 *
 * Extracts class, interface, enum, annotation type declarations as top-level symbols.
 * Extracts methods, constructors, and fields as nested symbols within their parent class.
 * Extracts import declarations including static and wildcard imports.
 *
 * Export rule: `public` modifier = exported; `protected`, `private`, or default = not exported.
 */
export const visitJava: LanguageVisitor = (rootNode, _content) => {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  for (const child of rootNode.namedChildren) {
    switch (child.type) {
      case 'class_declaration': {
        const name = getItemName(child);
        if (name) {
          const annotations = extractAnnotations(child);
          symbols.push({
            name,
            kind: 'class',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            ...(annotations.length > 0 ? { metadata: { annotations } } : {}),
          });
          const body = child.childForFieldName('body');
          if (body) {
            extractMembers(body, name, symbols);
          }
        }
        break;
      }

      case 'interface_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'interface',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
          });
          const body = child.childForFieldName('body');
          if (body) {
            extractMembers(body, name, symbols);
          }
        }
        break;
      }

      case 'enum_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'class',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { isEnum: true },
          });
          const body = child.childForFieldName('body');
          if (body) {
            extractMembers(body, name, symbols);
          }
        }
        break;
      }

      case 'annotation_type_declaration': {
        const name = getItemName(child);
        if (name) {
          symbols.push({
            name,
            kind: 'interface',
            exported: isPublicExported(child),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            metadata: { isAnnotation: true },
          });
        }
        break;
      }

      case 'import_declaration': {
        const imp = parseImportDeclaration(child);
        if (imp) imports.push(imp);
        break;
      }
    }
  }

  return { symbols, imports };
};
