/**
 * Tests for the Python AST visitor.
 *
 * Uses mock TreeSitterNode objects so tests run without the WASM grammar.
 *
 */
import { describe, it, expect } from 'vitest';
import { visitPython } from '../visitors/python-visitor.js';
import type { TreeSitterNode } from '../grammar-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers — build tree-sitter-python-shaped AST nodes
// ---------------------------------------------------------------------------

function pos(row: number, col: number) {
  return { row, column: col };
}

function mkNode(
  type: string,
  text: string,
  opts?: {
    children?: TreeSitterNode[];
    namedChildren?: TreeSitterNode[];
    fields?: Record<string, TreeSitterNode | null>;
    startRow?: number;
    endRow?: number;
  },
): TreeSitterNode {
  const children = opts?.children ?? opts?.namedChildren ?? [];
  const namedChildren = opts?.namedChildren ?? children;
  const fields = opts?.fields ?? {};
  const startRow = opts?.startRow ?? 0;
  const endRow = opts?.endRow ?? startRow;
  return {
    type,
    text,
    startPosition: pos(startRow, 0),
    endPosition: pos(endRow, 0),
    children,
    namedChildren,
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

function mkIdentifier(name: string, row?: number): TreeSitterNode {
  return mkNode('identifier', name, { startRow: row });
}

function mkString(value: string): TreeSitterNode {
  return mkNode('string', `'${value}'`);
}

function mkFunctionDef(
  name: string,
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mkIdentifier(name);
  return mkNode('function_definition', `def ${name}():`, {
    fields: { name: nameNode },
    namedChildren: [nameNode],
    startRow,
    endRow,
  });
}

function mkClassDef(
  name: string,
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mkIdentifier(name);
  return mkNode('class_definition', `class ${name}:`, {
    fields: { name: nameNode },
    namedChildren: [nameNode],
    startRow,
    endRow,
  });
}

function mkAssignment(
  targetName: string,
  valueText: string,
  row: number,
  valueType?: string,
): TreeSitterNode {
  const left = mkIdentifier(targetName, row);
  const right = mkNode(valueType ?? 'integer', valueText, { startRow: row });
  return mkNode('assignment', `${targetName} = ${valueText}`, {
    fields: { left, right },
    namedChildren: [left, right],
    startRow: row,
    endRow: row,
  });
}

function mkExpressionStatement(
  inner: TreeSitterNode,
  row: number,
): TreeSitterNode {
  return mkNode('expression_statement', inner.text, {
    namedChildren: [inner],
    startRow: row,
    endRow: row,
  });
}

function mkAllAssignment(names: string[], row: number): TreeSitterNode {
  const left = mkIdentifier('__all__', row);
  const stringNodes = names.map(mkString);
  const listNode = mkNode('list', `[${names.map((n) => `'${n}'`).join(', ')}]`, {
    namedChildren: stringNodes,
    startRow: row,
    endRow: row,
  });
  const assignment = mkNode('assignment', `__all__ = [...]`, {
    fields: { left, right: listNode },
    namedChildren: [left, listNode],
    startRow: row,
    endRow: row,
  });
  return mkExpressionStatement(assignment, row);
}

function mkImportStatement(
  moduleName: string,
  row: number,
): TreeSitterNode {
  const dottedName = mkNode('dotted_name', moduleName, { startRow: row });
  return mkNode('import_statement', `import ${moduleName}`, {
    namedChildren: [dottedName],
    startRow: row,
    endRow: row,
  });
}

function mkImportFromStatement(
  prefix: string | null,
  moduleName: string | null,
  importedNames: string[],
  isStar: boolean,
  row: number,
): TreeSitterNode {
  const allChildren: TreeSitterNode[] = [];
  const namedChildren: TreeSitterNode[] = [];
  let moduleNameNode: TreeSitterNode | null = null;

  // Build children array to match tree-sitter structure
  if (prefix) {
    const importPrefix = mkNode('import_prefix', prefix, { startRow: row });
    allChildren.push(importPrefix);
  }

  if (moduleName) {
    moduleNameNode = mkNode('dotted_name', moduleName, { startRow: row });
    allChildren.push(moduleNameNode);
    namedChildren.push(moduleNameNode);
  }

  if (isStar) {
    const wildcard = mkNode('wildcard_import', '*', { startRow: row });
    allChildren.push(wildcard);
    namedChildren.push(wildcard);
  } else {
    for (const n of importedNames) {
      const nameNode = mkNode('dotted_name', n, { startRow: row });
      allChildren.push(nameNode);
      namedChildren.push(nameNode);
    }
  }

  const specText = prefix
    ? `from ${prefix}${moduleName ?? ''} import ${isStar ? '*' : importedNames.join(', ')}`
    : `from ${moduleName ?? ''} import ${isStar ? '*' : importedNames.join(', ')}`;

  return {
    type: 'import_from_statement',
    text: specText,
    startPosition: pos(row, 0),
    endPosition: pos(row, 0),
    children: allChildren,
    namedChildren,
    childForFieldName(name: string) {
      if (name === 'module_name') return moduleNameNode;
      return null;
    },
  };
}

function mkModule(children: TreeSitterNode[]): TreeSitterNode {
  return mkNode('module', '', {
    namedChildren: children,
    children,
    startRow: 0,
    endRow: children.length > 0
      ? (children[children.length - 1]!.endPosition.row)
      : 0,
  });
}

function mkDecoratedDef(
  inner: TreeSitterNode,
  startRow: number,
  endRow: number,
): TreeSitterNode {
  return mkNode('decorated_definition', `@decorator\n${inner.text}`, {
    namedChildren: [inner],
    startRow,
    endRow,
  });
}

function mkDecorator(name: string, row?: number): TreeSitterNode {
  return mkNode('decorator', `@${name}`, { startRow: row ?? 0 });
}

function mkDecoratedDefWithDecorators(
  decorators: TreeSitterNode[],
  inner: TreeSitterNode,
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const decText = decorators.map((d) => d.text).join('\n');
  return mkNode('decorated_definition', `${decText}\n${inner.text}`, {
    namedChildren: [...decorators, inner],
    startRow,
    endRow,
  });
}

function mkBlock(children: TreeSitterNode[], startRow?: number, endRow?: number): TreeSitterNode {
  return mkNode('block', '', {
    namedChildren: children,
    children,
    startRow: startRow ?? 0,
    endRow: endRow ?? (children.length > 0 ? children[children.length - 1]!.endPosition.row : 0),
  });
}

function mkFunctionDefWithBody(
  name: string,
  bodyChildren: TreeSitterNode[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mkIdentifier(name);
  const body = mkBlock(bodyChildren, startRow + 1, endRow);
  return mkNode('function_definition', `def ${name}():`, {
    fields: { name: nameNode, body },
    namedChildren: [nameNode, body],
    children: [nameNode, body],
    startRow,
    endRow,
  });
}

function mkClassDefWithBody(
  name: string,
  bodyChildren: TreeSitterNode[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mkIdentifier(name);
  const body = mkBlock(bodyChildren, startRow + 1, endRow);
  return mkNode('class_definition', `class ${name}:`, {
    fields: { name: nameNode, body },
    namedChildren: [nameNode, body],
    children: [nameNode, body],
    startRow,
    endRow,
  });
}

function mkLambda(startRow: number): TreeSitterNode {
  return mkNode('lambda', 'lambda x: x', { startRow });
}

function mkAsyncFunctionDef(
  name: string,
  startRow: number,
  endRow: number,
  bodyChildren?: TreeSitterNode[],
): TreeSitterNode {
  const nameNode = mkIdentifier(name);
  const asyncKeyword = mkNode('async', 'async', { startRow });
  const body = bodyChildren ? mkBlock(bodyChildren, startRow + 1, endRow) : undefined;
  const fields: Record<string, TreeSitterNode | null> = { name: nameNode };
  if (body) fields.body = body;
  const namedParts: TreeSitterNode[] = [nameNode];
  if (body) namedParts.push(body);
  return mkNode('function_definition', `async def ${name}():`, {
    fields,
    namedChildren: namedParts,
    children: [asyncKeyword, nameNode, ...(body ? [body] : [])],
    startRow,
    endRow,
  });
}

function mkLambdaAssignment(name: string, row: number): TreeSitterNode {
  return mkAssignment(name, 'lambda x: x', row, 'lambda');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('visitPython', () => {
  describe('symbol extraction', () => {
    it('extracts top-level function definitions', () => {
      const root = mkModule([
        mkFunctionDef('greet', 0, 2),
        mkFunctionDef('compute', 4, 6),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[0]).toMatchObject({
        name: 'greet',
        kind: 'function',
        exported: true,
        startLine: 1,
        endLine: 3,
      });
      expect(symbols[1]).toMatchObject({
        name: 'compute',
        kind: 'function',
        exported: true,
        startLine: 5,
        endLine: 7,
      });
    });

    it('extracts top-level class definitions', () => {
      const root = mkModule([mkClassDef('MyClass', 0, 5)]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'MyClass',
        kind: 'class',
        exported: true,
      });
    });

    it('extracts top-level variable assignments', () => {
      const root = mkModule([
        mkExpressionStatement(mkAssignment('MAX_RETRIES', '3', 0), 0),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'MAX_RETRIES',
        kind: 'variable',
        exported: true,
      });
    });

    it('extracts decorated functions', () => {
      const innerFn = mkFunctionDef('decorated_fn', 1, 3);
      const root = mkModule([mkDecoratedDef(innerFn, 0, 3)]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'decorated_fn',
        kind: 'function',
        exported: true,
      });
    });

    it('extracts decorated classes', () => {
      const innerCls = mkClassDef('DecoratedClass', 1, 5);
      const root = mkModule([mkDecoratedDef(innerCls, 0, 5)]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'DecoratedClass',
        kind: 'class',
        exported: true,
      });
    });

    it('does not extract nested class definitions (top-level only)', () => {
      // A class inside a function would not be a top-level namedChild
      // of the module. Our mock correctly represents this by only
      // including top-level children in the module node.
      const root = mkModule([mkFunctionDef('outer', 0, 5)]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('outer');
    });

    it('does not include __all__ assignment as a symbol', () => {
      const root = mkModule([
        mkAllAssignment(['greet'], 0),
        mkFunctionDef('greet', 2, 4),
      ]);

      const { symbols } = visitPython(root, '');
      const names = symbols.map((s) => s.name);
      expect(names).not.toContain('__all__');
      expect(names).toContain('greet');
    });
  });

  describe('__all__ export filtering', () => {
    it('marks only names in __all__ as exported', () => {
      const root = mkModule([
        mkAllAssignment(['greet', 'MyClass'], 0),
        mkFunctionDef('greet', 2, 4),
        mkFunctionDef('_private', 5, 7),
        mkClassDef('MyClass', 9, 12),
        mkClassDef('_Internal', 14, 16),
        mkExpressionStatement(mkAssignment('CONST', '42', 18), 18),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(5);

      const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
      expect(byName['greet']!.exported).toBe(true);
      expect(byName['MyClass']!.exported).toBe(true);
      expect(byName['_private']!.exported).toBe(false);
      expect(byName['_Internal']!.exported).toBe(false);
      expect(byName['CONST']!.exported).toBe(false);
    });

    it('defaults all to exported when __all__ is absent', () => {
      const root = mkModule([
        mkFunctionDef('foo', 0, 2),
        mkClassDef('Bar', 3, 5),
        mkExpressionStatement(mkAssignment('X', '1', 7), 7),
      ]);

      const { symbols } = visitPython(root, '');
      for (const sym of symbols) {
        expect(sym.exported).toBe(true);
      }
    });

    it('falls back to all exported when __all__ is dynamically computed', () => {
      // __all__ = some_function() -- not a list literal
      const left = mkIdentifier('__all__', 0);
      const right = mkNode('call', 'compute_all()', { startRow: 0 });
      const assignment = mkNode('assignment', '__all__ = compute_all()', {
        fields: { left, right },
        namedChildren: [left, right],
        startRow: 0,
      });
      const root = mkModule([
        mkExpressionStatement(assignment, 0),
        mkFunctionDef('foo', 2, 4),
        mkFunctionDef('bar', 5, 7),
      ]);

      const { symbols } = visitPython(root, '');
      // Should fall back to all exported since __all__ is not a list literal
      for (const sym of symbols) {
        expect(sym.exported).toBe(true);
      }
    });
  });

  describe('import extraction', () => {
    it('extracts simple import statements', () => {
      const root = mkModule([
        mkImportStatement('os', 0),
        mkImportStatement('sys', 1),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(2);
      expect(imports[0]).toMatchObject({
        specifier: 'os',
        names: ['os'],
        isTypeOnly: false,
        line: 1,
      });
      expect(imports[1]).toMatchObject({
        specifier: 'sys',
        names: ['sys'],
        isTypeOnly: false,
        line: 2,
      });
    });

    it('extracts from-import statements', () => {
      const root = mkModule([
        mkImportFromStatement(null, 'pathlib', ['Path'], false, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        specifier: 'pathlib',
        names: ['Path'],
        isTypeOnly: false,
        line: 1,
      });
    });

    it('extracts multiple names from from-import', () => {
      const root = mkModule([
        mkImportFromStatement(null, 'collections', ['OrderedDict', 'defaultdict'], false, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.names).toEqual(['OrderedDict', 'defaultdict']);
    });

    it('extracts star imports', () => {
      const root = mkModule([
        mkImportFromStatement(null, 'module', [], true, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        specifier: 'module',
        names: ['*'],
        isTypeOnly: false,
      });
    });

    it('extracts relative imports (from . import x)', () => {
      const root = mkModule([
        mkImportFromStatement('.', null, ['sibling'], false, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('.');
      expect(imports[0]!.names).toEqual(['sibling']);
    });

    it('extracts relative imports with module (from .utils import x)', () => {
      const root = mkModule([
        mkImportFromStatement('.', 'utils', ['helper'], false, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('.utils');
      expect(imports[0]!.names).toEqual(['helper']);
    });

    it('extracts parent relative imports (from ..parent import x)', () => {
      const root = mkModule([
        mkImportFromStatement('..', 'parent', ['base'], false, 0),
      ]);

      const { imports } = visitPython(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('..parent');
      expect(imports[0]!.names).toEqual(['base']);
    });
  });

  describe('golden fixture comparison', () => {
    it('matches expected symbols from sample.py fixture', () => {
      // Build a mock AST matching the sample.py fixture content
      const root = mkModule([
        // import os
        mkImportStatement('os', 2),
        // import sys
        mkImportStatement('sys', 3),
        // from pathlib import Path
        mkImportFromStatement(null, 'pathlib', ['Path'], false, 5),
        // from collections import OrderedDict
        mkImportFromStatement(null, 'collections', ['OrderedDict'], false, 6),
        // from . import sibling_module
        mkImportFromStatement('.', null, ['sibling_module'], false, 7),
        // from .utils import helper_func
        mkImportFromStatement('.', 'utils', ['helper_func'], false, 8),
        // from ..parent import base_class
        mkImportFromStatement('..', 'parent', ['base_class'], false, 9),
        // __all__ = ["greet", "MyClass", "MAX_RETRIES", "cached_lookup"]
        mkAllAssignment(['greet', 'MyClass', 'MAX_RETRIES', 'cached_lookup'], 11),
        // def greet(...)
        mkFunctionDef('greet', 14, 16),
        // def _private_helper(...)
        mkFunctionDef('_private_helper', 19, 21),
        // async def fetch_data(...)
        mkFunctionDef('fetch_data', 24, 26),
        // @cache
        // def cached_lookup(...)
        mkDecoratedDefWithDecorators(
          [mkDecorator('cache')],
          mkFunctionDef('cached_lookup', 30, 32),
          29, 32,
        ),
        // class MyClass: (with methods)
        mkClassDefWithBody('MyClass', [
          mkFunctionDef('__init__', 37, 38),
          mkFunctionDef('get_value', 40, 41),
          mkDecoratedDefWithDecorators(
            [mkDecorator('staticmethod')],
            mkFunctionDef('create', 44, 45),
            43, 45,
          ),
          mkDecoratedDefWithDecorators(
            [mkDecorator('classmethod')],
            mkFunctionDef('from_dict', 48, 49),
            47, 49,
          ),
        ], 34, 49),
        // class _InternalClass:
        mkClassDef('_InternalClass', 52, 54),
        // MAX_RETRIES = 3
        mkExpressionStatement(mkAssignment('MAX_RETRIES', '3', 57), 57),
        // _TIMEOUT = 30
        mkExpressionStatement(mkAssignment('_TIMEOUT', '30', 58), 58),
      ]);

      const { symbols, imports } = visitPython(root, '');

      // Verify symbols match expected.json (ignoring line numbers which depend on real parse)
      const expectedSymbols = [
        { name: 'greet', kind: 'function', exported: true },
        { name: '_private_helper', kind: 'function', exported: false },
        { name: 'fetch_data', kind: 'function', exported: false },
        { name: 'cached_lookup', kind: 'function', exported: true },
        { name: 'MyClass', kind: 'class', exported: true },
        { name: '__init__', kind: 'method', exported: false },
        { name: 'get_value', kind: 'method', exported: false },
        { name: 'create', kind: 'method', exported: false },
        { name: 'from_dict', kind: 'method', exported: false },
        { name: '_InternalClass', kind: 'class', exported: false },
        { name: 'MAX_RETRIES', kind: 'variable', exported: true },
        { name: '_TIMEOUT', kind: 'variable', exported: false },
      ];

      expect(symbols).toHaveLength(expectedSymbols.length);
      for (let i = 0; i < expectedSymbols.length; i++) {
        expect(symbols[i]).toMatchObject(expectedSymbols[i]!);
      }

      // Verify decorated function metadata
      const cachedLookup = symbols.find(s => s.name === 'cached_lookup');
      expect(cachedLookup!.metadata).toMatchObject({ decorators: ['cache'] });

      // Verify method metadata
      const initMethod = symbols.find(s => s.name === '__init__');
      expect(initMethod!.metadata).toMatchObject({
        nested: true,
        parentClass: 'MyClass',
        methodKind: 'instance',
      });

      const createMethod = symbols.find(s => s.name === 'create');
      expect(createMethod!.metadata).toMatchObject({
        nested: true,
        parentClass: 'MyClass',
        methodKind: 'staticmethod',
        decorators: ['staticmethod'],
      });

      const fromDictMethod = symbols.find(s => s.name === 'from_dict');
      expect(fromDictMethod!.metadata).toMatchObject({
        nested: true,
        parentClass: 'MyClass',
        methodKind: 'classmethod',
        decorators: ['classmethod'],
      });

      // Verify imports match expected.json
      const expectedImports = [
        { specifier: 'os', names: ['os'], isTypeOnly: false },
        { specifier: 'sys', names: ['sys'], isTypeOnly: false },
        { specifier: 'pathlib', names: ['Path'], isTypeOnly: false },
        { specifier: 'collections', names: ['OrderedDict'], isTypeOnly: false },
        { specifier: '.', names: ['sibling_module'], isTypeOnly: false },
        { specifier: '.utils', names: ['helper_func'], isTypeOnly: false },
        { specifier: '..parent', names: ['base_class'], isTypeOnly: false },
      ];

      expect(imports).toHaveLength(expectedImports.length);
      for (let i = 0; i < expectedImports.length; i++) {
        expect(imports[i]).toMatchObject(expectedImports[i]!);
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty module', () => {
      const root = mkModule([]);
      const { symbols, imports } = visitPython(root, '');
      expect(symbols).toEqual([]);
      expect(imports).toEqual([]);
    });

    it('handles module with only imports', () => {
      const root = mkModule([mkImportStatement('os', 0)]);
      const { symbols, imports } = visitPython(root, '');
      expect(symbols).toEqual([]);
      expect(imports).toHaveLength(1);
    });

    it('handles module with only __all__ (no definitions)', () => {
      const root = mkModule([mkAllAssignment(['nonexistent'], 0)]);
      const { symbols } = visitPython(root, '');
      expect(symbols).toEqual([]);
    });

    it('handles async function definitions', () => {
      // Async functions have the same AST type: function_definition
      // (with an `async` keyword child). The visitor treats them identically.
      const root = mkModule([mkFunctionDef('async_fn', 0, 3)]);
      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.kind).toBe('function');
    });
  });

  describe('nested scope extraction', () => {
    it('extracts methods from a class body', () => {
      // class MyClass:
      //   def method_a(self): ...
      //   def method_b(self): ...
      const root = mkModule([
        mkClassDefWithBody('MyClass', [
          mkFunctionDef('method_a', 1, 3),
          mkFunctionDef('method_b', 4, 6),
        ], 0, 6),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(3); // MyClass + 2 methods
      expect(symbols[0]).toMatchObject({ name: 'MyClass', kind: 'class' });
      expect(symbols[1]).toMatchObject({
        name: 'method_a',
        kind: 'method',
        exported: false,
      });
      expect(symbols[1]!.metadata).toMatchObject({
        nested: true,
        parentName: 'MyClass',
        parentClass: 'MyClass',
        methodKind: 'instance',
      });
      expect(symbols[2]).toMatchObject({
        name: 'method_b',
        kind: 'method',
        exported: false,
      });
    });

    it('extracts nested functions from a function body', () => {
      // def outer():
      //   def inner(): ...
      const root = mkModule([
        mkFunctionDefWithBody('outer', [
          mkFunctionDef('inner', 1, 3),
        ], 0, 3),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(2); // outer + inner
      expect(symbols[0]).toMatchObject({ name: 'outer', kind: 'function' });
      expect(symbols[1]).toMatchObject({
        name: 'inner',
        kind: 'function',
        exported: false,
      });
      expect(symbols[1]!.metadata).toMatchObject({
        nested: true,
        parentName: 'outer',
        parentFunction: 'outer',
      });
    });

    it('extracts nested class inside a class', () => {
      // class Outer:
      //   class Inner: ...
      const root = mkModule([
        mkClassDefWithBody('Outer', [
          mkClassDef('Inner', 1, 3),
        ], 0, 3),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[0]).toMatchObject({ name: 'Outer', kind: 'class' });
      expect(symbols[1]).toMatchObject({
        name: 'Inner',
        kind: 'class',
        exported: false,
      });
      expect(symbols[1]!.metadata).toMatchObject({ nested: true, parentName: 'Outer' });
    });

    it('respects depth limit (stops at depth 2)', () => {
      // def level0():
      //   def level1():
      //     def level2():       <-- extracted (depth 2)
      //       def level3(): ... <-- NOT extracted (depth 3)
      const level2Body = mkBlock([mkFunctionDef('level3', 4, 5)], 4, 5);
      const level2 = mkNode('function_definition', 'def level2():', {
        fields: {
          name: mkIdentifier('level2'),
          body: level2Body,
        },
        namedChildren: [mkIdentifier('level2'), level2Body],
        children: [mkIdentifier('level2'), level2Body],
        startRow: 3,
        endRow: 5,
      });

      const root = mkModule([
        mkFunctionDefWithBody('level0', [
          mkFunctionDefWithBody('level1', [level2], 1, 5),
        ], 0, 5),
      ]);

      const { symbols } = visitPython(root, '');
      const names = symbols.map((s) => s.name);
      expect(names).toContain('level0');
      expect(names).toContain('level1');
      expect(names).toContain('level2');
      expect(names).not.toContain('level3');
    });

    it('extracts methods from nested class inside function', () => {
      // def factory():
      //   class InnerClass:
      //     def method(self): ...
      const innerClass = mkClassDefWithBody('InnerClass', [
        mkFunctionDef('method', 3, 4),
      ], 1, 4);

      const root = mkModule([
        mkFunctionDefWithBody('factory', [innerClass], 0, 4),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(3); // factory + InnerClass + method
      expect(symbols[0]).toMatchObject({ name: 'factory', kind: 'function' });
      expect(symbols[1]).toMatchObject({
        name: 'InnerClass',
        kind: 'class',
        exported: false,
      });
      expect(symbols[2]).toMatchObject({
        name: 'method',
        kind: 'method',
        exported: false,
      });
      expect(symbols[2]!.metadata).toMatchObject({
        nested: true,
        parentClass: 'InnerClass',
      });
    });
  });

  describe('decorator extraction', () => {
    it('extracts single decorator on a function', () => {
      const innerFn = mkFunctionDef('cached', 1, 3);
      const root = mkModule([
        mkDecoratedDefWithDecorators(
          [mkDecorator('cache')],
          innerFn,
          0,
          3,
        ),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({ name: 'cached', kind: 'function' });
      expect(symbols[0]!.metadata).toMatchObject({ decorators: ['cache'] });
    });

    it('extracts multiple decorators', () => {
      const innerFn = mkFunctionDef('handler', 2, 4);
      const root = mkModule([
        mkDecoratedDefWithDecorators(
          [mkDecorator('app.route'), mkDecorator('require_auth')],
          innerFn,
          0,
          4,
        ),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata!.decorators).toEqual(['app.route', 'require_auth']);
    });

    it('extracts common decorators: @property, @staticmethod, @classmethod, @abstractmethod', () => {
      const propFn = mkFunctionDef('value', 1, 3);
      const staticFn = mkFunctionDef('create', 5, 7);
      const classFn = mkFunctionDef('from_dict', 9, 11);
      const abstractFn = mkFunctionDef('process', 13, 15);

      const root = mkModule([
        mkClassDefWithBody('MyClass', [
          mkDecoratedDefWithDecorators([mkDecorator('property')], propFn, 1, 3),
          mkDecoratedDefWithDecorators([mkDecorator('staticmethod')], staticFn, 5, 7),
          mkDecoratedDefWithDecorators([mkDecorator('classmethod')], classFn, 9, 11),
          mkDecoratedDefWithDecorators([mkDecorator('abstractmethod')], abstractFn, 13, 15),
        ], 0, 15),
      ]);

      const { symbols } = visitPython(root, '');
      const methods = symbols.filter((s) => s.kind === 'method');
      expect(methods).toHaveLength(4);

      const byName = Object.fromEntries(methods.map((s) => [s.name, s]));
      expect(byName['value']!.metadata!.decorators).toEqual(['property']);
      expect(byName['value']!.metadata!.methodKind).toBe('instance');
      expect(byName['create']!.metadata!.decorators).toEqual(['staticmethod']);
      expect(byName['create']!.metadata!.methodKind).toBe('staticmethod');
      expect(byName['from_dict']!.metadata!.decorators).toEqual(['classmethod']);
      expect(byName['from_dict']!.metadata!.methodKind).toBe('classmethod');
      expect(byName['process']!.metadata!.decorators).toEqual(['abstractmethod']);
    });

    it('extracts decorators on a class', () => {
      const innerCls = mkClassDef('DataRecord', 1, 5);
      const root = mkModule([
        mkDecoratedDefWithDecorators(
          [mkDecorator('dataclass')],
          innerCls,
          0,
          5,
        ),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({ name: 'DataRecord', kind: 'class' });
      expect(symbols[0]!.metadata).toMatchObject({ decorators: ['dataclass'] });
    });

    it('strips call parentheses from decorator names', () => {
      const innerFn = mkFunctionDef('handler', 1, 3);
      const decorator = mkNode('decorator', "@app.route('/home')", { startRow: 0 });
      const root = mkModule([
        mkDecoratedDefWithDecorators([decorator], innerFn, 0, 3),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols[0]!.metadata!.decorators).toEqual(['app.route']);
    });
  });

  describe('lambda detection', () => {
    it('detects top-level lambda assignment', () => {
      const root = mkModule([
        mkExpressionStatement(mkLambdaAssignment('double', 0), 0),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'double',
        kind: 'lambda',
        exported: true,
      });
    });

    it('counts lambdas in function body and stores in parent metadata', () => {
      // def process():
      //   fn = lambda x: x   <-- lambda in body
      const lambdaNode = mkLambda(1);
      const bodyContent = mkExpressionStatement(
        mkNode('assignment', 'fn = lambda x: x', {
          fields: {
            left: mkIdentifier('fn', 1),
            right: lambdaNode,
          },
          namedChildren: [mkIdentifier('fn', 1), lambdaNode],
          startRow: 1,
        }),
        1,
      );

      const root = mkModule([
        mkFunctionDefWithBody('process', [bodyContent], 0, 2),
      ]);

      const { symbols } = visitPython(root, '');
      const processSym = symbols.find((s) => s.name === 'process');
      expect(processSym).toBeDefined();
      expect(processSym!.metadata).toMatchObject({ lambdaCount: 1 });
    });

    it('lambda assignment respects __all__ export filtering', () => {
      const root = mkModule([
        mkAllAssignment(['included'], 0),
        mkExpressionStatement(mkLambdaAssignment('included', 2), 2),
        mkExpressionStatement(mkLambdaAssignment('excluded', 3), 3),
      ]);

      const { symbols } = visitPython(root, '');
      const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
      expect(byName['included']!.exported).toBe(true);
      expect(byName['excluded']!.exported).toBe(false);
    });

    it('nested lambda assignment inside class creates lambda symbol', () => {
      // class Foo:
      //   transform = lambda x: x * 2
      const lambdaAssign = mkExpressionStatement(
        mkAssignment('transform', 'lambda x: x * 2', 1, 'lambda'),
        1,
      );

      const root = mkModule([
        mkClassDefWithBody('Foo', [lambdaAssign], 0, 2),
      ]);

      const { symbols } = visitPython(root, '');
      const lambdaSym = symbols.find((s) => s.name === 'transform');
      expect(lambdaSym).toBeDefined();
      expect(lambdaSym!.kind).toBe('lambda');
      expect(lambdaSym!.metadata).toMatchObject({
        nested: true,
        parentName: 'Foo',
      });
    });
  });

  describe('async function support', () => {
    it('marks async functions with metadata.async', () => {
      const root = mkModule([mkAsyncFunctionDef('fetch_data', 0, 3)]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'fetch_data',
        kind: 'function',
        exported: true,
      });
      expect(symbols[0]!.metadata).toMatchObject({ async: true });
    });

    it('marks async methods in a class', () => {
      const root = mkModule([
        mkClassDefWithBody('Service', [
          mkAsyncFunctionDef('connect', 1, 3),
        ], 0, 3),
      ]);

      const { symbols } = visitPython(root, '');
      const method = symbols.find((s) => s.name === 'connect');
      expect(method).toBeDefined();
      expect(method!.kind).toBe('method');
      expect(method!.metadata).toMatchObject({
        async: true,
        parentClass: 'Service',
      });
    });

    it('non-async functions have no async metadata', () => {
      const root = mkModule([mkFunctionDef('sync_fn', 0, 2)]);
      const { symbols } = visitPython(root, '');
      expect(symbols[0]!.metadata).toBeUndefined();
    });
  });

  describe('combined scenarios', () => {
    it('extracts full class with decorated methods and nested class', () => {
      // class Base:
      //   @property
      //   def name(self): ...
      //   @staticmethod
      //   def create(): ...
      //   class Meta: ...
      const propMethod = mkDecoratedDefWithDecorators(
        [mkDecorator('property')],
        mkFunctionDef('name', 2, 3),
        1, 3,
      );
      const staticMethod = mkDecoratedDefWithDecorators(
        [mkDecorator('staticmethod')],
        mkFunctionDef('create', 5, 6),
        4, 6,
      );
      const nestedClass = mkClassDef('Meta', 7, 8);

      const root = mkModule([
        mkClassDefWithBody('Base', [propMethod, staticMethod, nestedClass], 0, 8),
      ]);

      const { symbols } = visitPython(root, '');
      expect(symbols).toHaveLength(4); // Base + name + create + Meta

      const base = symbols.find((s) => s.name === 'Base');
      expect(base!.kind).toBe('class');
      expect(base!.exported).toBe(true);

      const nameSym = symbols.find((s) => s.name === 'name');
      expect(nameSym!.kind).toBe('method');
      expect(nameSym!.metadata!.decorators).toEqual(['property']);
      expect(nameSym!.metadata!.methodKind).toBe('instance');

      const createSym = symbols.find((s) => s.name === 'create');
      expect(createSym!.kind).toBe('method');
      expect(createSym!.metadata!.decorators).toEqual(['staticmethod']);
      expect(createSym!.metadata!.methodKind).toBe('staticmethod');

      const meta = symbols.find((s) => s.name === 'Meta');
      expect(meta!.kind).toBe('class');
      expect(meta!.metadata).toMatchObject({ nested: true, parentName: 'Base' });
    });

    it('handles decorated class with methods and __all__', () => {
      const innerCls = mkClassDefWithBody('Controller', [
        mkFunctionDef('handle', 3, 4),
      ], 1, 4);

      const root = mkModule([
        mkAllAssignment(['Controller'], 0),
        mkDecoratedDefWithDecorators(
          [mkDecorator('register')],
          innerCls,
          1, 4,
        ),
      ]);

      const { symbols } = visitPython(root, '');
      const ctrl = symbols.find((s) => s.name === 'Controller');
      expect(ctrl!.exported).toBe(true);
      expect(ctrl!.metadata).toMatchObject({ decorators: ['register'] });

      const method = symbols.find((s) => s.name === 'handle');
      expect(method!.kind).toBe('method');
      expect(method!.metadata).toMatchObject({ parentClass: 'Controller' });
    });
  });
});
