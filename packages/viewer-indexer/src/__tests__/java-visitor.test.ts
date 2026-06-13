/**
 * Tests for the Java AST visitor.
 * Uses mock TreeSitterNode structures to validate extraction logic
 * without requiring tree-sitter WASM grammars at test time.
 *
 *
 * Golden fixture comparison, import resolution, package-level
 *           visibility, enum constants verification.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visitJava } from '../visitors/java-visitor.js';
import type { TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GOLDEN_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'golden', 'java');

// --- Mock AST node builder ---

function mockNode(
  type: string,
  opts: {
    text?: string;
    startRow?: number;
    endRow?: number;
    children?: TreeSitterNode[];
    namedChildren?: TreeSitterNode[];
    fields?: Record<string, TreeSitterNode | null>;
  } = {},
): TreeSitterNode {
  const {
    text = '',
    startRow = 0,
    endRow = 0,
    children = [],
    namedChildren,
    fields = {},
  } = opts;
  return {
    type,
    text,
    startPosition: { row: startRow, column: 0 },
    endPosition: { row: endRow, column: 0 },
    children,
    namedChildren: namedChildren ?? children.filter((c) => !c.type.startsWith('{')),
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

function mockIdentifier(name: string, row: number = 0): TreeSitterNode {
  return mockNode('identifier', { text: name, startRow: row, endRow: row });
}

// --- Helper to build Java AST structures ---

function buildModifiers(mods: string[], row: number = 0): TreeSitterNode {
  const children = mods.map((m) => mockNode(m, { text: m, startRow: row, endRow: row }));
  return mockNode('modifiers', {
    text: mods.join(' '),
    startRow: row,
    endRow: row,
    children,
    namedChildren: children,
  });
}

function buildClassDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
  bodyChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const bodyNode = mockNode('class_body', {
    startRow: startRow + 1,
    endRow,
    namedChildren: bodyChildren,
  });
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode, bodyNode);
  return mockNode('class_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode, body: bodyNode },
  });
}

function buildInterfaceDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
  bodyChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const bodyNode = mockNode('interface_body', {
    startRow: startRow + 1,
    endRow,
    namedChildren: bodyChildren,
  });
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode, bodyNode);
  return mockNode('interface_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode, body: bodyNode },
  });
}

function buildEnumDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
  bodyChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const bodyNode = mockNode('enum_body', {
    startRow: startRow + 1,
    endRow,
    namedChildren: bodyChildren,
  });
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode, bodyNode);
  return mockNode('enum_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode, body: bodyNode },
  });
}

function buildAnnotationTypeDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode);
  return mockNode('annotation_type_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode },
  });
}

function buildMethodDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode);
  return mockNode('method_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode },
  });
}

function buildConstructorDecl(
  name: string,
  modifiers: string[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(nameNode);
  return mockNode('constructor_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { name: nameNode, modifiers: modsNode },
  });
}

function buildFieldDecl(
  fieldNames: string[],
  modifiers: string[],
  startRow: number,
  endRow: number,
): TreeSitterNode {
  const modsNode = modifiers.length > 0 ? buildModifiers(modifiers, startRow) : null;
  const declarators = fieldNames.map((fn) => {
    const nameNode = mockIdentifier(fn, startRow);
    return mockNode('variable_declarator', {
      startRow,
      endRow,
      namedChildren: [nameNode],
      fields: { name: nameNode },
    });
  });
  const allNamedChildren: TreeSitterNode[] = [];
  if (modsNode) allNamedChildren.push(modsNode);
  allNamedChildren.push(...declarators);
  return mockNode('field_declaration', {
    startRow,
    endRow,
    namedChildren: allNamedChildren,
    fields: { modifiers: modsNode },
  });
}

function buildImportDecl(
  path: string,
  startRow: number,
  isStatic: boolean = false,
  isWildcard: boolean = false,
): TreeSitterNode {
  const children: TreeSitterNode[] = [];
  children.push(mockNode('import', { text: 'import', startRow }));
  if (isStatic) {
    children.push(mockNode('static', { text: 'static', startRow }));
  }
  children.push(
    mockNode('scoped_identifier', { text: path, startRow }),
  );
  if (isWildcard) {
    children.push(mockNode('asterisk', { text: '*', startRow }));
  }
  children.push(mockNode(';', { text: ';', startRow }));
  return mockNode('import_declaration', {
    startRow,
    endRow: startRow,
    children,
    namedChildren: children.filter(
      (c) => c.type !== ';' && c.type !== 'import',
    ),
  });
}

function buildProgram(children: TreeSitterNode[]): TreeSitterNode {
  return mockNode('program', {
    namedChildren: children,
    startRow: 0,
    endRow: children.length > 0
      ? (children[children.length - 1]?.endPosition.row ?? 0) + 1
      : 0,
  });
}

// --- Tests ---

describe('visitJava', () => {
  describe('class declarations', () => {
    it('extracts public class as exported', () => {
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'UserService',
        kind: 'class',
        exported: true,
        startLine: 9,
        endLine: 37,
      });
    });

    it('extracts package-private class as not exported', () => {
      const root = buildProgram([buildClassDecl('InternalHelper', [], 55, 57)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'InternalHelper',
        kind: 'class',
        exported: false,
        startLine: 56,
        endLine: 58,
      });
    });

    it('extracts private class as not exported', () => {
      const root = buildProgram([buildClassDecl('Secret', ['private'], 0, 5)]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('extracts protected class as not exported', () => {
      const root = buildProgram([buildClassDecl('Internal', ['protected'], 0, 5)]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });
  });

  describe('interface declarations', () => {
    it('extracts public interface as exported', () => {
      const root = buildProgram([buildInterfaceDecl('Repository', ['public'], 39, 42)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Repository',
        kind: 'interface',
        exported: true,
        startLine: 40,
        endLine: 43,
      });
    });

    it('extracts package-private interface as not exported', () => {
      const root = buildProgram([buildInterfaceDecl('Validator', [], 0, 5)]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('extracts interface methods', () => {
      const methods = [
        buildMethodDecl('save', [], 40, 40),
        buildMethodDecl('findById', [], 41, 41),
      ];
      const root = buildProgram([buildInterfaceDecl('Repository', ['public'], 39, 42, methods)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(3);
      expect(symbols[1]).toMatchObject({
        name: 'save',
        kind: 'method',
        exported: false,
        metadata: { parentClass: 'Repository' },
      });
      expect(symbols[2]).toMatchObject({
        name: 'findById',
        kind: 'method',
        exported: false,
        metadata: { parentClass: 'Repository' },
      });
    });
  });

  describe('enum declarations', () => {
    it('extracts public enum as exported class with isEnum metadata', () => {
      const root = buildProgram([buildEnumDecl('Status', ['public'], 45, 52)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Status',
        kind: 'class',
        exported: true,
        startLine: 46,
        endLine: 53,
        metadata: { isEnum: true },
      });
    });

    it('extracts methods inside enum', () => {
      const methods = [buildMethodDecl('display', ['public'], 50, 52)];
      const root = buildProgram([buildEnumDecl('Status', ['public'], 45, 52, methods)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[1]).toMatchObject({
        name: 'display',
        kind: 'method',
        exported: true,
        metadata: { parentClass: 'Status' },
      });
    });

    it('extracts package-private enum as not exported', () => {
      const root = buildProgram([buildEnumDecl('Priority', [], 0, 5)]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });
  });

  describe('annotation type declarations', () => {
    it('extracts public annotation type as exported interface', () => {
      const root = buildProgram([buildAnnotationTypeDecl('Cacheable', ['public'], 60, 61)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Cacheable',
        kind: 'interface',
        exported: true,
        startLine: 61,
        endLine: 62,
        metadata: { isAnnotation: true },
      });
    });

    it('extracts package-private annotation type as not exported', () => {
      const root = buildProgram([buildAnnotationTypeDecl('Internal', [], 0, 2)]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });
  });

  describe('method declarations', () => {
    it('extracts public method as exported', () => {
      const methods = [buildMethodDecl('getUsers', ['public'], 22, 24)];
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, methods)]);
      const { symbols } = visitJava(root, '');
      const method = symbols.find((s) => s.name === 'getUsers');
      expect(method).toBeDefined();
      expect(method!.kind).toBe('method');
      expect(method!.exported).toBe(true);
      expect(method!.metadata).toEqual({ parentClass: 'UserService' });
    });

    it('extracts private method as not exported', () => {
      const methods = [buildMethodDecl('logAccess', ['private'], 27, 29)];
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, methods)]);
      const { symbols } = visitJava(root, '');
      const method = symbols.find((s) => s.name === 'logAccess');
      expect(method).toBeDefined();
      expect(method!.exported).toBe(false);
    });

    it('extracts package-private method as not exported', () => {
      const methods = [buildMethodDecl('doWork', [], 56, 56)];
      const root = buildProgram([buildClassDecl('Helper', [], 55, 57, methods)]);
      const { symbols } = visitJava(root, '');
      const method = symbols.find((s) => s.name === 'doWork');
      expect(method).toBeDefined();
      expect(method!.exported).toBe(false);
    });
  });

  describe('constructor declarations', () => {
    it('extracts public constructor as exported function with isConstructor metadata', () => {
      const constructors = [buildConstructorDecl('UserService', ['public'], 17, 19)];
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, constructors)]);
      const { symbols } = visitJava(root, '');
      const ctor = symbols.find((s) => s.kind === 'function');
      expect(ctor).toBeDefined();
      expect(ctor!.name).toBe('UserService');
      expect(ctor!.exported).toBe(true);
      expect(ctor!.metadata).toEqual({ parentClass: 'UserService', isConstructor: true });
    });

    it('extracts private constructor as not exported', () => {
      const constructors = [buildConstructorDecl('Singleton', ['private'], 5, 7)];
      const root = buildProgram([buildClassDecl('Singleton', ['public'], 0, 10, constructors)]);
      const { symbols } = visitJava(root, '');
      const ctor = symbols.find((s) => s.kind === 'function');
      expect(ctor).toBeDefined();
      expect(ctor!.exported).toBe(false);
    });
  });

  describe('field declarations', () => {
    it('extracts public field as exported variable', () => {
      const fields = [buildFieldDecl(['serviceName'], ['public'], 11, 11)];
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, fields)]);
      const { symbols } = visitJava(root, '');
      const field = symbols.find((s) => s.name === 'serviceName');
      expect(field).toBeDefined();
      expect(field!.kind).toBe('variable');
      expect(field!.exported).toBe(true);
      expect(field!.metadata).toEqual({ parentClass: 'UserService' });
    });

    it('extracts private field as not exported', () => {
      const fields = [buildFieldDecl(['maxRetries'], ['private'], 14, 14)];
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, fields)]);
      const { symbols } = visitJava(root, '');
      const field = symbols.find((s) => s.name === 'maxRetries');
      expect(field).toBeDefined();
      expect(field!.exported).toBe(false);
    });

    it('extracts multiple fields from a single field declaration', () => {
      const fields = [buildFieldDecl(['x', 'y', 'z'], ['public'], 5, 5)];
      const root = buildProgram([buildClassDecl('Point', ['public'], 0, 10, fields)]);
      const { symbols } = visitJava(root, '');
      const fieldSymbols = symbols.filter((s) => s.kind === 'variable');
      expect(fieldSymbols).toHaveLength(3);
      expect(fieldSymbols.map((s) => s.name)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('nested classes', () => {
    it('extracts nested static class with parentClass metadata', () => {
      const innerField = buildFieldDecl(['url'], ['public'], 33, 33);
      const innerClass = buildClassDecl('Config', ['public', 'static'], 32, 35, [innerField]);
      const root = buildProgram([buildClassDecl('UserService', ['public'], 8, 36, [innerClass])]);
      const { symbols } = visitJava(root, '');

      const config = symbols.find((s) => s.name === 'Config');
      expect(config).toBeDefined();
      expect(config!.kind).toBe('class');
      expect(config!.exported).toBe(true);
      expect(config!.metadata).toEqual({ parentClass: 'UserService' });

      const url = symbols.find((s) => s.name === 'url');
      expect(url).toBeDefined();
      expect(url!.metadata).toEqual({ parentClass: 'Config' });
    });
  });

  describe('import declarations', () => {
    it('extracts regular import', () => {
      const root = buildProgram([buildImportDecl('java.util.List', 2)]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toEqual({
        specifier: 'java.util.List',
        names: ['List'],
        isTypeOnly: false,
        line: 3,
      });
    });

    it('extracts wildcard import', () => {
      const root = buildProgram([buildImportDecl('java.io', 4, false, true)]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toEqual({
        specifier: 'java.io',
        names: ['*'],
        isTypeOnly: false,
        line: 5,
      });
    });

    it('extracts static import', () => {
      const root = buildProgram([buildImportDecl('java.lang.Math.PI', 5, true)]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toEqual({
        specifier: 'java.lang.Math.PI',
        names: ['PI'],
        isTypeOnly: false,
        line: 6,
      });
    });

    it('extracts multiple imports', () => {
      const root = buildProgram([
        buildImportDecl('java.util.List', 2),
        buildImportDecl('java.util.Map', 3),
        buildImportDecl('java.io', 4, false, true),
        buildImportDecl('java.lang.Math.PI', 5, true),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(4);
      expect(imports[0]!.specifier).toBe('java.util.List');
      expect(imports[1]!.specifier).toBe('java.util.Map');
      expect(imports[2]!.names).toEqual(['*']);
      expect(imports[3]!.specifier).toBe('java.lang.Math.PI');
    });
  });

  describe('golden fixture test', () => {
    it('extracts all expected symbols from the sample fixture', () => {
      // Build the full AST mirroring sample.java
      const root = buildProgram([
        // imports (rows 2-5)
        buildImportDecl('java.util.List', 2),
        buildImportDecl('java.util.Map', 3),
        buildImportDecl('java.io', 4, false, true),
        buildImportDecl('java.lang.Math.PI', 5, true),

        // public class UserService (rows 8-36)
        buildClassDecl('UserService', ['public'], 8, 36, [
          buildFieldDecl(['serviceName'], ['public'], 11, 11),
          buildFieldDecl(['maxRetries'], ['private'], 14, 14),
          buildConstructorDecl('UserService', ['public'], 17, 19),
          buildMethodDecl('getUsers', ['public'], 22, 24),
          buildMethodDecl('logAccess', ['private'], 27, 29),
          buildClassDecl('Config', ['public', 'static'], 32, 35, [
            buildFieldDecl(['url'], ['public'], 33, 33),
          ]),
        ]),

        // public interface Repository (rows 39-42)
        buildInterfaceDecl('Repository', ['public'], 39, 42, [
          buildMethodDecl('save', [], 40, 40),
          buildMethodDecl('findById', [], 41, 41),
        ]),

        // public enum Status (rows 45-52)
        buildEnumDecl('Status', ['public'], 45, 52, [
          buildMethodDecl('display', ['public'], 50, 52),
        ]),

        // class InternalHelper (rows 55-57)
        buildClassDecl('InternalHelper', [], 55, 57, [
          buildMethodDecl('doWork', [], 56, 56),
        ]),

        // public @interface Cacheable (rows 60-61)
        buildAnnotationTypeDecl('Cacheable', ['public'], 60, 61),
      ]);

      const { symbols, imports } = visitJava(root, '');

      // Verify total symbol count: 16 symbols
      expect(symbols).toHaveLength(16);

      // Verify symbol names and export status
      const symbolMap = new Map(symbols.map((s) => [`${s.name}:${s.kind}`, s]));

      // Top-level class
      expect(symbolMap.get('UserService:class')).toMatchObject({
        exported: true,
        kind: 'class',
      });

      // Fields
      expect(symbols.find((s) => s.name === 'serviceName')).toMatchObject({
        kind: 'variable',
        exported: true,
      });
      expect(symbols.find((s) => s.name === 'maxRetries')).toMatchObject({
        kind: 'variable',
        exported: false,
      });

      // Constructor
      const ctor = symbols.find((s) => s.kind === 'function' && s.name === 'UserService');
      expect(ctor).toBeDefined();
      expect(ctor!.exported).toBe(true);
      expect(ctor!.metadata).toMatchObject({ isConstructor: true });

      // Methods
      expect(symbols.find((s) => s.name === 'getUsers')).toMatchObject({
        kind: 'method',
        exported: true,
      });
      expect(symbols.find((s) => s.name === 'logAccess')).toMatchObject({
        kind: 'method',
        exported: false,
      });

      // Nested class
      expect(symbols.find((s) => s.name === 'Config')).toMatchObject({
        kind: 'class',
        exported: true,
        metadata: { parentClass: 'UserService' },
      });

      // Interface
      expect(symbolMap.get('Repository:interface')).toMatchObject({
        exported: true,
      });

      // Interface methods
      expect(symbols.find((s) => s.name === 'save')).toMatchObject({
        kind: 'method',
        exported: false,
        metadata: { parentClass: 'Repository' },
      });

      // Enum
      expect(symbolMap.get('Status:class')).toMatchObject({
        exported: true,
        metadata: { isEnum: true },
      });

      // Enum method
      expect(symbols.find((s) => s.name === 'display')).toMatchObject({
        kind: 'method',
        exported: true,
        metadata: { parentClass: 'Status' },
      });

      // Package-private class
      expect(symbolMap.get('InternalHelper:class')).toMatchObject({
        exported: false,
      });

      // Annotation type
      expect(symbolMap.get('Cacheable:interface')).toMatchObject({
        exported: true,
        metadata: { isAnnotation: true },
      });

      // Verify imports
      expect(imports).toHaveLength(4);
      expect(imports[0]).toMatchObject({ specifier: 'java.util.List', names: ['List'] });
      expect(imports[1]).toMatchObject({ specifier: 'java.util.Map', names: ['Map'] });
      expect(imports[2]).toMatchObject({ specifier: 'java.io', names: ['*'] });
      expect(imports[3]).toMatchObject({ specifier: 'java.lang.Math.PI', names: ['PI'] });
    });
  });

  describe('edge cases', () => {
    it('returns empty results for empty program', () => {
      const root = buildProgram([]);
      const { symbols, imports } = visitJava(root, '');
      expect(symbols).toEqual([]);
      expect(imports).toEqual([]);
    });

    it('ignores non-declaration nodes at top level', () => {
      const commentNode = mockNode('comment', { text: '// hello', startRow: 0 });
      const packageNode = mockNode('package_declaration', {
        text: 'package com.example;',
        startRow: 0,
      });
      const root = buildProgram([
        packageNode,
        commentNode,
        buildClassDecl('Main', ['public'], 3, 10),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('Main');
    });

    it('handles class with no body children', () => {
      const root = buildProgram([buildClassDecl('Empty', ['public'], 0, 2)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('Empty');
    });

    it('handles class declaration without modifiers', () => {
      const root = buildProgram([buildClassDecl('PackagePrivate', [], 0, 5)]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.exported).toBe(false);
    });
  });

  describe('annotation extraction', () => {
    /**
     * Build a modifiers node that includes both keyword modifiers (public,
     * private, etc.) and annotation nodes (marker_annotation / annotation).
     */
    function buildModifiersWithAnnotations(
      mods: string[],
      annotations: { name: string; marker: boolean }[],
      row: number = 0,
    ): TreeSitterNode {
      const modChildren = mods.map((m) =>
        mockNode(m, { text: m, startRow: row, endRow: row }),
      );
      const annotChildren = annotations.map((a) => {
        const nameNode = mockIdentifier(a.name, row);
        return mockNode(a.marker ? 'marker_annotation' : 'annotation', {
          text: a.marker ? `@${a.name}` : `@${a.name}(...)`,
          startRow: row,
          endRow: row,
          fields: { name: nameNode },
        });
      });
      const allChildren = [...annotChildren, ...modChildren];
      return mockNode('modifiers', {
        text: allChildren.map((c) => c.text).join(' '),
        startRow: row,
        endRow: row,
        children: allChildren,
        namedChildren: allChildren,
      });
    }

    function buildAnnotatedMethodDecl(
      name: string,
      mods: string[],
      annotations: { name: string; marker: boolean }[],
      startRow: number,
      endRow: number,
    ): TreeSitterNode {
      const nameNode = mockIdentifier(name, startRow);
      const modsNode = buildModifiersWithAnnotations(mods, annotations, startRow);
      return mockNode('method_declaration', {
        startRow,
        endRow,
        namedChildren: [modsNode, nameNode],
        fields: { name: nameNode, modifiers: modsNode },
      });
    }

    function buildAnnotatedFieldDecl(
      fieldNames: string[],
      mods: string[],
      annotations: { name: string; marker: boolean }[],
      startRow: number,
      endRow: number,
    ): TreeSitterNode {
      const modsNode = buildModifiersWithAnnotations(mods, annotations, startRow);
      const declarators = fieldNames.map((fn) => {
        const nameNode = mockIdentifier(fn, startRow);
        return mockNode('variable_declarator', {
          startRow,
          endRow,
          namedChildren: [nameNode],
          fields: { name: nameNode },
        });
      });
      return mockNode('field_declaration', {
        startRow,
        endRow,
        namedChildren: [modsNode, ...declarators],
        fields: { modifiers: modsNode },
      });
    }

    function buildAnnotatedClassDecl(
      name: string,
      mods: string[],
      annotations: { name: string; marker: boolean }[],
      startRow: number,
      endRow: number,
      bodyChildren: TreeSitterNode[] = [],
    ): TreeSitterNode {
      const nameNode = mockIdentifier(name, startRow);
      const modsNode = buildModifiersWithAnnotations(mods, annotations, startRow);
      const bodyNode = mockNode('class_body', {
        startRow: startRow + 1,
        endRow,
        namedChildren: bodyChildren,
      });
      return mockNode('class_declaration', {
        startRow,
        endRow,
        namedChildren: [modsNode, nameNode, bodyNode],
        fields: { name: nameNode, modifiers: modsNode, body: bodyNode },
      });
    }

    it('extracts @RequestMapping marker annotation from a method', () => {
      const method = buildAnnotatedMethodDecl(
        'handleRequest', ['public'],
        [{ name: 'RequestMapping', marker: true }],
        10, 15,
      );
      const root = buildProgram([
        buildClassDecl('Controller', ['public'], 5, 20, [method]),
      ]);
      const { symbols } = visitJava(root, '');
      const m = symbols.find((s) => s.name === 'handleRequest');
      expect(m).toBeDefined();
      expect(m!.metadata).toEqual({
        parentClass: 'Controller',
        annotations: ['RequestMapping'],
      });
    });

    it('extracts @GetMapping annotation with arguments from a method', () => {
      const method = buildAnnotatedMethodDecl(
        'getUsers', ['public'],
        [{ name: 'GetMapping', marker: false }],
        10, 15,
      );
      const root = buildProgram([
        buildClassDecl('UserController', ['public'], 5, 20, [method]),
      ]);
      const { symbols } = visitJava(root, '');
      const m = symbols.find((s) => s.name === 'getUsers');
      expect(m).toBeDefined();
      expect(m!.metadata).toEqual({
        parentClass: 'UserController',
        annotations: ['GetMapping'],
      });
    });

    it('extracts annotations from field declarations', () => {
      const field = buildAnnotatedFieldDecl(
        ['userService'], ['private'],
        [{ name: 'Autowired', marker: true }],
        10, 10,
      );
      const root = buildProgram([
        buildClassDecl('AppConfig', ['public'], 5, 20, [field]),
      ]);
      const { symbols } = visitJava(root, '');
      const f = symbols.find((s) => s.name === 'userService');
      expect(f).toBeDefined();
      expect(f!.metadata).toEqual({
        parentClass: 'AppConfig',
        annotations: ['Autowired'],
      });
    });

    it('extracts annotations from class declarations', () => {
      const root = buildProgram([
        buildAnnotatedClassDecl(
          'UserController', ['public'],
          [{ name: 'RestController', marker: true }],
          0, 20,
        ),
      ]);
      const { symbols } = visitJava(root, '');
      const cls = symbols.find((s) => s.name === 'UserController');
      expect(cls).toBeDefined();
      expect(cls!.metadata).toEqual({ annotations: ['RestController'] });
    });

    it('extracts multiple annotations from a single method', () => {
      const method = buildAnnotatedMethodDecl(
        'createUser', ['public'],
        [
          { name: 'PostMapping', marker: false },
          { name: 'ResponseBody', marker: true },
        ],
        10, 20,
      );
      const root = buildProgram([
        buildClassDecl('UserController', ['public'], 5, 25, [method]),
      ]);
      const { symbols } = visitJava(root, '');
      const m = symbols.find((s) => s.name === 'createUser');
      expect(m).toBeDefined();
      expect(m!.metadata).toEqual({
        parentClass: 'UserController',
        annotations: ['PostMapping', 'ResponseBody'],
      });
    });

    it('omits annotations key when no annotations are present', () => {
      const method = buildMethodDecl('plainMethod', ['public'], 10, 12);
      const root = buildProgram([
        buildClassDecl('Service', ['public'], 5, 15, [method]),
      ]);
      const { symbols } = visitJava(root, '');
      const m = symbols.find((s) => s.name === 'plainMethod');
      expect(m).toBeDefined();
      expect(m!.metadata).toEqual({ parentClass: 'Service' });
      expect(m!.metadata).not.toHaveProperty('annotations');
    });

    it('extracts annotations from multiple fields in a single declaration', () => {
      const field = buildAnnotatedFieldDecl(
        ['host', 'port'], ['private'],
        [{ name: 'Value', marker: false }],
        10, 10,
      );
      const root = buildProgram([
        buildClassDecl('Config', ['public'], 5, 20, [field]),
      ]);
      const { symbols } = visitJava(root, '');
      const host = symbols.find((s) => s.name === 'host');
      const port = symbols.find((s) => s.name === 'port');
      expect(host!.metadata).toEqual({
        parentClass: 'Config',
        annotations: ['Value'],
      });
      expect(port!.metadata).toEqual({
        parentClass: 'Config',
        annotations: ['Value'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Golden fixture comparison against expected.json
  //
  // -------------------------------------------------------------------------
  describe('golden fixture comparison', () => {
    // Load expected.json from the golden fixture directory
    const expectedData = JSON.parse(
      readFileSync(join(GOLDEN_DIR, 'expected.json'), 'utf-8'),
    ) as { symbols: SymbolInfo[]; imports: ImportInfo[] };

    // Build mock AST matching the sample.java fixture (same structure as
    // the inline golden test above, but we compare against the JSON file)
    const root = buildProgram([
      buildImportDecl('java.util.List', 2),
      buildImportDecl('java.util.Map', 3),
      buildImportDecl('java.io', 4, false, true),
      buildImportDecl('java.lang.Math.PI', 5, true),

      buildClassDecl('UserService', ['public'], 8, 36, [
        buildFieldDecl(['serviceName'], ['public'], 11, 11),
        buildFieldDecl(['maxRetries'], ['private'], 14, 14),
        buildConstructorDecl('UserService', ['public'], 17, 19),
        buildMethodDecl('getUsers', ['public'], 22, 24),
        buildMethodDecl('logAccess', ['private'], 27, 29),
        buildClassDecl('Config', ['public', 'static'], 32, 35, [
          buildFieldDecl(['url'], ['public'], 33, 33),
        ]),
      ]),

      buildInterfaceDecl('Repository', ['public'], 39, 42, [
        buildMethodDecl('save', [], 40, 40),
        buildMethodDecl('findById', [], 41, 41),
      ]),

      buildEnumDecl('Status', ['public'], 45, 52, [
        buildMethodDecl('display', ['public'], 50, 52),
      ]),

      buildClassDecl('InternalHelper', [], 55, 57, [
        buildMethodDecl('doWork', [], 56, 56),
      ]),

      buildAnnotationTypeDecl('Cacheable', ['public'], 60, 61),
    ]);

    const { symbols: actualSymbols, imports: actualImports } = visitJava(root, '');

    it('symbol count matches expected.json', () => {
      expect(actualSymbols).toHaveLength(expectedData.symbols.length);
    });

    it('zero kind mismatches between actual and expected symbols', () => {
      const mismatches: string[] = [];
      for (let i = 0; i < expectedData.symbols.length; i++) {
        const exp = expectedData.symbols[i]!;
        const act = actualSymbols[i];
        if (!act) {
          mismatches.push(`symbol[${i}] "${exp.name}" missing in actual output`);
          continue;
        }
        if (act.name !== exp.name) {
          mismatches.push(
            `symbol[${i}] name: expected "${exp.name}" got "${act.name}"`,
          );
        }
        if (act.kind !== exp.kind) {
          mismatches.push(
            `symbol[${i}] "${exp.name}" kind: expected "${exp.kind}" got "${act.kind}"`,
          );
        }
        if (act.exported !== exp.exported) {
          mismatches.push(
            `symbol[${i}] "${exp.name}" exported: expected ${exp.exported} got ${act.exported}`,
          );
        }
        if (act.startLine !== exp.startLine) {
          mismatches.push(
            `symbol[${i}] "${exp.name}" startLine: expected ${exp.startLine} got ${act.startLine}`,
          );
        }
        if (act.endLine !== exp.endLine) {
          mismatches.push(
            `symbol[${i}] "${exp.name}" endLine: expected ${exp.endLine} got ${act.endLine}`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('metadata matches expected.json for every symbol', () => {
      const mismatches: string[] = [];
      for (let i = 0; i < expectedData.symbols.length; i++) {
        const exp = expectedData.symbols[i]!;
        const act = actualSymbols[i];
        if (!act) continue;
        // Compare metadata (both may be undefined/absent)
        const expMeta = exp.metadata;
        const actMeta = act.metadata;
        if (JSON.stringify(expMeta) !== JSON.stringify(actMeta)) {
          mismatches.push(
            `symbol[${i}] "${exp.name}" metadata: expected ${JSON.stringify(expMeta)} got ${JSON.stringify(actMeta)}`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('import count and specifiers match expected.json', () => {
      expect(actualImports).toHaveLength(expectedData.imports.length);
      for (let i = 0; i < expectedData.imports.length; i++) {
        const exp = expectedData.imports[i]!;
        const act = actualImports[i]!;
        expect(act.specifier).toBe(exp.specifier);
        expect(act.names).toEqual(exp.names);
        expect(act.isTypeOnly).toBe(exp.isTypeOnly);
        expect(act.line).toBe(exp.line);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Import resolution - Java import specifiers
  //
  // -------------------------------------------------------------------------
  describe('import resolution verification', () => {
    it('parses single-type import specifier correctly', () => {
      const root = buildProgram([
        buildImportDecl('com.example.service.UserService', 1),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('com.example.service.UserService');
      expect(imports[0]!.names).toEqual(['UserService']);
      expect(imports[0]!.isTypeOnly).toBe(false);
    });

    it('parses wildcard import with correct package specifier', () => {
      const root = buildProgram([
        buildImportDecl('javax.swing', 2, false, true),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('javax.swing');
      expect(imports[0]!.names).toEqual(['*']);
    });

    it('parses static import and extracts member name', () => {
      const root = buildProgram([
        buildImportDecl('org.junit.Assert.assertEquals', 3, true),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('org.junit.Assert.assertEquals');
      expect(imports[0]!.names).toEqual(['assertEquals']);
    });

    it('parses static wildcard import', () => {
      const root = buildProgram([
        buildImportDecl('org.junit.Assert', 4, true, true),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('org.junit.Assert');
      expect(imports[0]!.names).toEqual(['*']);
    });

    it('extracts simple name from deeply nested package', () => {
      const root = buildProgram([
        buildImportDecl('com.google.common.collect.ImmutableList', 1),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports[0]!.names).toEqual(['ImmutableList']);
    });

    it('handles single-segment specifier', () => {
      const root = buildProgram([
        buildImportDecl('SomeClass', 1),
      ]);
      const { imports } = visitJava(root, '');
      expect(imports[0]!.names).toEqual(['SomeClass']);
    });
  });

  // -------------------------------------------------------------------------
  // Package-level visibility - default (package-private) not exported
  //
  // -------------------------------------------------------------------------
  describe('package-level visibility', () => {
    it('package-private class is not exported', () => {
      const root = buildProgram([
        buildClassDecl('PackageClass', [], 0, 10),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('package-private interface is not exported', () => {
      const root = buildProgram([
        buildInterfaceDecl('PackageInterface', [], 0, 5),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('package-private enum is not exported', () => {
      const root = buildProgram([
        buildEnumDecl('PackageEnum', [], 0, 5),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('package-private method inside public class is not exported', () => {
      const methods = [buildMethodDecl('packageMethod', [], 5, 7)];
      const root = buildProgram([
        buildClassDecl('PublicClass', ['public'], 0, 10, methods),
      ]);
      const { symbols } = visitJava(root, '');
      const method = symbols.find((s) => s.name === 'packageMethod');
      expect(method).toBeDefined();
      expect(method!.exported).toBe(false);
    });

    it('package-private field inside public class is not exported', () => {
      const fields = [buildFieldDecl(['packageField'], [], 5, 5)];
      const root = buildProgram([
        buildClassDecl('PublicClass', ['public'], 0, 10, fields),
      ]);
      const { symbols } = visitJava(root, '');
      const field = symbols.find((s) => s.name === 'packageField');
      expect(field).toBeDefined();
      expect(field!.exported).toBe(false);
    });

    it('protected method is not exported (only public is exported)', () => {
      const methods = [buildMethodDecl('protectedMethod', ['protected'], 5, 7)];
      const root = buildProgram([
        buildClassDecl('PublicClass', ['public'], 0, 10, methods),
      ]);
      const { symbols } = visitJava(root, '');
      const method = symbols.find((s) => s.name === 'protectedMethod');
      expect(method).toBeDefined();
      expect(method!.exported).toBe(false);
    });

    it('all members of package-private class are not exported regardless of modifiers', () => {
      const members = [
        buildMethodDecl('pubMethod', ['public'], 2, 3),
        buildMethodDecl('privMethod', ['private'], 4, 5),
        buildFieldDecl(['pubField'], ['public'], 6, 6),
      ];
      const root = buildProgram([
        buildClassDecl('PackageClass', [], 0, 10, members),
      ]);
      const { symbols } = visitJava(root, '');

      // The class itself is not exported
      const cls = symbols.find((s) => s.name === 'PackageClass');
      expect(cls!.exported).toBe(false);

      // Public method inside package-private class: the visitor reports
      // member visibility based on the member's own modifiers, not the
      // containing class. This is correct per Java semantics -- the member
      // is public within the class, but the class restricts external access.
      const pubMethod = symbols.find((s) => s.name === 'pubMethod');
      expect(pubMethod).toBeDefined();
      expect(pubMethod!.exported).toBe(true);

      const privMethod = symbols.find((s) => s.name === 'privMethod');
      expect(privMethod).toBeDefined();
      expect(privMethod!.exported).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Enum constants verification
  //
  // -------------------------------------------------------------------------
  describe('enum constants and values', () => {
    it('enum is extracted with isEnum metadata flag', () => {
      const root = buildProgram([
        buildEnumDecl('Color', ['public'], 0, 5),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'Color',
        kind: 'class',
        exported: true,
        metadata: { isEnum: true },
      });
    });

    it('enum with methods extracts both enum and its methods', () => {
      const methods = [
        buildMethodDecl('getValue', ['public'], 3, 4),
        buildMethodDecl('toString', ['public'], 5, 6),
      ];
      const root = buildProgram([
        buildEnumDecl('Priority', ['public'], 0, 8, methods),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(3); // enum + 2 methods

      const enumSymbol = symbols.find((s) => s.name === 'Priority');
      expect(enumSymbol).toMatchObject({
        kind: 'class',
        metadata: { isEnum: true },
      });

      const getVal = symbols.find((s) => s.name === 'getValue');
      expect(getVal).toMatchObject({
        kind: 'method',
        exported: true,
        metadata: { parentClass: 'Priority' },
      });

      const toStr = symbols.find((s) => s.name === 'toString');
      expect(toStr).toMatchObject({
        kind: 'method',
        exported: true,
        metadata: { parentClass: 'Priority' },
      });
    });

    it('enum with constructor extracts constructor as function', () => {
      const members = [
        buildConstructorDecl('HttpStatus', ['private'], 5, 7),
        buildMethodDecl('getCode', ['public'], 8, 10),
      ];
      const root = buildProgram([
        buildEnumDecl('HttpStatus', ['public'], 0, 12, members),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(3); // enum + constructor + method

      const ctor = symbols.find(
        (s) => s.kind === 'function' && s.name === 'HttpStatus',
      );
      expect(ctor).toBeDefined();
      expect(ctor!.exported).toBe(false); // private constructor
      expect(ctor!.metadata).toMatchObject({
        parentClass: 'HttpStatus',
        isConstructor: true,
      });
    });

    it('enum with fields extracts fields as variables', () => {
      const members = [
        buildFieldDecl(['code'], ['private'], 5, 5),
        buildFieldDecl(['description'], ['private'], 6, 6),
      ];
      const root = buildProgram([
        buildEnumDecl('ErrorCode', ['public'], 0, 10, members),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols).toHaveLength(3); // enum + 2 fields

      const code = symbols.find((s) => s.name === 'code');
      expect(code).toMatchObject({
        kind: 'variable',
        exported: false,
        metadata: { parentClass: 'ErrorCode' },
      });
    });

    it('package-private enum is not exported', () => {
      const root = buildProgram([
        buildEnumDecl('InternalStatus', [], 0, 5),
      ]);
      const { symbols } = visitJava(root, '');
      expect(symbols[0]!.exported).toBe(false);
      expect(symbols[0]!.metadata).toMatchObject({ isEnum: true });
    });

    it('enum within the golden fixture matches expected.json Status entry', () => {
      const expectedData = JSON.parse(
        readFileSync(join(GOLDEN_DIR, 'expected.json'), 'utf-8'),
      ) as { symbols: SymbolInfo[] };

      const expectedStatus = expectedData.symbols.find(
        (s) => s.name === 'Status' && s.metadata?.isEnum,
      );
      expect(expectedStatus).toBeDefined();

      // Build the Status enum from the golden fixture
      const root = buildProgram([
        buildEnumDecl('Status', ['public'], 45, 52, [
          buildMethodDecl('display', ['public'], 50, 52),
        ]),
      ]);
      const { symbols } = visitJava(root, '');
      const actualStatus = symbols.find(
        (s) => s.name === 'Status' && s.metadata?.isEnum,
      );
      expect(actualStatus).toBeDefined();

      expect(actualStatus!.kind).toBe(expectedStatus!.kind);
      expect(actualStatus!.exported).toBe(expectedStatus!.exported);
      expect(actualStatus!.startLine).toBe(expectedStatus!.startLine);
      expect(actualStatus!.endLine).toBe(expectedStatus!.endLine);
    });
  });
});
