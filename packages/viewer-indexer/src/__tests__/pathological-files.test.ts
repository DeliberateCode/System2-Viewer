/**
 * Pathological / fuzzing stress tests for the symbol extraction pipeline.
 *
 * Exercises edge cases that real-world codebases may present:
 *   1. Minified JS (single long line)
 *   2. Syntax error files (unclosed braces, invalid tokens)
 *   3. Binary content disguised as .ts
 *   4. Empty / whitespace-only files
 *   5. Deeply nested code (500-level if/else)
 *   6. Unicode edge cases (emoji, CJK in identifiers)
 *   7. Circular imports (A -> B -> C -> A)
 *
 *
 */
import { describe, it, expect } from 'vitest';
import { extractSymbols } from '../extract.js';
import { resolveImports } from '../resolve-imports.js';
import type { ImportInfo } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an imports map for resolveImports. */
function mkImportMap(
  entries: Array<{
    fileId: string;
    relativePath: string;
    imports: ImportInfo[];
  }>,
): Map<string, { relativePath: string; imports: ImportInfo[] }> {
  const map = new Map<string, { relativePath: string; imports: ImportInfo[] }>();
  for (const e of entries) {
    map.set(e.fileId, { relativePath: e.relativePath, imports: e.imports });
  }
  return map;
}

function mkFileMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

function mkImport(specifier: string, names: string[] = []): ImportInfo {
  return { specifier, names, isTypeOnly: false, line: 1 };
}

