/**
 * Tests for the Go AST visitor.
 * Uses mock TreeSitterNode structures to validate extraction logic
 * without requiring tree-sitter WASM grammars at test time.
 *
 */
import { describe, it, expect } from 'vitest';
import { visitGo } from '../visitors/go-visitor.js';
import type { TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

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

// --- Helper to build Go AST structures ---

function buildFuncDecl(
  name: string,
  startRow: number,
  endRow: number,
  bodyChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const bodyNode = mockNode('block', {
    startRow: startRow + 1,
    endRow,
    namedChildren: bodyChildren,
  });
  return mockNode('function_declaration', {
    startRow,
    endRow,
    namedChildren: [nameNode, bodyNode],
    fields: { name: nameNode, body: bodyNode },
  });
}

function buildMethodDecl(
  name: string,
  receiverType: string,
  startRow: number,
  endRow: number,
  pointer: boolean = true,
  bodyChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const typeText = pointer ? `*${receiverType}` : receiverType;
  const paramText = pointer ? `(s *${receiverType})` : `(s ${receiverType})`;
  const typeNode = pointer
    ? mockNode('pointer_type', { text: typeText, startRow })
    : mockNode('type_identifier', { text: typeText, startRow });
  const paramDecl = mockNode('parameter_declaration', {
    startRow,
    namedChildren: [mockIdentifier('s', startRow), typeNode],
    fields: { name: mockIdentifier('s', startRow), type: typeNode },
  });
  const receiverNode = mockNode('parameter_list', {
    text: paramText,
    startRow,
    namedChildren: [paramDecl],
  });
  const bodyNode = mockNode('block', {
    startRow: startRow + 1,
    endRow,
    namedChildren: bodyChildren,
  });
  return mockNode('method_declaration', {
    startRow,
    endRow,
    namedChildren: [receiverNode, nameNode, bodyNode],
    fields: { name: nameNode, receiver: receiverNode, body: bodyNode },
  });
}

function buildMethodSpec(name: string, startRow: number): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  return mockNode('method_spec', {
    startRow,
    endRow: startRow,
    namedChildren: [nameNode],
    fields: { name: nameNode },
  });
}

function buildFuncLiteral(startRow: number, endRow: number): TreeSitterNode {
  return mockNode('func_literal', {
    text: 'func() {}',
    startRow,
    endRow,
  });
}

function buildTypeSpec(
  name: string,
  typeKind: string,
  startRow: number,
  endRow: number,
  typeChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  const typeNode = mockNode(typeKind, { startRow, endRow, namedChildren: typeChildren });
  return mockNode('type_spec', {
    startRow,
    endRow,
    namedChildren: [nameNode, typeNode],
    fields: { name: nameNode, type: typeNode },
  });
}

function buildTypeDecl(specs: TreeSitterNode[], startRow: number, endRow: number): TreeSitterNode {
  return mockNode('type_declaration', {
    startRow,
    endRow,
    namedChildren: specs,
  });
}

function buildVarSpec(name: string, startRow: number): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  return mockNode('var_spec', {
    startRow,
    endRow: startRow,
    namedChildren: [nameNode],
    fields: { name: nameNode },
  });
}

function buildVarDecl(specs: TreeSitterNode[], startRow: number, endRow: number): TreeSitterNode {
  return mockNode('var_declaration', {
    startRow,
    endRow,
    namedChildren: specs,
  });
}

function buildConstSpec(name: string, startRow: number): TreeSitterNode {
  const nameNode = mockIdentifier(name, startRow);
  return mockNode('const_spec', {
    startRow,
    endRow: startRow,
    namedChildren: [nameNode],
    fields: { name: nameNode },
  });
}

function buildConstDecl(specs: TreeSitterNode[], startRow: number, endRow: number): TreeSitterNode {
  return mockNode('const_declaration', {
    startRow,
    endRow,
    namedChildren: specs,
  });
}

function buildImportSpec(
  path: string,
  alias: string | null,
  startRow: number,
): TreeSitterNode {
  const pathNode = mockNode('interpreted_string_literal', {
    text: `"${path}"`,
    startRow,
  });
  const nameNode = alias
    ? mockNode(alias === '.' ? 'dot' : 'package_identifier', {
        text: alias,
        startRow,
      })
    : null;

  const namedChildren: TreeSitterNode[] = [];
  if (nameNode) namedChildren.push(nameNode);
  namedChildren.push(pathNode);

  return mockNode('import_spec', {
    startRow,
    endRow: startRow,
    namedChildren,
    fields: { path: pathNode, name: nameNode },
  });
}

