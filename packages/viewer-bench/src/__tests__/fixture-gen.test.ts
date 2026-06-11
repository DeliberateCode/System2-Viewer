/**
 * Tests for the synthetic fixture generator and golden fixtures.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateFixture } from '../fixture-gen.js';
import type { FixtureConfig } from '../types.js';
import {
  GOLDEN_FIXTURES,
  type GoldenFixture,
  type ExpectedSymbol,
  type ExpectedImport,
} from '../golden-fixture.js';

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function filesByExtension(files: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.'));
    if (!result[ext]) result[ext] = [];
    result[ext].push(f);
  }
  return result;
}

describe('generateFixture', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = join(tmpdir(), `bench-fixture-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('creates the output directory and returns its path', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 2, python: 2, rust: 2, go: 2 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir,
    };
    const result = generateFixture(config);
    expect(result).toBe(outputDir);
    expect(existsSync(outputDir)).toBe(true);
  });

  it('generates the correct total number of source files', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      totalFiles: 20,
      languages: { typescript: 5, python: 5, rust: 5, go: 5 },
      locRange: [10, 50],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const files = collectFiles(outputDir);
    const sourceFiles = files.filter(
      (f) => f.endsWith('.ts') || f.endsWith('.py') || f.endsWith('.rs') || f.endsWith('.go'),
    );
    expect(sourceFiles.length).toBe(20);
  });

  it('throws when totalFiles does not match the language distribution', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      totalFiles: 5,
      languages: { typescript: 2, python: 2, rust: 2, go: 0 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir,
    };
    expect(() => generateFixture(config)).toThrow(
      'FixtureConfig.totalFiles (5) must equal the sum of language file counts (6)',
    );
  });

  it('respects language distribution', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 8, python: 6, rust: 4, go: 2 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const files = collectFiles(outputDir);
    const byExt = filesByExtension(files);
    expect(byExt['.ts']?.length ?? 0).toBe(8);
    expect(byExt['.py']?.length ?? 0).toBe(6);
    expect(byExt['.rs']?.length ?? 0).toBe(4);
    expect(byExt['.go']?.length ?? 0).toBe(2);
  });

  it('creates files with LOC within the configured range', () => {
    const outputDir = makeTempDir();
    const minLoc = 10;
    const maxLoc = 50;
    const config: FixtureConfig = {
      languages: { typescript: 3, python: 3, rust: 3, go: 3 },
      locRange: [minLoc, maxLoc],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const files = collectFiles(outputDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.py') || f.endsWith('.rs') || f.endsWith('.go'),
    );
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(minLoc);
      expect(lines.length).toBeLessThanOrEqual(maxLoc + 10); // allow small overhead from structure
    }
  });

  it('creates directory nesting up to configured depth', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 5, python: 5, rust: 5, go: 5 },
      locRange: [10, 30],
      nestingDepth: 3,
      outputDir,
    };
    generateFixture(config);
    const files = collectFiles(outputDir);
    let maxDepth = 0;
    for (const file of files) {
      const rel = file.slice(outputDir.length + 1);
      const depth = rel.split('/').length - 1; // directories above the file
      if (depth > maxDepth) maxDepth = depth;
    }
    expect(maxDepth).toBeGreaterThanOrEqual(1);
    expect(maxDepth).toBeLessThanOrEqual(3);
  });

  it('includes a root package.json workspace marker', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 2, python: 2, rust: 2, go: 2 },
      locRange: [10, 30],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const pkgPath = join(outputDir, 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBeDefined();
  });

  it('produces deterministic output given the same config', () => {
    const outputDir1 = makeTempDir();
    const outputDir2 = makeTempDir();
    const baseConfig: Omit<FixtureConfig, 'outputDir'> = {
      languages: { typescript: 3, python: 3, rust: 3, go: 3 },
      locRange: [10, 30],
      nestingDepth: 2,
    };
    generateFixture({ ...baseConfig, outputDir: outputDir1 });
    generateFixture({ ...baseConfig, outputDir: outputDir2 });

    const files1 = collectFiles(outputDir1)
      .map((f) => f.slice(outputDir1.length))
      .sort();
    const files2 = collectFiles(outputDir2)
      .map((f) => f.slice(outputDir2.length))
      .sort();
    expect(files1).toEqual(files2);

    // Content should also be identical
    for (let i = 0; i < files1.length; i++) {
      const c1 = readFileSync(join(outputDir1, files1[i]), 'utf-8');
      const c2 = readFileSync(join(outputDir2, files2[i]), 'utf-8');
      expect(c1).toBe(c2);
    }
  });

  it('TypeScript files contain functions and exports', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 4, python: 0, rust: 0, go: 0 },
      locRange: [20, 60],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const tsFiles = collectFiles(outputDir).filter((f) => f.endsWith('.ts'));
    expect(tsFiles.length).toBe(4);
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(content).toMatch(/export\s+(function|class|interface)/);
    }
  });

  it('Python files contain functions and classes', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 0, python: 4, rust: 0, go: 0 },
      locRange: [20, 60],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const pyFiles = collectFiles(outputDir).filter((f) => f.endsWith('.py'));
    expect(pyFiles.length).toBe(4);
    for (const file of pyFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(content).toMatch(/def\s+\w+/);
    }
  });

  it('Rust files contain fn and struct declarations', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 0, python: 0, rust: 4, go: 0 },
      locRange: [20, 60],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const rsFiles = collectFiles(outputDir).filter((f) => f.endsWith('.rs'));
    expect(rsFiles.length).toBe(4);
    for (const file of rsFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(content).toMatch(/fn\s+\w+/);
    }
  });

  it('Go files contain func declarations', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 0, python: 0, rust: 0, go: 4 },
      locRange: [20, 60],
      nestingDepth: 2,
      outputDir,
    };
    generateFixture(config);
    const goFiles = collectFiles(outputDir).filter((f) => f.endsWith('.go'));
    expect(goFiles.length).toBe(4);
    for (const file of goFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(content).toMatch(/func\s+\w+/);
    }
  });

  it('generates a mixed-language fixture (20 files)', () => {
    const outputDir = makeTempDir();
    const config: FixtureConfig = {
      languages: { typescript: 5, python: 5, rust: 5, go: 5 },
      locRange: [10, 50],
      nestingDepth: 3,
      outputDir,
    };
    generateFixture(config);
    const files = collectFiles(outputDir);
    const sourceFiles = files.filter(
      (f) => f.endsWith('.ts') || f.endsWith('.py') || f.endsWith('.rs') || f.endsWith('.go'),
    );
    expect(sourceFiles.length).toBe(20);
    const byExt = filesByExtension(sourceFiles);
    expect(Object.keys(byExt).sort()).toEqual(['.go', '.py', '.rs', '.ts']);
  });
});

describe('golden fixtures', () => {
  it('exports GOLDEN_FIXTURES array', () => {
    expect(Array.isArray(GOLDEN_FIXTURES)).toBe(true);
    expect(GOLDEN_FIXTURES.length).toBeGreaterThanOrEqual(4);
  });

  it('has golden fixtures for TypeScript, Python, Rust, and Go', () => {
    const languages = GOLDEN_FIXTURES.map((f) => f.language);
    expect(languages).toContain('typescript');
    expect(languages).toContain('python');
    expect(languages).toContain('rust');
    expect(languages).toContain('go');
  });

  it('each fixture has non-empty source content', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      expect(fixture.sourceFile.length).toBeGreaterThan(0);
    }
  });

  it('each fixture has expected symbols', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      expect(fixture.expectedSymbols.length).toBeGreaterThan(0);
      for (const sym of fixture.expectedSymbols) {
        expect(sym.name).toBeTruthy();
        expect(sym.kind).toBeTruthy();
      }
    }
  });

  it('each fixture has expected imports', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      expect(fixture.expectedImports.length).toBeGreaterThan(0);
      for (const imp of fixture.expectedImports) {
        expect(imp.source).toBeTruthy();
      }
    }
  });

  it('TypeScript golden fixture has correct symbols', () => {
    const ts = GOLDEN_FIXTURES.find((f) => f.language === 'typescript')!;
    const names = ts.expectedSymbols.map((s) => s.name);
    expect(names).toContain('UserService');
    expect(names).toContain('createUserService');
    const exported = ts.expectedSymbols.filter((s) => s.exported);
    expect(exported.length).toBeGreaterThan(0);
  });

  it('Python golden fixture has correct symbols', () => {
    const py = GOLDEN_FIXTURES.find((f) => f.language === 'python')!;
    const names = py.expectedSymbols.map((s) => s.name);
    expect(names).toContain('DataProcessor');
    expect(names).toContain('process_data');
  });

  it('Rust golden fixture has correct symbols', () => {
    const rs = GOLDEN_FIXTURES.find((f) => f.language === 'rust')!;
    const names = rs.expectedSymbols.map((s) => s.name);
    expect(names).toContain('Config');
    expect(names).toContain('parse_config');
  });

  it('Go golden fixture has correct symbols', () => {
    const go = GOLDEN_FIXTURES.find((f) => f.language === 'go')!;
    const names = go.expectedSymbols.map((s) => s.name);
    expect(names).toContain('Server');
    expect(names).toContain('NewServer');
  });
});