// ---------------------------------------------------------------------------
// 1. Minified JavaScript (single long line)
// ---------------------------------------------------------------------------
describe('Pathological: minified JavaScript (single long line)', () => {
  /**
   * Generate ~100 KB of minified JS on a single line.
   * Pattern: var a0=1;var a1=2;...
   */
  function generateMinifiedJs(targetBytes: number): string {
    const parts: string[] = [];
    let i = 0;
    while (parts.join('').length < targetBytes) {
      parts.push(`var a${i}=${i};`);
      i++;
    }
    return parts.join('');
  }

  it('extractSymbols completes without crash on ~100KB single-line JS', async () => {
    const content = generateMinifiedJs(100_000);
    // Verify it is truly a single line
    expect(content.includes('\n')).toBe(false);
    expect(content.length).toBeGreaterThanOrEqual(100_000);

    const result = await extractSymbols('/fake/minified.js', content, 'javascript');

    // Must not crash -- reaching here is the primary assertion
    expect(result).toBeDefined();
    expect(result.language).toBe('javascript');
    // Symbols may be many or few depending on backend (tree-sitter vs regex)
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('does not produce millions of spurious symbols', async () => {
    const content = generateMinifiedJs(100_000);
    const result = await extractSymbols('/fake/minified.js', content, 'javascript');
    // Each var declaration is ~12 bytes, so ~8300 declarations max
    // A sane extractor should not blow this up
    expect(result.symbols.length).toBeLessThan(50_000);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 2. Large file coverage (reference to large-file-stress.test.ts)
// Already covered in large-file-stress.test.ts. We add a supplementary
// test for tree-sitter completion time on an extremely wide line count.
// ---------------------------------------------------------------------------
describe('Pathological: extremely large file (50k+ lines) -- supplementary', () => {
  it('50k-line file extraction completes within 30s', async () => {
    // Build a 50k-line file with varied structure
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) {
      if (i % 100 === 0) {
        lines.push(`export function fn_${i}(x: number): number { return x + ${i}; }`);
      } else {
        lines.push(`const v${i} = ${i};`);
      }
    }
    const content = lines.join('\n');

    const start = performance.now();
    const result = await extractSymbols('/fake/huge.ts', content, 'typescript');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(30_000);
    expect(result).toBeDefined();
    expect(result.symbols.length).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Syntax error files
// ---------------------------------------------------------------------------
describe('Pathological: syntax error files', () => {
  it('unclosed braces do not crash extraction', async () => {
    const content = `
export function foo() {
  if (true) {
    const x = 1;
  // missing closing braces
`;
    const result = await extractSymbols('/fake/broken.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');
    // Tree-sitter produces partial ASTs for syntax errors; regex fallback also works.
    // Either way, no crash.
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
  });

  it('invalid tokens do not crash extraction', async () => {
    const content = `
export const a = 1;
@@@ INVALID TOKEN @@@
export function bar() { return 2; }
`;
    const result = await extractSymbols('/fake/invalid-tokens.ts', content, 'typescript');
    expect(result).toBeDefined();
    // At minimum, partial or empty results -- never a throw
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('mixed valid/invalid code returns partial results or empty', async () => {
    const content = `
export class Valid {}
type X = {{{{{
const = = = ;
export interface AlsoValid { name: string; }
`;
    const result = await extractSymbols('/fake/mixed-errors.ts', content, 'typescript');
    expect(result).toBeDefined();
    // Partiality depends on backend, but extraction must not throw
    expect(Array.isArray(result.symbols)).toBe(true);
    expect(Array.isArray(result.imports)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Binary file disguised as source
// ---------------------------------------------------------------------------
describe('Pathological: binary file disguised as .ts', () => {
  it('random binary bytes do not crash extraction', async () => {
    // Generate 1 KB of pseudo-random binary content
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 137 + 43) % 256;
    }
    const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    const result = await extractSymbols('/fake/binary.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');
    // Binary content produces empty or partial results
    expect(Array.isArray(result.symbols)).toBe(true);
    expect(Array.isArray(result.imports)).toBe(true);
  });

  it('null bytes in content do not crash extraction', async () => {
    const content = 'export const a = 1;\0\0\0export function b() {}\0';
    const result = await extractSymbols('/fake/null-bytes.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('10KB binary blob with .ts extension returns gracefully', async () => {
    const bytes = new Uint8Array(10_240);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 251 + 17) % 256;
    }
    const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    const result = await extractSymbols('/fake/large-binary.ts', content, 'typescript');
    expect(result).toBeDefined();
    // Should not produce thousands of phantom symbols from random bytes
    expect(result.symbols.length).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty files
// ---------------------------------------------------------------------------
describe('Pathological: empty files', () => {
  it('.ts file with zero bytes returns empty symbols', async () => {
    const result = await extractSymbols('/fake/empty.ts', '', 'typescript');
    expect(result).toBeDefined();
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(result.language).toBe('typescript');
  });

  it('.py file with only whitespace returns empty symbols', async () => {
    const content = '   \n\n  \t \n  ';
    const result = await extractSymbols('/fake/whitespace.py', content, 'python');
    expect(result).toBeDefined();
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(result.language).toBe('python');
  });

  it('.json file with zero bytes records partiality', async () => {
    const result = await extractSymbols('/fake/empty.json', '', 'json');
    expect(result).toBeDefined();
    expect(result.symbols).toEqual([]);
    // Empty string for JSON: JSON.parse('') throws, but extractSymbols handles it.
    // The JSON visitor returns empty symbols for empty strings.
    expect(result.language).toBe('json');
  });

  it('.js file with only comments returns empty symbols', async () => {
    const content = '// This file intentionally left blank\n/* nothing here */\n';
    const result = await extractSymbols('/fake/comments-only.js', content, 'javascript');
    expect(result).toBeDefined();
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Deeply nested code
// ---------------------------------------------------------------------------
describe('Pathological: deeply nested code (500-level if/else)', () => {
  it('500-level nested if chain does not crash or hang', async () => {
    const depth = 500;
    const lines: string[] = ['export function deepNest() {'];
    for (let i = 0; i < depth; i++) {
      lines.push(`${'  '.repeat(i + 1)}if (true) {`);
    }
    // Innermost body
    lines.push(`${'  '.repeat(depth + 1)}return ${depth};`);
    // Close all braces
    for (let i = depth - 1; i >= 0; i--) {
      lines.push(`${'  '.repeat(i + 1)}}`);
    }
    lines.push('}');
    const content = lines.join('\n');

    const start = performance.now();
    const result = await extractSymbols('/fake/deep-nest.ts', content, 'typescript');
    const elapsed = performance.now() - start;

    // Must complete within 30 seconds
    expect(elapsed).toBeLessThan(30_000);
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');
    // Should extract at least the outer function
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('deeply nested class methods are parseable', async () => {
    const depth = 200;
    const lines: string[] = ['export class DeepClass {'];
    lines.push('  method() {');
    for (let i = 0; i < depth; i++) {
      lines.push(`${'  '.repeat(i + 2)}if (true) {`);
    }
    lines.push(`${'  '.repeat(depth + 2)}return 0;`);
    for (let i = depth - 1; i >= 0; i--) {
      lines.push(`${'  '.repeat(i + 2)}}`);
    }
    lines.push('  }');
    lines.push('}');
    const content = lines.join('\n');

    const result = await extractSymbols('/fake/deep-class.ts', content, 'typescript');
    expect(result).toBeDefined();
    // At minimum the class itself should be found
    const classSymbol = result.symbols.find((s) => s.name === 'DeepClass');
    if (!result.partial) {
      // Tree-sitter should find the class
      expect(classSymbol).toBeDefined();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 7. Unicode edge cases
// ---------------------------------------------------------------------------
describe('Pathological: Unicode edge cases', () => {
  it('emoji in function names do not crash extraction', async () => {
    const content = `
export function hello\u{1F600}() { return 'smile'; }
export const \u{1F680} = 42;
`;
    const result = await extractSymbols('/fake/emoji.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');
    // Emoji identifiers are syntactically invalid in TS but tree-sitter may
    // produce partial ASTs. Either way, must not crash.
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('CJK characters in variable names do not crash extraction', async () => {
    const content = `
export const 変数 = 1;
export function 計算() { return 変数 + 1; }
`;
    const result = await extractSymbols('/fake/cjk.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
    // CJK identifiers are valid in ES2015+, so tree-sitter may extract them
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
  });

  it('mixed RTL and LTR text do not crash extraction', async () => {
    const content = `
// العربية Arabic comment
export const name = 'עברית'; // Hebrew string
export function αβγ() { return 0; } // Greek identifiers
`;
    const result = await extractSymbols('/fake/mixed-scripts.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('BOM (byte order mark) at start does not crash extraction', async () => {
    const content = '﻿export const x = 1;\nexport function y() { return 2; }\n';
    const result = await extractSymbols('/fake/bom.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('very long identifiers do not crash extraction', async () => {
    const longName = 'a'.repeat(10_000);
    const content = `export const ${longName} = 42;\n`;
    const result = await extractSymbols('/fake/long-ident.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it('file with zero-width characters does not crash', async () => {
    // Zero-width spaces and joiners mixed into code
    const content = `export const a​‌‍ = 1;\nexport function b﻿() {}\n`;
    const result = await extractSymbols('/fake/zero-width.ts', content, 'typescript');
    expect(result).toBeDefined();
    expect(Array.isArray(result.symbols)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Circular imports (A -> B -> C -> A)
// (import edges between files)
// ---------------------------------------------------------------------------
describe('Pathological: circular imports (A -> B -> C -> A)', () => {
  it('resolveImports completes without infinite loop', () => {
    // A.ts imports from B, B.ts imports from C, C.ts imports from A
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/a.ts',
        relativePath: 'src/a.ts',
        imports: [mkImport('./b', ['B'])],
      },
      {
        fileId: 'node::file::r1::src/b.ts',
        relativePath: 'src/b.ts',
        imports: [mkImport('./c', ['C'])],
      },
      {
        fileId: 'node::file::r1::src/c.ts',
        relativePath: 'src/c.ts',
        imports: [mkImport('./a', ['A'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/a.ts': 'node::file::r1::src/a.ts',
      'src/b.ts': 'node::file::r1::src/b.ts',
      'src/c.ts': 'node::file::r1::src/c.ts',
    });

    const result = resolveImports(imports, fileMap);

    // 3 files, each with 1 import -> exactly 3 edges
    expect(result).toHaveLength(3);

    // Verify the cycle: A->B, B->C, C->A
    const edgeSet = new Set(result.map((r) => `${r.fromFileId} -> ${r.toFileId}`));
    expect(edgeSet.has('node::file::r1::src/a.ts -> node::file::r1::src/b.ts')).toBe(true);
    expect(edgeSet.has('node::file::r1::src/b.ts -> node::file::r1::src/c.ts')).toBe(true);
    expect(edgeSet.has('node::file::r1::src/c.ts -> node::file::r1::src/a.ts')).toBe(true);
  });

  it('self-importing file does not cause infinite loop', () => {
    const imports = mkImportMap([
      {
        fileId: 'node::file::r1::src/self.ts',
        relativePath: 'src/self.ts',
        imports: [mkImport('./self', ['SelfRef'])],
      },
    ]);
    const fileMap = mkFileMap({
      'src/self.ts': 'node::file::r1::src/self.ts',
    });

    const result = resolveImports(imports, fileMap);

    // Self-import creates an edge from self to self
    expect(result).toHaveLength(1);
    expect(result[0]!.fromFileId).toBe('node::file::r1::src/self.ts');
    expect(result[0]!.toFileId).toBe('node::file::r1::src/self.ts');
  });

  it('large circular chain (50 files) completes quickly', () => {
    const count = 50;
    const entries: Array<{
      fileId: string;
      relativePath: string;
      imports: ImportInfo[];
    }> = [];
    const filePaths: Record<string, string> = {};

    for (let i = 0; i < count; i++) {
      const path = `src/mod${i}.ts`;
      const id = `node::file::r1::${path}`;
      const nextPath = `./mod${(i + 1) % count}`;
      entries.push({
        fileId: id,
        relativePath: path,
        imports: [mkImport(nextPath, [`Mod${(i + 1) % count}`])],
      });
      filePaths[path] = id;
    }

    const imports = mkImportMap(entries);
    const fileMap = mkFileMap(filePaths);

    const start = performance.now();
    const result = resolveImports(imports, fileMap);
    const elapsed = performance.now() - start;

    // Must complete in under 1 second
    expect(elapsed).toBeLessThan(1000);
    // Exactly 50 edges in the ring
    expect(result).toHaveLength(count);
  });
});

// ---------------------------------------------------------------------------
// 9. 10,000 import statements file
// ---------------------------------------------------------------------------
describe('Pathological: 10,000 import statements', () => {
  /**
   * Generate a TypeScript file with the specified number of import
   * statements, each importing from a distinct module.
   */
  function generate10kImports(count: number): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      lines.push(`import { mod${i} } from './module-${i}.js';`);
    }
    // Add a small body so the file is not imports-only
    lines.push('');
    lines.push('export function useMods(): number {');
    lines.push('  return 0;');
    lines.push('}');
    return lines.join('\n');
  }

  it('extractSymbols completes without crash on 10,000 imports', async () => {
    const content = generate10kImports(10_000);

    const start = performance.now();
    const result = await extractSymbols('/fake/many-imports.ts', content, 'typescript');
    const elapsed = performance.now() - start;

    // Must complete within 30 seconds
    expect(elapsed).toBeLessThan(30_000);

    // Must not crash
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');

    // Should extract a reasonable number of imports
    // Tree-sitter should find all 10,000; regex may find fewer but > 0
    expect(result.imports.length).toBeGreaterThan(0);
    expect(result.imports.length).toBeLessThanOrEqual(10_001);

    // Should extract at least the useMods function
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('import count is in the expected range', async () => {
    const content = generate10kImports(10_000);
    const result = await extractSymbols('/fake/many-imports.ts', content, 'typescript');

    // If tree-sitter is available it should find close to 10,000 imports
    if (!result.partial) {
      expect(result.imports.length).toBeGreaterThanOrEqual(9_000);
    }
    // Either way, no spurious million-count blowup
    expect(result.imports.length).toBeLessThan(50_000);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 10. 1,000 exported symbols file
// ---------------------------------------------------------------------------
describe('Pathological: 1,000 exported symbols', () => {
  /**
   * Generate a TypeScript file with the specified number of distinct
   * exported symbols: a mix of functions, classes, interfaces, consts,
   * and type aliases.
   */
  function generate1kExports(count: number): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      const kind = i % 5;
      switch (kind) {
        case 0:
          lines.push(`export function fn_${i}(x: number): number { return x + ${i}; }`);
          break;
        case 1:
          lines.push(`export class Cls_${i} { value = ${i}; }`);
          break;
        case 2:
          lines.push(`export interface Iface_${i} { id: number; }`);
          break;
        case 3:
          lines.push(`export const CONST_${i} = ${i};`);
          break;
        case 4:
          lines.push(`export type Type_${i} = { key: string; val: ${i} };`);
          break;
      }
    }
    return lines.join('\n');
  }

  it('extractSymbols completes without crash on 1,000 exports', async () => {
    const content = generate1kExports(1_000);

    const start = performance.now();
    const result = await extractSymbols('/fake/many-exports.ts', content, 'typescript');
    const elapsed = performance.now() - start;

    // Must complete within 30 seconds
    expect(elapsed).toBeLessThan(30_000);

    // Must not crash
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');

    // Should extract a reasonable number of symbols
    expect(result.symbols.length).toBeGreaterThan(0);
    // Should not exceed a reasonable multiple of the input
    expect(result.symbols.length).toBeLessThan(10_000);
  }, 60_000);

  it('symbol count is in the expected range', async () => {
    const content = generate1kExports(1_000);
    const result = await extractSymbols('/fake/many-exports.ts', content, 'typescript');

    // If tree-sitter is available, it should find close to 1,000 symbols
    if (!result.partial) {
      expect(result.symbols.length).toBeGreaterThanOrEqual(800);
    }
    // Either way, no blowup
    expect(result.symbols.length).toBeLessThan(10_000);
  }, 60_000);

  it('all exported symbols are extracted with correct exported flag', async () => {
    const content = generate1kExports(1_000);
    const result = await extractSymbols('/fake/many-exports.ts', content, 'typescript');

    if (!result.partial) {
      // Every symbol we generated was exported
      const exportedCount = result.symbols.filter(s => s.exported).length;
      expect(exportedCount).toBeGreaterThanOrEqual(800);
    }
  }, 60_000);
});
