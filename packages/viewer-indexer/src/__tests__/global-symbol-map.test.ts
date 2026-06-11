/**
 * Tests for GlobalSymbolMap.
 *
 * Validates in-memory cross-file symbol registration and lookup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalSymbolMap } from '../global-symbol-map.js';
import type { GlobalSymbolEntry } from '../global-symbol-map.js';

describe('GlobalSymbolMap', () => {
  let map: GlobalSymbolMap;

  beforeEach(() => {
    map = new GlobalSymbolMap();
  });

  describe('register', () => {
    it('registers a symbol entry', () => {
      const entry: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::src/index.ts::greet',
        filePath: 'src/index.ts',
        exported: true,
        language: 'typescript',
        kind: 'function',
      };

      map.register('greet', entry);
      expect(map.size).toBe(1);
    });

    it('allows multiple entries for the same symbol name', () => {
      const entry1: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::a.ts::Config',
        filePath: 'a.ts',
        exported: true,
        language: 'typescript',
        kind: 'class',
      };
      const entry2: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::b.py::Config',
        filePath: 'b.py',
        exported: true,
        language: 'python',
        kind: 'class',
      };

      map.register('Config', entry1);
      map.register('Config', entry2);
      expect(map.size).toBe(2);
    });
  });

  describe('lookup', () => {
    it('returns matching entries for a registered name', () => {
      const entry: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::lib.rs::process',
        filePath: 'lib.rs',
        exported: true,
        language: 'rust',
        kind: 'function',
      };

      map.register('process', entry);
      const results = map.lookup('process');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(entry);
    });

    it('returns all entries when multiple files define the same name', () => {
      const entry1: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::a.go::Handler',
        filePath: 'a.go',
        exported: true,
        language: 'go',
        kind: 'interface',
      };
      const entry2: GlobalSymbolEntry = {
        nodeId: 'node::symbol::repo::b.go::Handler',
        filePath: 'b.go',
        exported: true,
        language: 'go',
        kind: 'class',
      };

      map.register('Handler', entry1);
      map.register('Handler', entry2);

      const results = map.lookup('Handler');
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(entry1);
      expect(results).toContainEqual(entry2);
    });

    it('returns empty array for unregistered name', () => {
      const results = map.lookup('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      map.register('foo', {
        nodeId: 'n1',
        filePath: 'a.ts',
        exported: true,
        language: 'typescript',
        kind: 'function',
      });
      map.register('bar', {
        nodeId: 'n2',
        filePath: 'b.ts',
        exported: false,
        language: 'typescript',
        kind: 'variable',
      });

      expect(map.size).toBe(2);
      map.clear();
      expect(map.size).toBe(0);
      expect(map.lookup('foo')).toEqual([]);
      expect(map.lookup('bar')).toEqual([]);
    });
  });

  describe('size', () => {
    it('returns 0 for empty map', () => {
      expect(map.size).toBe(0);
    });

    it('reflects total entry count across all names', () => {
      map.register('a', {
        nodeId: 'n1',
        filePath: 'x.ts',
        exported: true,
        language: 'typescript',
        kind: 'function',
      });
      map.register('b', {
        nodeId: 'n2',
        filePath: 'y.ts',
        exported: false,
        language: 'typescript',
        kind: 'class',
      });
      map.register('a', {
        nodeId: 'n3',
        filePath: 'z.ts',
        exported: true,
        language: 'typescript',
        kind: 'function',
      });

      expect(map.size).toBe(3);
    });
  });

  describe('isolation', () => {
    it('lookup returns a copy, not a reference to internal state', () => {
      const entry: GlobalSymbolEntry = {
        nodeId: 'n1',
        filePath: 'a.ts',
        exported: true,
        language: 'typescript',
        kind: 'function',
      };
      map.register('sym', entry);

      const results = map.lookup('sym');
      results.length = 0; // mutate returned array

      // Internal state should be unaffected
      expect(map.lookup('sym')).toHaveLength(1);
    });
  });
});
