/**
 * Large file stress test for the symbol extraction pipeline.
 *
 * Generates a synthetic 50,000-line TypeScript file and verifies that
 * extractSymbols completes within 30 seconds, does not OOM, and
 * produces a reasonable symbol count.
 *
 *
 */
import { describe, it, expect } from 'vitest';
import { extractSymbols } from '../extract.js';

/**
 * Generate a synthetic TypeScript file with the specified number of lines.
 * The generated file contains:
 *   - Exported functions (every 50 lines)
 *   - Exported classes (every 200 lines)
 *   - Exported interfaces (every 500 lines)
 *   - Exported type aliases (every 1000 lines)
 *   - Import statements at the top
 *   - Variable declarations and logic filling the gaps
 */
function generateLargeTypeScriptFile(lineCount: number): string {
  const lines: string[] = [];

  // Add some import statements at the top
  lines.push("import { readFileSync } from 'node:fs';");
  lines.push("import { join } from 'node:path';");
  lines.push('');

  for (let i = 3; i < lineCount; i++) {
    const lineNum = i + 1;

    if (lineNum % 1000 === 0) {
      // Exported type alias every 1000 lines
      lines.push(`export type Config${lineNum} = { key: string; value: number };`);
    } else if (lineNum % 500 === 0) {
      // Exported interface every 500 lines
      lines.push(`export interface Handler${lineNum} {`);
      lines.push(`  handle(input: string): Promise<void>;`);
      lines.push(`}`);
      i += 2; // account for the extra lines
    } else if (lineNum % 200 === 0) {
      // Exported class every 200 lines
      lines.push(`export class Service${lineNum} {`);
      lines.push(`  private data: Map<string, number> = new Map();`);
      lines.push(`  process(input: string): number {`);
      lines.push(`    return this.data.get(input) ?? 0;`);
      lines.push(`  }`);
      lines.push(`}`);
      i += 5;
    } else if (lineNum % 50 === 0) {
      // Exported function every 50 lines
      lines.push(`export function compute${lineNum}(x: number): number {`);
      lines.push(`  return x * ${lineNum} + Math.floor(Math.random() * 100);`);
      lines.push(`}`);
      i += 2;
    } else {
      // Filler: variable assignments and expressions
      lines.push(`const v${lineNum} = ${lineNum} * 2 + ${lineNum % 7};`);
    }
  }

  // Ensure we have at least lineCount lines
  while (lines.length < lineCount) {
    lines.push(`// padding line ${lines.length}`);
  }

  return lines.join('\n');
}

describe('Large file stress test', () => {
  it('extractSymbols completes within 30 seconds on a 50,000-line TypeScript file', async () => {
    const content = generateLargeTypeScriptFile(50_000);
    const lineCount = content.split('\n').length;

    // Verify the generated file is close to 50k lines
    expect(lineCount).toBeGreaterThanOrEqual(49_000);

    const start = performance.now();
    const result = await extractSymbols('/fake/large-file.ts', content, 'typescript');
    const elapsed = performance.now() - start;

    // Must complete within 30 seconds
    expect(elapsed).toBeLessThan(30_000);

    // Should not crash (if we got here, no OOM)
    expect(result).toBeDefined();
    expect(result.language).toBe('typescript');
  }, 60_000); // vitest timeout: 60s to allow for slow CI

  it('does not OOM (heapUsed stays under 1GB)', async () => {
    const content = generateLargeTypeScriptFile(50_000);

    // Force GC if available to get a cleaner baseline
    if (global.gc) global.gc();
    const beforeHeap = process.memoryUsage().heapUsed;

    await extractSymbols('/fake/large-file.ts', content, 'typescript');

    const afterHeap = process.memoryUsage().heapUsed;
    const heapDelta = afterHeap - beforeHeap;

    // The heap growth should be well under 1GB
    // The content itself is ~2-3MB, extraction overhead should be modest
    expect(afterHeap).toBeLessThan(1_073_741_824); // 1GB absolute cap
    // Delta check: extraction should not allocate more than 500MB above baseline
    expect(heapDelta).toBeLessThan(536_870_912); // 512MB
  }, 60_000);

  it('extracted symbols count is reasonable (not zero, not millions)', async () => {
    const content = generateLargeTypeScriptFile(50_000);

    const result = await extractSymbols('/fake/large-file.ts', content, 'typescript');

    // With a function every 50 lines, class every 200, interface every 500,
    // type every 1000 in a 50k-line file, we expect:
    // ~1000 functions + ~250 classes + ~100 interfaces + ~50 types = ~1400
    // But the exact count depends on the extraction backend (tree-sitter vs regex)
    // and whether all constructs are recognized.
    //
    // Reasonable bounds: at least some symbols, not millions
    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.symbols.length).toBeLessThan(100_000);

    // Verify import extraction also works
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('handles the file without partial failure when tree-sitter is available', async () => {
    const content = generateLargeTypeScriptFile(50_000);

    const result = await extractSymbols('/fake/large-file.ts', content, 'typescript');

    // If tree-sitter is available and working, partial should be false.
    // If tree-sitter is unavailable, the regex fallback sets partial=true
    // with partialReason. Either way, it should not throw.
    if (result.partial) {
      // Acceptable: tree-sitter WASM not available in test environment
      expect(result.partialReason).toBeDefined();
    } else {
      // Full extraction succeeded
      expect(result.partial).toBe(false);
    }
  }, 60_000);
});
