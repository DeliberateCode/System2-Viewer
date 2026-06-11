/**
 * Tests for the Rust AST visitor.
 *
 * Uses mock TreeSitterNode objects matching tree-sitter-rust AST shapes.
 * Golden fixture validation against expected.json for symbol/import extraction.
 *
 */
import { describe, it, expect } from 'vitest';
import { visitRust } from '../visitors/rust-visitor.js';
import type { TreeSitterNode } from '../grammar-registry.js';
import type { SymbolInfo, ImportInfo } from '../types.js';

// --- Mock node builder ---

function mockNode(
  type: string,
  text: string,
  opts: {
    startRow?: number;
    endRow?: number;
    children?: TreeSitterNode[];
    namedChildren?: TreeSitterNode[];
    fields?: Record<string, TreeSitterNode | null>;
  } = {},
): TreeSitterNode {
  const children = opts.children ?? opts.namedChildren ?? [];
  const namedChildren = opts.namedChildren ?? children;
  const fields = opts.fields ?? {};
  return {
    type,
    text,
    startPosition: { row: opts.startRow ?? 0, column: 0 },
    endPosition: { row: opts.endRow ?? opts.startRow ?? 0, column: 0 },
    children,
    namedChildren,
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

function identNode(name: string, row?: number): TreeSitterNode {
  return mockNode('identifier', name, { startRow: row });
}

function typeIdNode(name: string, row?: number): TreeSitterNode {
  return mockNode('type_identifier', name, { startRow: row });
}

function visModNode(text: string): TreeSitterNode {
  return mockNode('visibility_modifier', text);
}

// --- Symbol extraction tests ---

describe('visitRust', () => {
  describe('extractSymbols', () => {
    it('extracts pub fn as exported function', () => {
      const fnNode = mockNode('function_item', 'pub fn process_data(input: &str) -> String { input.to_uppercase() }', {
        startRow: 10,
        endRow: 12,
        namedChildren: [
          visModNode('pub'),
          identNode('process_data'),
        ],
        fields: { name: identNode('process_data') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'process_data', kind: 'function', exported: true }),
      );
    });

    it('extracts private fn as non-exported function', () => {
      const fnNode = mockNode('function_item', 'fn helper_function() -> bool { true }', {
        startRow: 14,
        endRow: 16,
        namedChildren: [identNode('helper_function')],
        fields: { name: identNode('helper_function') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'helper_function', kind: 'function', exported: false }),
      );
    });

    it('extracts pub struct as exported class', () => {
      const structNode = mockNode('struct_item', 'pub struct Config { name: String, value: i32 }', {
        startRow: 18,
        endRow: 21,
        namedChildren: [visModNode('pub'), typeIdNode('Config')],
        fields: { name: typeIdNode('Config') },
      });
      const root = mockNode('source_file', '', { namedChildren: [structNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'Config', kind: 'class', exported: true }),
      );
    });

    it('extracts pub(crate) struct as NOT exported', () => {
      const structNode = mockNode('struct_item', 'pub(crate) struct InternalState { counter: usize }', {
        startRow: 23,
        endRow: 25,
        namedChildren: [visModNode('pub(crate)'), typeIdNode('InternalState')],
        fields: { name: typeIdNode('InternalState') },
      });
      const root = mockNode('source_file', '', { namedChildren: [structNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'InternalState', kind: 'class', exported: false }),
      );
    });

    it('extracts pub(super) fn as NOT exported', () => {
      const fnNode = mockNode('function_item', 'pub(super) fn restricted_fn() -> u32 { 42 }', {
        startRow: 55,
        endRow: 57,
        namedChildren: [visModNode('pub(super)'), identNode('restricted_fn')],
        fields: { name: identNode('restricted_fn') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'restricted_fn', kind: 'function', exported: false }),
      );
    });

    it('extracts pub trait as exported interface', () => {
      const traitNode = mockNode('trait_item', 'pub trait Processor { fn process(&self) -> Result<(), String>; }', {
        startRow: 27,
        endRow: 29,
        namedChildren: [visModNode('pub'), typeIdNode('Processor')],
        fields: { name: typeIdNode('Processor') },
      });
      const root = mockNode('source_file', '', { namedChildren: [traitNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'Processor', kind: 'interface', exported: true }),
      );
    });

    it('extracts pub enum as exported class', () => {
      const enumNode = mockNode('enum_item', 'pub enum Status { Active, Inactive, Pending }', {
        startRow: 31,
        endRow: 35,
        namedChildren: [visModNode('pub'), typeIdNode('Status')],
        fields: { name: typeIdNode('Status') },
      });
      const root = mockNode('source_file', '', { namedChildren: [enumNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'Status', kind: 'class', exported: true }),
      );
    });

    it('extracts pub const as exported variable', () => {
      const constNode = mockNode('const_item', 'pub const MAX_RETRIES: u32 = 3;', {
        startRow: 37,
        endRow: 37,
        namedChildren: [visModNode('pub'), identNode('MAX_RETRIES')],
        fields: { name: identNode('MAX_RETRIES') },
      });
      const root = mockNode('source_file', '', { namedChildren: [constNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'MAX_RETRIES', kind: 'variable', exported: true }),
      );
    });

    it('extracts pub static as exported variable', () => {
      const staticNode = mockNode('static_item', 'pub static GLOBAL_NAME: &str = "system2";', {
        startRow: 39,
        endRow: 39,
        namedChildren: [visModNode('pub'), identNode('GLOBAL_NAME')],
        fields: { name: identNode('GLOBAL_NAME') },
      });
      const root = mockNode('source_file', '', { namedChildren: [staticNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'GLOBAL_NAME', kind: 'variable', exported: true }),
      );
    });

    it('extracts private static as non-exported variable', () => {
      const staticNode = mockNode('static_item', 'static INTERNAL_COUNTER: u32 = 0;', {
        startRow: 67,
        endRow: 67,
        namedChildren: [identNode('INTERNAL_COUNTER')],
        fields: { name: identNode('INTERNAL_COUNTER') },
      });
      const root = mockNode('source_file', '', { namedChildren: [staticNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'INTERNAL_COUNTER', kind: 'variable', exported: false }),
      );
    });

    it('extracts pub type alias as exported type', () => {
      const typeNode = mockNode('type_item', 'pub type ResultAlias = Result<String, Box<dyn std::error::Error>>;', {
        startRow: 41,
        endRow: 41,
        namedChildren: [visModNode('pub'), typeIdNode('ResultAlias')],
        fields: { name: typeIdNode('ResultAlias') },
      });
      const root = mockNode('source_file', '', { namedChildren: [typeNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'ResultAlias', kind: 'type', exported: true }),
      );
    });

    it('extracts impl block as non-exported class with type name', () => {
      const implNode = mockNode('impl_item', 'impl Config { pub fn new(name: String, value: i32) -> Self { Config { name, value } } }', {
        startRow: 43,
        endRow: 47,
        namedChildren: [typeIdNode('Config')],
        fields: { type: typeIdNode('Config') },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'Config', kind: 'class', exported: false }),
      );
    });

    it('extracts impl trait for type with type name', () => {
      const implNode = mockNode('impl_item', 'impl Processor for Config { fn process(&self) -> Result<(), String> { Ok(()) } }', {
        startRow: 49,
        endRow: 53,
        namedChildren: [typeIdNode('Processor'), typeIdNode('Config')],
        fields: { type: typeIdNode('Config'), trait: typeIdNode('Processor') },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'Config', kind: 'class', exported: false }),
      );
    });

    it('extracts async fn with generics as exported function', () => {
      const fnNode = mockNode('function_item', 'pub async fn async_process<T: Clone>(item: T) -> T { item.clone() }', {
        startRow: 59,
        endRow: 61,
        namedChildren: [visModNode('pub'), identNode('async_process')],
        fields: { name: identNode('async_process') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'async_process', kind: 'function', exported: true }),
      );
    });

    it('extracts fn with lifetime parameters', () => {
      const fnNode = mockNode('function_item', "pub fn generic_with_lifetime<'a>(s: &'a str) -> &'a str { s }", {
        startRow: 63,
        endRow: 65,
        namedChildren: [visModNode('pub'), identNode('generic_with_lifetime')],
        fields: { name: identNode('generic_with_lifetime') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'generic_with_lifetime', kind: 'function', exported: true }),
      );
    });

    it('extracts private const as non-exported variable', () => {
      const constNode = mockNode('const_item', 'const LOCAL_LIMIT: usize = 100;', {
        startRow: 69,
        endRow: 69,
        namedChildren: [identNode('LOCAL_LIMIT')],
        fields: { name: identNode('LOCAL_LIMIT') },
      });
      const root = mockNode('source_file', '', { namedChildren: [constNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: 'LOCAL_LIMIT', kind: 'variable', exported: false }),
      );
    });
  });

  describe('extractImports', () => {
    it('extracts simple use declaration', () => {
      // use std::io::Read;
      const scopedId = mockNode('scoped_identifier', 'std::io::Read', {
        namedChildren: [
          mockNode('scoped_identifier', 'std::io', {
            namedChildren: [identNode('std'), identNode('io')],
          }),
          identNode('Read'),
        ],
      });
      const useNode = mockNode('use_declaration', 'use std::io::Read;', {
        startRow: 2,
        namedChildren: [scopedId],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toContainEqual(
        expect.objectContaining({
          specifier: 'std::io::Read',
          names: ['Read'],
          isTypeOnly: false,
        }),
      );
    });

    it('extracts use declaration with group', () => {
      // use std::collections::{HashMap, HashSet};
      const useList = mockNode('use_list', '{HashMap, HashSet}', {
        namedChildren: [identNode('HashMap'), identNode('HashSet')],
      });
      const scopedUseList = mockNode('scoped_use_list', 'std::collections::{HashMap, HashSet}', {
        namedChildren: [
          mockNode('scoped_identifier', 'std::collections', {
            namedChildren: [identNode('std'), identNode('collections')],
          }),
          useList,
        ],
      });
      const useNode = mockNode('use_declaration', 'use std::collections::{HashMap, HashSet};', {
        startRow: 3,
        namedChildren: [scopedUseList],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toContainEqual(
        expect.objectContaining({
          specifier: 'std::collections::{HashMap, HashSet}',
          names: ['HashMap', 'HashSet'],
          isTypeOnly: false,
        }),
      );
    });

    it('extracts wildcard use declaration', () => {
      // use std::fmt::*;
      const wildcard = mockNode('use_wildcard', 'std::fmt::*', {
        namedChildren: [
          mockNode('scoped_identifier', 'std::fmt', {
            namedChildren: [identNode('std'), identNode('fmt')],
          }),
        ],
      });
      const useNode = mockNode('use_declaration', 'use std::fmt::*;', {
        startRow: 4,
        namedChildren: [wildcard],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toContainEqual(
        expect.objectContaining({
          specifier: 'std::fmt::*',
          names: ['*'],
          isTypeOnly: false,
        }),
      );
    });

    it('extracts extern crate as import', () => {
      const externNode = mockNode('extern_crate_declaration', 'extern crate serde;', {
        startRow: 6,
        namedChildren: [identNode('serde')],
        fields: { name: identNode('serde') },
      });
      const root = mockNode('source_file', '', { namedChildren: [externNode] });
      const result = visitRust(root, '');
      expect(result.imports).toContainEqual(
        expect.objectContaining({
          specifier: 'serde',
          names: [],
          isTypeOnly: false,
        }),
      );
    });

    it('extracts mod declaration as import', () => {
      const modNode = mockNode('mod_item', 'mod utils;', {
        startRow: 8,
        namedChildren: [identNode('utils')],
        fields: { name: identNode('utils') },
      });
      const root = mockNode('source_file', '', { namedChildren: [modNode] });
      const result = visitRust(root, '');
      expect(result.imports).toContainEqual(
        expect.objectContaining({
          specifier: './utils',
          names: [],
          isTypeOnly: false,
        }),
      );
    });

    it('does not treat mod with body as import', () => {
      // mod inline { ... } should NOT produce an import
      const bodyNode = mockNode('declaration_list', '{ fn x() {} }', {});
      const modNode = mockNode('mod_item', 'mod inline { fn x() {} }', {
        startRow: 10,
        namedChildren: [identNode('inline'), bodyNode],
        fields: { name: identNode('inline'), body: bodyNode },
      });
      const root = mockNode('source_file', '', { namedChildren: [modNode] });
      const result = visitRust(root, '');
      expect(result.imports).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty results for empty source file', () => {
      const root = mockNode('source_file', '', { namedChildren: [] });
      const result = visitRust(root, '');
      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it('handles multiple items in one file', () => {
      const fn1 = mockNode('function_item', 'pub fn a() {}', {
        startRow: 0, endRow: 0,
        namedChildren: [visModNode('pub'), identNode('a')],
        fields: { name: identNode('a') },
      });
      const fn2 = mockNode('function_item', 'fn b() {}', {
        startRow: 1, endRow: 1,
        namedChildren: [identNode('b')],
        fields: { name: identNode('b') },
      });
      const struct1 = mockNode('struct_item', 'pub struct C {}', {
        startRow: 2, endRow: 2,
        namedChildren: [visModNode('pub'), typeIdNode('C')],
        fields: { name: typeIdNode('C') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fn1, fn2, struct1] });
      const result = visitRust(root, '');
      expect(result.symbols).toHaveLength(3);
      expect(result.symbols[0]).toMatchObject({ name: 'a', kind: 'function', exported: true });
      expect(result.symbols[1]).toMatchObject({ name: 'b', kind: 'function', exported: false });
      expect(result.symbols[2]).toMatchObject({ name: 'C', kind: 'class', exported: true });
    });

    it('handles pub(in path) as not exported', () => {
      const fnNode = mockNode('function_item', 'pub(in crate::module) fn restricted() {}', {
        startRow: 0, endRow: 0,
        namedChildren: [visModNode('pub(in crate::module)'), identNode('restricted')],
        fields: { name: identNode('restricted') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      expect(result.symbols[0]).toMatchObject({ name: 'restricted', exported: false });
    });

    it('handles use_as_clause in use declaration', () => {
      // use std::io::Read as IoRead;
      const asClause = mockNode('use_as_clause', 'std::io::Read as IoRead', {
        namedChildren: [
          mockNode('scoped_identifier', 'std::io::Read', {
            namedChildren: [
              mockNode('scoped_identifier', 'std::io', {
                namedChildren: [identNode('std'), identNode('io')],
              }),
              identNode('Read'),
            ],
          }),
          identNode('IoRead'),
        ],
        fields: {
          alias: identNode('IoRead'),
        },
      });
      const useNode = mockNode('use_declaration', 'use std::io::Read as IoRead;', {
        startRow: 0,
        namedChildren: [asClause],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]!.names).toContain('IoRead');
    });

    it('extracts only alias from use_as_clause when alias field is null (fallback)', () => {
      // use foo::Bar as Baz; — tree-sitter may not set the alias field
      const asClause = mockNode('use_as_clause', 'foo::Bar as Baz', {
        namedChildren: [
          mockNode('scoped_identifier', 'foo::Bar', {
            namedChildren: [identNode('foo'), identNode('Bar')],
          }),
          identNode('Baz'),
        ],
        fields: {
          alias: null,
          name: null,
        },
      });
      const useNode = mockNode('use_declaration', 'use foo::Bar as Baz;', {
        startRow: 0,
        namedChildren: [asClause],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toHaveLength(1);
      // Must extract ONLY 'Baz' (the alias), NOT ['Bar', 'Baz']
      expect(result.imports[0]!.names).toEqual(['Baz']);
    });

    it('extracts only alias from use_as_clause in use list when alias field is null', () => {
      // use foo::{Bar as Baz, Qux}; — alias field null inside a use list
      const asClause = mockNode('use_as_clause', 'Bar as Baz', {
        namedChildren: [identNode('Bar'), identNode('Baz')],
        fields: { alias: null, name: null },
      });
      const useList = mockNode('use_list', '{Bar as Baz, Qux}', {
        namedChildren: [asClause, identNode('Qux')],
      });
      const scopedUseList = mockNode('scoped_use_list', 'foo::{Bar as Baz, Qux}', {
        namedChildren: [
          mockNode('scoped_identifier', 'foo', {
            namedChildren: [identNode('foo')],
          }),
          useList,
        ],
      });
      const useNode = mockNode('use_declaration', 'use foo::{Bar as Baz, Qux};', {
        startRow: 0,
        namedChildren: [scopedUseList],
      });
      const root = mockNode('source_file', '', { namedChildren: [useNode] });
      const result = visitRust(root, '');
      expect(result.imports).toHaveLength(1);
      // Must extract ['Baz', 'Qux'] — only the alias, not 'Bar'
      expect(result.imports[0]!.names).toEqual(['Baz', 'Qux']);
    });

    it('skips node types it does not handle', () => {
      const commentNode = mockNode('line_comment', '// a comment', { startRow: 0 });
      const attrNode = mockNode('attribute_item', '#[derive(Debug)]', { startRow: 1 });
      const root = mockNode('source_file', '', { namedChildren: [commentNode, attrNode] });
      const result = visitRust(root, '');
      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });
  });

  describe('impl method extraction', () => {
    it('extracts pub method from impl block as exported method with parent scope', () => {
      const methodNode = mockNode('function_item', 'pub fn new(name: String) -> Self { Config { name } }', {
        startRow: 44,
        endRow: 46,
        namedChildren: [visModNode('pub'), identNode('new')],
        fields: { name: identNode('new') },
      });
      const declList = mockNode('declaration_list', '{ pub fn new(name: String) -> Self { Config { name } } }', {
        namedChildren: [methodNode],
      });
      const implNode = mockNode('impl_item', 'impl Config { pub fn new(name: String) -> Self { Config { name } } }', {
        startRow: 43,
        endRow: 47,
        namedChildren: [typeIdNode('Config'), declList],
        fields: { type: typeIdNode('Config'), body: declList },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      const methods = result.symbols.filter(s => s.kind === 'method');
      expect(methods).toHaveLength(1);
      expect(methods[0]).toMatchObject({
        name: 'new',
        kind: 'method',
        exported: true,
        startLine: 45,
        endLine: 47,
      });
      expect(methods[0]!.metadata).toMatchObject({ parentImpl: 'Config' });
    });

    it('extracts private method from impl block as non-exported method', () => {
      const methodNode = mockNode('function_item', 'fn helper(&self) -> bool { true }', {
        startRow: 50,
        endRow: 52,
        namedChildren: [identNode('helper')],
        fields: { name: identNode('helper') },
      });
      const declList = mockNode('declaration_list', '{ fn helper(&self) -> bool { true } }', {
        namedChildren: [methodNode],
      });
      const implNode = mockNode('impl_item', 'impl Config { fn helper(&self) -> bool { true } }', {
        startRow: 49,
        endRow: 53,
        namedChildren: [typeIdNode('Config'), declList],
        fields: { type: typeIdNode('Config'), body: declList },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      const methods = result.symbols.filter(s => s.kind === 'method');
      expect(methods).toHaveLength(1);
      expect(methods[0]).toMatchObject({
        name: 'helper',
        kind: 'method',
        exported: false,
      });
      expect(methods[0]!.metadata).toMatchObject({ parentImpl: 'Config' });
    });

    it('extracts multiple methods from single impl block', () => {
      const method1 = mockNode('function_item', 'pub fn get(&self) -> &str { &self.name }', {
        startRow: 10,
        endRow: 12,
        namedChildren: [visModNode('pub'), identNode('get')],
        fields: { name: identNode('get') },
      });
      const method2 = mockNode('function_item', 'fn set(&mut self, val: String) { self.name = val; }', {
        startRow: 13,
        endRow: 15,
        namedChildren: [identNode('set')],
        fields: { name: identNode('set') },
      });
      const declList = mockNode('declaration_list', '{ ... }', {
        namedChildren: [method1, method2],
      });
      const implNode = mockNode('impl_item', 'impl Foo { ... }', {
        startRow: 9,
        endRow: 16,
        namedChildren: [typeIdNode('Foo'), declList],
        fields: { type: typeIdNode('Foo'), body: declList },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      const methods = result.symbols.filter(s => s.kind === 'method');
      expect(methods).toHaveLength(2);
      expect(methods[0]).toMatchObject({ name: 'get', exported: true });
      expect(methods[1]).toMatchObject({ name: 'set', exported: false });
    });

    it('still emits impl block as class symbol alongside methods', () => {
      const methodNode = mockNode('function_item', 'pub fn run(&self) {}', {
        startRow: 5,
        endRow: 7,
        namedChildren: [visModNode('pub'), identNode('run')],
        fields: { name: identNode('run') },
      });
      const declList = mockNode('declaration_list', '{ pub fn run(&self) {} }', {
        namedChildren: [methodNode],
      });
      const implNode = mockNode('impl_item', 'impl MyStruct { pub fn run(&self) {} }', {
        startRow: 4,
        endRow: 8,
        namedChildren: [typeIdNode('MyStruct'), declList],
        fields: { type: typeIdNode('MyStruct'), body: declList },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      const classSyms = result.symbols.filter(s => s.kind === 'class');
      const methodSyms = result.symbols.filter(s => s.kind === 'method');
      expect(classSyms).toHaveLength(1);
      expect(classSyms[0]).toMatchObject({ name: 'MyStruct', kind: 'class' });
      expect(methodSyms).toHaveLength(1);
      expect(methodSyms[0]).toMatchObject({ name: 'run', kind: 'method' });
    });
  });

  describe('closure detection', () => {
    it('counts closure expressions in a top-level function', () => {
      const closureNode = mockNode('closure_expression', '|x| x + 1', { startRow: 3 });
      const fnBody = mockNode('block', '{ let f = |x| x + 1; }', {
        namedChildren: [
          mockNode('let_declaration', 'let f = |x| x + 1;', {
            namedChildren: [closureNode],
          }),
        ],
      });
      const fnNode = mockNode('function_item', 'pub fn process() { let f = |x| x + 1; }', {
        startRow: 2,
        endRow: 5,
        namedChildren: [visModNode('pub'), identNode('process'), fnBody],
        fields: { name: identNode('process'), body: fnBody },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      const fn = result.symbols.find(s => s.name === 'process');
      expect(fn).toBeDefined();
      expect(fn!.metadata).toBeDefined();
      expect(fn!.metadata!.closureCount).toBe(1);
    });

    it('counts multiple closures in a function', () => {
      const closure1 = mockNode('closure_expression', '|x| x + 1', { startRow: 3 });
      const closure2 = mockNode('closure_expression', '|y| y * 2', { startRow: 4 });
      const fnBody = mockNode('block', '{ ... }', {
        namedChildren: [
          mockNode('let_declaration', 'let f = |x| x + 1;', {
            namedChildren: [closure1],
          }),
          mockNode('let_declaration', 'let g = |y| y * 2;', {
            namedChildren: [closure2],
          }),
        ],
      });
      const fnNode = mockNode('function_item', 'fn multi_closure() { ... }', {
        startRow: 2,
        endRow: 6,
        namedChildren: [identNode('multi_closure'), fnBody],
        fields: { name: identNode('multi_closure'), body: fnBody },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      const fn = result.symbols.find(s => s.name === 'multi_closure');
      expect(fn).toBeDefined();
      expect(fn!.metadata!.closureCount).toBe(2);
    });

    it('does not add closureCount metadata when there are no closures', () => {
      const fnBody = mockNode('block', '{ 42 }', { namedChildren: [] });
      const fnNode = mockNode('function_item', 'fn simple() -> i32 { 42 }', {
        startRow: 0,
        endRow: 0,
        namedChildren: [identNode('simple'), fnBody],
        fields: { name: identNode('simple'), body: fnBody },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      const fn = result.symbols.find(s => s.name === 'simple');
      expect(fn).toBeDefined();
      // No metadata or no closureCount key
      expect(fn!.metadata?.closureCount).toBeUndefined();
    });
  });

  describe('attribute extraction', () => {
    it('captures derive attributes on a struct', () => {
      const attrNode = mockNode('attribute_item', '#[derive(Debug, Clone)]', { startRow: 0 });
      const structNode = mockNode('struct_item', 'pub struct Config { name: String }', {
        startRow: 1,
        endRow: 3,
        namedChildren: [visModNode('pub'), typeIdNode('Config')],
        fields: { name: typeIdNode('Config') },
      });
      const root = mockNode('source_file', '', { namedChildren: [attrNode, structNode] });
      const result = visitRust(root, '');
      const sym = result.symbols.find(s => s.name === 'Config');
      expect(sym).toBeDefined();
      expect(sym!.metadata).toBeDefined();
      expect(sym!.metadata!.attributes).toEqual(['derive(Debug, Clone)']);
    });

    it('captures multiple attributes on a function', () => {
      const attr1 = mockNode('attribute_item', '#[test]', { startRow: 0 });
      const attr2 = mockNode('attribute_item', '#[cfg(test)]', { startRow: 1 });
      const fnNode = mockNode('function_item', 'fn my_test() { assert!(true); }', {
        startRow: 2,
        endRow: 4,
        namedChildren: [identNode('my_test')],
        fields: { name: identNode('my_test') },
      });
      const root = mockNode('source_file', '', { namedChildren: [attr1, attr2, fnNode] });
      const result = visitRust(root, '');
      const sym = result.symbols.find(s => s.name === 'my_test');
      expect(sym).toBeDefined();
      expect(sym!.metadata!.attributes).toEqual(['test', 'cfg(test)']);
    });

    it('does not add attributes metadata when none present', () => {
      const fnNode = mockNode('function_item', 'fn plain() {}', {
        startRow: 0,
        endRow: 0,
        namedChildren: [identNode('plain')],
        fields: { name: identNode('plain') },
      });
      const root = mockNode('source_file', '', { namedChildren: [fnNode] });
      const result = visitRust(root, '');
      const sym = result.symbols.find(s => s.name === 'plain');
      expect(sym).toBeDefined();
      expect(sym!.metadata?.attributes).toBeUndefined();
    });

    it('attributes only apply to the immediately following item', () => {
      const attrNode = mockNode('attribute_item', '#[inline]', { startRow: 0 });
      const fn1 = mockNode('function_item', 'fn first() {}', {
        startRow: 1,
        endRow: 1,
        namedChildren: [identNode('first')],
        fields: { name: identNode('first') },
      });
      const fn2 = mockNode('function_item', 'fn second() {}', {
        startRow: 2,
        endRow: 2,
        namedChildren: [identNode('second')],
        fields: { name: identNode('second') },
      });
      const root = mockNode('source_file', '', { namedChildren: [attrNode, fn1, fn2] });
      const result = visitRust(root, '');
      const first = result.symbols.find(s => s.name === 'first');
      const second = result.symbols.find(s => s.name === 'second');
      expect(first!.metadata!.attributes).toEqual(['inline']);
      expect(second!.metadata?.attributes).toBeUndefined();
    });

    it('captures attributes on impl methods', () => {
      const attrNode = mockNode('attribute_item', '#[inline(always)]', { startRow: 10 });
      const methodNode = mockNode('function_item', 'pub fn fast(&self) -> i32 { 0 }', {
        startRow: 11,
        endRow: 13,
        namedChildren: [visModNode('pub'), identNode('fast')],
        fields: { name: identNode('fast') },
      });
      const declList = mockNode('declaration_list', '{ ... }', {
        namedChildren: [attrNode, methodNode],
      });
      const implNode = mockNode('impl_item', 'impl Foo { ... }', {
        startRow: 9,
        endRow: 14,
        namedChildren: [typeIdNode('Foo'), declList],
        fields: { type: typeIdNode('Foo'), body: declList },
      });
      const root = mockNode('source_file', '', { namedChildren: [implNode] });
      const result = visitRust(root, '');
      const method = result.symbols.find(s => s.kind === 'method');
      expect(method).toBeDefined();
      expect(method!.metadata!.attributes).toEqual(['inline(always)']);
    });
  });
});