function buildImportDecl(
  specs: TreeSitterNode[],
  startRow: number,
  endRow: number,
  grouped: boolean = true,
): TreeSitterNode {
  if (grouped) {
    const specList = mockNode('import_spec_list', {
      startRow: startRow + 1,
      endRow: endRow - 1,
      namedChildren: specs,
    });
    return mockNode('import_declaration', {
      startRow,
      endRow,
      namedChildren: [specList],
    });
  }
  return mockNode('import_declaration', {
    startRow,
    endRow,
    namedChildren: specs,
  });
}

function buildSourceFile(children: TreeSitterNode[]): TreeSitterNode {
  return mockNode('source_file', {
    namedChildren: children,
    startRow: 0,
    endRow: children.length > 0
      ? (children[children.length - 1]?.endPosition.row ?? 0) + 1
      : 0,
  });
}

// --- Tests ---

describe('visitGo', () => {
  describe('function declarations', () => {
    it('extracts exported function (uppercase)', () => {
      const root = buildSourceFile([buildFuncDecl('HandleRequest', 11, 13)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'HandleRequest',
        kind: 'function',
        exported: true,
        startLine: 12,
        endLine: 14,
      });
    });

    it('extracts unexported function (lowercase)', () => {
      const root = buildSourceFile([buildFuncDecl('helperFunc', 16, 18)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'helperFunc',
        kind: 'function',
        exported: false,
        startLine: 17,
        endLine: 19,
      });
    });

    it('extracts multiple functions', () => {
      const root = buildSourceFile([
        buildFuncDecl('Main', 0, 2),
        buildFuncDecl('helper', 4, 6),
      ]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[0]!.name).toBe('Main');
      expect(symbols[0]!.exported).toBe(true);
      expect(symbols[1]!.name).toBe('helper');
      expect(symbols[1]!.exported).toBe(false);
    });
  });

  describe('method declarations', () => {
    it('extracts exported method', () => {
      const root = buildSourceFile([buildMethodDecl('Start', 'Server', 38, 40)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Start',
        kind: 'function',
        exported: true,
        startLine: 39,
        endLine: 41,
        metadata: { receiver: '*Server' },
      });
    });

    it('extracts unexported method', () => {
      const root = buildSourceFile([buildMethodDecl('listen', 'Server', 43, 45)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'listen',
        kind: 'function',
        exported: false,
        startLine: 44,
        endLine: 46,
        metadata: { receiver: '*Server' },
      });
    });
  });

  describe('type declarations', () => {
    it('extracts exported struct as kind=class', () => {
      const spec = buildTypeSpec('Server', 'struct_type', 21, 24);
      const root = buildSourceFile([buildTypeDecl([spec], 21, 24)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Server',
        kind: 'class',
        exported: true,
        startLine: 22,
        endLine: 25,
      });
    });

    it('extracts unexported struct', () => {
      const spec = buildTypeSpec('config', 'struct_type', 27, 29);
      const root = buildSourceFile([buildTypeDecl([spec], 27, 29)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('config');
      expect(symbols[0]!.kind).toBe('class');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('extracts exported interface', () => {
      const spec = buildTypeSpec('Handler', 'interface_type', 32, 35);
      const root = buildSourceFile([buildTypeDecl([spec], 32, 35)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Handler',
        kind: 'interface',
        exported: true,
        startLine: 33,
        endLine: 36,
      });
    });

    it('extracts unexported interface', () => {
      const spec = buildTypeSpec('validator', 'interface_type', 63, 65);
      const root = buildSourceFile([buildTypeDecl([spec], 63, 65)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('validator');
      expect(symbols[0]!.kind).toBe('interface');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('extracts type alias as kind=type', () => {
      const spec = buildTypeSpec('RequestID', 'type_identifier', 60, 60);
      const root = buildSourceFile([buildTypeDecl([spec], 60, 60)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'RequestID',
        kind: 'type',
        exported: true,
        startLine: 61,
        endLine: 61,
      });
    });

    it('handles grouped type declarations', () => {
      const specs = [
        buildTypeSpec('Foo', 'struct_type', 1, 3),
        buildTypeSpec('bar', 'interface_type', 4, 6),
      ];
      const root = buildSourceFile([buildTypeDecl(specs, 0, 7)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[0]!.kind).toBe('class');
      expect(symbols[0]!.exported).toBe(true);
      expect(symbols[1]!.kind).toBe('interface');
      expect(symbols[1]!.exported).toBe(false);
    });
  });

  describe('var declarations', () => {
    it('extracts exported variable', () => {
      const root = buildSourceFile([buildVarDecl([buildVarSpec('Version', 54)], 54, 54)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'Version',
        kind: 'variable',
        exported: true,
        startLine: 55,
        endLine: 55,
      });
    });

    it('extracts unexported variable', () => {
      const root = buildSourceFile([buildVarDecl([buildVarSpec('logger', 57)], 57, 57)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('logger');
      expect(symbols[0]!.exported).toBe(false);
    });

    it('handles grouped var declarations', () => {
      const root = buildSourceFile([
        buildVarDecl([buildVarSpec('Exported', 0), buildVarSpec('unexported', 1)], 0, 2),
      ]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(2);
      expect(symbols[0]!.exported).toBe(true);
      expect(symbols[1]!.exported).toBe(false);
    });
  });

  describe('const declarations', () => {
    it('extracts exported constant', () => {
      const root = buildSourceFile([buildConstDecl([buildConstSpec('MaxRetries', 48)], 48, 48)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'MaxRetries',
        kind: 'variable',
        exported: true,
        startLine: 49,
        endLine: 49,
      });
    });

    it('extracts unexported constant', () => {
      const root = buildSourceFile([
        buildConstDecl([buildConstSpec('defaultTimeout', 51)], 51, 51),
      ]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('defaultTimeout');
      expect(symbols[0]!.exported).toBe(false);
    });
  });

  describe('export convention (uppercase first letter)', () => {
    it('treats uppercase ASCII as exported', () => {
      const root = buildSourceFile([buildFuncDecl('Foo', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(true);
    });

    it('treats lowercase ASCII as unexported', () => {
      const root = buildSourceFile([buildFuncDecl('foo', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(false);
    });

    it('treats underscore-prefixed as unexported', () => {
      const root = buildSourceFile([buildFuncDecl('_private', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(false);
    });

    it('treats digit-prefixed as unexported', () => {
      const root = buildSourceFile([buildFuncDecl('3invalid', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(false);
    });

    it('treats Unicode uppercase as exported', () => {
      const root = buildSourceFile([buildFuncDecl('Éxample', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(true);
    });

    it('treats Unicode lowercase as unexported', () => {
      const root = buildSourceFile([buildFuncDecl('éxample', 0, 0)]);
      expect(visitGo(root, '').symbols[0]!.exported).toBe(false);
    });
  });

  describe('import declarations', () => {
    it('extracts single import', () => {
      const spec = buildImportSpec('fmt', null, 3);
      const root = buildSourceFile([buildImportDecl([spec], 2, 4, false)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toEqual({
        specifier: 'fmt',
        names: ['fmt'],
        isTypeOnly: false,
        line: 4,
      });
    });

    it('extracts grouped imports', () => {
      const specs = [
        buildImportSpec('fmt', null, 3),
        buildImportSpec('os', null, 4),
      ];
      const root = buildSourceFile([buildImportDecl(specs, 2, 5)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(2);
      expect(imports[0]!.specifier).toBe('fmt');
      expect(imports[1]!.specifier).toBe('os');
    });

    it('extracts aliased import', () => {
      const spec = buildImportSpec('net/http', 'h', 5);
      const root = buildSourceFile([buildImportDecl([spec], 2, 7)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('net/http');
      expect(imports[0]!.names).toEqual(['http']);
      expect((imports[0] as ImportInfo & { alias?: string }).alias).toBe('h');
    });

    it('extracts dot import as star', () => {
      const spec = buildImportSpec('strings', '.', 6);
      const root = buildSourceFile([buildImportDecl([spec], 2, 8)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('strings');
      expect(imports[0]!.names).toEqual(['*']);
    });

    it('extracts blank import', () => {
      const spec = buildImportSpec('database/sql', '_', 3);
      const root = buildSourceFile([buildImportDecl([spec], 2, 4)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('database/sql');
      expect(imports[0]!.names).toEqual(['_']);
    });

    it('extracts package name from multi-segment path', () => {
      const spec = buildImportSpec('github.com/pkg/errors', null, 3);
      const root = buildSourceFile([buildImportDecl([spec], 2, 4)]);
      const { imports } = visitGo(root, '');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.names).toEqual(['errors']);
    });
  });

  describe('golden fixture test', () => {
    it('extracts all expected symbols from the sample fixture', () => {
      // Handler interface with method specs
      const handlerMethods = [buildMethodSpec('Handle', 32), buildMethodSpec('Close', 33)];
      // validator interface with method spec
      const validatorMethods = [buildMethodSpec('Validate', 63)];

      const root = buildSourceFile([
        // import block (rows 2-7)
        buildImportDecl(
          [
            buildImportSpec('fmt', null, 3),
            buildImportSpec('os', null, 4),
            buildImportSpec('net/http', 'h', 5),
            buildImportSpec('strings', '.', 6),
          ],
          2,
          7,
        ),
        // func HandleRequest (rows 10-12)
        buildFuncDecl('HandleRequest', 10, 12),
        // func helperFunc (rows 15-17)
        buildFuncDecl('helperFunc', 15, 17),
        // type Server struct (rows 20-23)
        buildTypeDecl([buildTypeSpec('Server', 'struct_type', 20, 23)], 20, 23),
        // type config struct (rows 26-28)
        buildTypeDecl([buildTypeSpec('config', 'struct_type', 26, 28)], 26, 28),
        // type Handler interface with methods (rows 31-34)
        buildTypeDecl([buildTypeSpec('Handler', 'interface_type', 31, 34, handlerMethods)], 31, 34),
        // method Start (rows 37-39)
        buildMethodDecl('Start', 'Server', 37, 39),
        // method listen (rows 42-44)
        buildMethodDecl('listen', 'Server', 42, 44),
        // const MaxRetries (row 47)
        buildConstDecl([buildConstSpec('MaxRetries', 47)], 47, 47),
        // const defaultTimeout (row 50)
        buildConstDecl([buildConstSpec('defaultTimeout', 50)], 50, 50),
        // var Version (row 53)
        buildVarDecl([buildVarSpec('Version', 53)], 53, 53),
        // var logger (row 56)
        buildVarDecl([buildVarSpec('logger', 56)], 56, 56),
        // type RequestID string (row 59)
        buildTypeDecl([buildTypeSpec('RequestID', 'type_identifier', 59, 59)], 59, 59),
        // type validator interface with methods (rows 62-64)
        buildTypeDecl([buildTypeSpec('validator', 'interface_type', 62, 64, validatorMethods)], 62, 64),
        // func init (rows 67-69)
        buildFuncDecl('init', 67, 69),
      ]);

      const { symbols, imports } = visitGo(root, '');

      // 13 original + 2 Handler methods + 1 Validate method + 1 init = 17
      expect(symbols).toHaveLength(17);

      // Verify symbol names and export status
      const symbolMap = new Map(symbols.map((s) => [s.name, s]));

      // Exported functions
      expect(symbolMap.get('HandleRequest')).toMatchObject({
        kind: 'function',
        exported: true,
      });
      expect(symbolMap.get('Start')).toMatchObject({
        kind: 'function',
        exported: true,
      });

      // Unexported functions
      expect(symbolMap.get('helperFunc')).toMatchObject({
        kind: 'function',
        exported: false,
      });
      expect(symbolMap.get('listen')).toMatchObject({
        kind: 'function',
        exported: false,
      });

      // Struct types
      expect(symbolMap.get('Server')).toMatchObject({
        kind: 'class',
        exported: true,
      });
      expect(symbolMap.get('config')).toMatchObject({
        kind: 'class',
        exported: false,
      });

      // Interface types
      expect(symbolMap.get('Handler')).toMatchObject({
        kind: 'interface',
        exported: true,
      });
      expect(symbolMap.get('validator')).toMatchObject({
        kind: 'interface',
        exported: false,
      });

      // Interface methods
      const handleMethod = symbols.find(s => s.name === 'Handle' && s.kind === 'method');
      expect(handleMethod).toBeDefined();
      expect(handleMethod!.exported).toBe(true);
      expect(handleMethod!.metadata).toMatchObject({ parentInterface: 'Handler' });

      const closeMethod = symbols.find(s => s.name === 'Close' && s.kind === 'method');
      expect(closeMethod).toBeDefined();
      expect(closeMethod!.exported).toBe(true);
      expect(closeMethod!.metadata).toMatchObject({ parentInterface: 'Handler' });

      const validateMethod = symbols.find(s => s.name === 'Validate' && s.kind === 'method');
      expect(validateMethod).toBeDefined();
      expect(validateMethod!.exported).toBe(false);
      expect(validateMethod!.metadata).toMatchObject({ parentInterface: 'validator' });

      // Type alias
      expect(symbolMap.get('RequestID')).toMatchObject({
        kind: 'type',
        exported: true,
      });

      // Constants (mapped to variable)
      expect(symbolMap.get('MaxRetries')).toMatchObject({
        kind: 'variable',
        exported: true,
      });
      expect(symbolMap.get('defaultTimeout')).toMatchObject({
        kind: 'variable',
        exported: false,
      });

      // Variables
      expect(symbolMap.get('Version')).toMatchObject({
        kind: 'variable',
        exported: true,
      });
      expect(symbolMap.get('logger')).toMatchObject({
        kind: 'variable',
        exported: false,
      });

      // init function
      const initFunc = symbolMap.get('init');
      expect(initFunc).toMatchObject({
        kind: 'function',
        exported: false,
      });
      expect(initFunc!.metadata).toMatchObject({ isInit: true });

      // Verify imports
      expect(imports).toHaveLength(4);
      expect(imports[0]).toMatchObject({ specifier: 'fmt', names: ['fmt'] });
      expect(imports[1]).toMatchObject({ specifier: 'os', names: ['os'] });
      expect(imports[2]).toMatchObject({ specifier: 'net/http', names: ['http'] });
      expect((imports[2] as ImportInfo & { alias?: string }).alias).toBe('h');
      expect(imports[3]).toMatchObject({ specifier: 'strings', names: ['*'] });
    });
  });

  describe('edge cases', () => {
    it('returns empty results for empty source file', () => {
      const root = buildSourceFile([]);
      const { symbols, imports } = visitGo(root, '');
      expect(symbols).toEqual([]);
      expect(imports).toEqual([]);
    });

    it('ignores non-declaration nodes at top level', () => {
      const commentNode = mockNode('comment', { text: '// hello', startRow: 0 });
      const packageNode = mockNode('package_clause', { text: 'package main', startRow: 0 });
      const root = buildSourceFile([packageNode, commentNode, buildFuncDecl('Main', 2, 4)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('Main');
    });

    it('handles type_spec without a type node (rare AST shape)', () => {
      const nameNode = mockIdentifier('Alias', 0);
      const spec = mockNode('type_spec', {
        startRow: 0,
        endRow: 0,
        namedChildren: [nameNode],
        fields: { name: nameNode, type: null },
      });
      const root = buildSourceFile([buildTypeDecl([spec], 0, 0)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.kind).toBe('type');
    });

    it('handles const_spec without name field (fallback to namedChildren)', () => {
      const nameNode = mockIdentifier('FallbackName', 0);
      const spec = mockNode('const_spec', {
        startRow: 0,
        endRow: 0,
        namedChildren: [nameNode],
        fields: {},
      });
      const root = buildSourceFile([buildConstDecl([spec], 0, 0)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('FallbackName');
    });

    it('handles var_spec without name field (fallback to namedChildren)', () => {
      const nameNode = mockIdentifier('fallbackVar', 0);
      const spec = mockNode('var_spec', {
        startRow: 0,
        endRow: 0,
        namedChildren: [nameNode],
        fields: {},
      });
      const root = buildSourceFile([buildVarDecl([spec], 0, 0)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('fallbackVar');
    });
  });

  describe('receiver method detail', () => {
    it('captures pointer receiver type in metadata', () => {
      const root = buildSourceFile([buildMethodDecl('Start', 'Server', 10, 14, true)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('Start');
      expect(symbols[0]!.kind).toBe('function');
      expect(symbols[0]!.metadata).toBeDefined();
      expect(symbols[0]!.metadata!.receiver).toBe('*Server');
    });

    it('captures value receiver type in metadata', () => {
      const root = buildSourceFile([buildMethodDecl('String', 'Point', 20, 22, false)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('String');
      expect(symbols[0]!.metadata).toBeDefined();
      expect(symbols[0]!.metadata!.receiver).toBe('Point');
    });

    it('does not add receiver metadata for plain functions', () => {
      const root = buildSourceFile([buildFuncDecl('DoStuff', 0, 3)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata?.receiver).toBeUndefined();
    });
  });

  describe('interface method extraction', () => {
    it('extracts methods declared inside an interface', () => {
      const methods = [buildMethodSpec('ServeHTTP', 33), buildMethodSpec('Close', 34)];
      const spec = buildTypeSpec('Handler', 'interface_type', 32, 35, methods);
      const root = buildSourceFile([buildTypeDecl([spec], 32, 35)]);
      const { symbols } = visitGo(root, '');

      // Interface itself + 2 interface methods
      expect(symbols).toHaveLength(3);
      expect(symbols[0]!.name).toBe('Handler');
      expect(symbols[0]!.kind).toBe('interface');

      expect(symbols[1]!.name).toBe('ServeHTTP');
      expect(symbols[1]!.kind).toBe('method');
      expect(symbols[1]!.exported).toBe(true);
      expect(symbols[1]!.metadata).toMatchObject({ parentInterface: 'Handler' });

      expect(symbols[2]!.name).toBe('Close');
      expect(symbols[2]!.kind).toBe('method');
      expect(symbols[2]!.exported).toBe(true);
      expect(symbols[2]!.metadata).toMatchObject({ parentInterface: 'Handler' });
    });

    it('marks interface methods as unexported when interface is unexported', () => {
      const methods = [buildMethodSpec('validate', 64)];
      const spec = buildTypeSpec('validator', 'interface_type', 63, 65, methods);
      const root = buildSourceFile([buildTypeDecl([spec], 63, 65)]);
      const { symbols } = visitGo(root, '');

      expect(symbols).toHaveLength(2);
      expect(symbols[1]!.name).toBe('validate');
      expect(symbols[1]!.kind).toBe('method');
      expect(symbols[1]!.exported).toBe(false);
      expect(symbols[1]!.metadata).toMatchObject({ parentInterface: 'validator' });
    });

    it('does not extract methods from non-interface types', () => {
      const spec = buildTypeSpec('Server', 'struct_type', 21, 24);
      const root = buildSourceFile([buildTypeDecl([spec], 21, 24)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.kind).toBe('class');
    });

    it('handles empty interface with no methods', () => {
      const spec = buildTypeSpec('Any', 'interface_type', 10, 12, []);
      const root = buildSourceFile([buildTypeDecl([spec], 10, 12)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.kind).toBe('interface');
    });
  });

  describe('anonymous function detection', () => {
    it('counts anonymous functions in a function body', () => {
      const funcLiterals = [buildFuncLiteral(5, 7), buildFuncLiteral(8, 10)];
      const root = buildSourceFile([buildFuncDecl('Process', 3, 12, funcLiterals)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('Process');
      expect(symbols[0]!.metadata).toBeDefined();
      expect(symbols[0]!.metadata!.anonymousFunctions).toBe(2);
    });

    it('counts anonymous functions in a method body', () => {
      const funcLiterals = [buildFuncLiteral(12, 14)];
      const root = buildSourceFile([
        buildMethodDecl('Handle', 'Server', 10, 16, true, funcLiterals),
      ]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata).toBeDefined();
      expect(symbols[0]!.metadata!.anonymousFunctions).toBe(1);
    });

    it('counts nested anonymous functions', () => {
      // func_literal containing another func_literal
      const inner = buildFuncLiteral(7, 8);
      const outerBody = mockNode('block', { startRow: 6, endRow: 9, namedChildren: [inner] });
      const outer = mockNode('func_literal', {
        text: 'func() { func() {} }',
        startRow: 5,
        endRow: 9,
        namedChildren: [outerBody],
      });
      const root = buildSourceFile([buildFuncDecl('Outer', 3, 11, [outer])]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata!.anonymousFunctions).toBe(2);
    });

    it('does not add anonymousFunctions metadata when count is zero', () => {
      const root = buildSourceFile([buildFuncDecl('Simple', 0, 3)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata?.anonymousFunctions).toBeUndefined();
    });
  });

  describe('init function handling', () => {
    it('marks func init() with metadata.isInit', () => {
      const root = buildSourceFile([buildFuncDecl('init', 0, 5)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('init');
      expect(symbols[0]!.exported).toBe(false);
      expect(symbols[0]!.metadata).toBeDefined();
      expect(symbols[0]!.metadata!.isInit).toBe(true);
    });

    it('does not mark non-init functions with isInit', () => {
      const root = buildSourceFile([buildFuncDecl('initialize', 0, 5)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.metadata?.isInit).toBeUndefined();
    });

    it('does not mark init methods (only top-level init)', () => {
      const root = buildSourceFile([buildMethodDecl('init', 'Config', 0, 5)]);
      const { symbols } = visitGo(root, '');
      expect(symbols).toHaveLength(1);
      // Methods named init should have receiver but not isInit
      expect(symbols[0]!.metadata?.isInit).toBeUndefined();
      expect(symbols[0]!.metadata?.receiver).toBeDefined();
    });
  });
});
