/**
 * Tests for ReferenceResolver.
 *
 * Validates that:
 *   - tryPath resolves files with objectType 'file' (not 'node')
 *   - trySymbol resolves symbols with objectType 'symbol' (not 'node')
 *
 */
import { describe, it, expect } from 'vitest';
import { ReferenceResolver } from '../reference-resolver.js';
import type { ResolverReadHandle } from '../reference-resolver.js';

function mkHandle(overrides: Partial<ResolverReadHandle> = {}): ResolverReadHandle {
  return {
    getNode: () => null,
    getClaim: () => null,
    ftsSearch: () => [],
    ...overrides,
  };
}

describe('ReferenceResolver', () => {
  describe('tryPath', () => {
    it('resolves a file when FTS returns objectType "file" with matching path', () => {
      const handle = mkHandle({
        ftsSearch: () => [
          {
            objectId: 'node::file::repo::abc::src/index.ts',
            objectType: 'file',
            text: 'index.ts src/index.ts',
            path: 'src/index.ts',
            rank: 1,
          },
        ],
      });

      const resolver = new ReferenceResolver(handle);
      const result = resolver.resolve('src/index.ts', 'path');

      expect(result.status).toBe('resolved');
      if (result.status === 'resolved') {
        expect(result.id).toBe('node::file::repo::abc::src/index.ts');
        expect(result.kind).toBe('path');
      }
    });

    it('does NOT resolve when FTS returns objectType "node" (old bug)', () => {
      const handle = mkHandle({
        ftsSearch: () => [
          {
            objectId: 'node::file::repo::abc::src/index.ts',
            objectType: 'node',
            text: 'index.ts src/index.ts',
            path: 'src/index.ts',
            rank: 1,
          },
        ],
      });

      const resolver = new ReferenceResolver(handle);
      const result = resolver.resolve('src/index.ts', 'path');

      // Should NOT resolve because objectType 'node' is not matched
      expect(result.status).not.toBe('resolved');
    });
  });

  describe('trySymbol', () => {
    it('resolves a symbol when FTS returns objectType "symbol"', () => {
      const handle = mkHandle({
        ftsSearch: () => [
          {
            objectId: 'node::symbol::repo::abc::src/index.ts::greetUser',
            objectType: 'symbol',
            text: 'greetUser',
            path: 'src/index.ts',
            rank: 1,
          },
        ],
      });

      const resolver = new ReferenceResolver(handle);
      const result = resolver.resolve('greetUser', 'symbol');

      expect(result.status).toBe('resolved');
      if (result.status === 'resolved') {
        expect(result.id).toBe('node::symbol::repo::abc::src/index.ts::greetUser');
        expect(result.kind).toBe('symbol');
      }
    });

    it('does NOT resolve symbols when FTS returns objectType "node" (old bug)', () => {
      const handle = mkHandle({
        ftsSearch: () => [
          {
            objectId: 'node::symbol::repo::abc::src/index.ts::greetUser',
            objectType: 'node',
            text: 'greetUser',
            path: 'src/index.ts',
            rank: 1,
          },
        ],
      });

      const resolver = new ReferenceResolver(handle);
      const result = resolver.resolve('greetUser', 'symbol');

      // Should NOT resolve because objectType 'node' is not matched
      expect(result.status).not.toBe('resolved');
    });
  });
});
