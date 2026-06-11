/**
 * Tests for grammar registry, language detection, lazy grammar loading,
 * and per-grammar isolation.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  GRAMMAR_REGISTRY,
  type GrammarEntry,
  type LanguageVisitor,
} from '../grammar-registry.js';

describe('detectLanguage', () => {
  // Phase 1 languages (unchanged behavior)
  it('maps .ts to typescript', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript');
  });

  it('maps .tsx to typescript', () => {
    expect(detectLanguage('foo.tsx')).toBe('typescript');
  });

  it('maps .mts to typescript', () => {
    expect(detectLanguage('foo.mts')).toBe('typescript');
  });

  it('maps .cts to typescript', () => {
    expect(detectLanguage('foo.cts')).toBe('typescript');
  });

  it('maps .js to javascript', () => {
    expect(detectLanguage('foo.js')).toBe('javascript');
  });

  it('maps .jsx to javascript', () => {
    expect(detectLanguage('foo.jsx')).toBe('javascript');
  });

  it('maps .mjs to javascript', () => {
    expect(detectLanguage('foo.mjs')).toBe('javascript');
  });

  it('maps .cjs to javascript', () => {
    expect(detectLanguage('foo.cjs')).toBe('javascript');
  });

  it('maps .json to json', () => {
    expect(detectLanguage('foo.json')).toBe('json');
  });

  // Phase 2 languages
  it('maps .py to python', () => {
    expect(detectLanguage('foo.py')).toBe('python');
  });

  it('maps .rs to rust', () => {
    expect(detectLanguage('foo.rs')).toBe('rust');
  });

  it('maps .go to go', () => {
    expect(detectLanguage('foo.go')).toBe('go');
  });

  it('maps .java to java', () => {
    expect(detectLanguage('foo.java')).toBe('java');
  });

  it('handles nested .java path', () => {
    expect(detectLanguage('src/main/java/com/example/App.java')).toBe('java');
  });

  // Unsupported
  it('returns unknown for unsupported extensions', () => {
    expect(detectLanguage('foo.rb')).toBe('unknown');
  });

  it('returns unknown for files without extension', () => {
    expect(detectLanguage('Makefile')).toBe('unknown');
  });

  // Paths with directories
  it('handles full paths', () => {
    expect(detectLanguage('/home/user/project/src/main.py')).toBe('python');
  });

  it('handles nested .rs path', () => {
    expect(detectLanguage('src/lib.rs')).toBe('rust');
  });

  it('handles nested .go path', () => {
    expect(detectLanguage('pkg/server/main.go')).toBe('go');
  });
});

describe('GRAMMAR_REGISTRY', () => {
  it('is an array of GrammarEntry objects', () => {
    expect(Array.isArray(GRAMMAR_REGISTRY)).toBe(true);
    expect(GRAMMAR_REGISTRY.length).toBeGreaterThanOrEqual(7);
  });

  it('includes typescript entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'typescript');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-typescript');
    expect(entry!.extensions).toContain('.ts');
    expect(entry!.extensions).toContain('.tsx');
  });

  it('includes javascript entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'javascript');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-typescript');
    expect(entry!.extensions).toContain('.js');
  });

  it('includes json entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'json');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-json');
    expect(entry!.extensions).toContain('.json');
  });

  it('includes python entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'python');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-python');
    expect(entry!.extensions).toContain('.py');
  });

  it('includes rust entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'rust');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-rust');
    expect(entry!.extensions).toContain('.rs');
  });

  it('includes go entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'go');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-go');
    expect(entry!.extensions).toContain('.go');
  });

  it('includes java entry', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'java');
    expect(entry).toBeDefined();
    expect(entry!.wasmPackage).toBe('tree-sitter-java');
    expect(entry!.extensions).toContain('.java');
  });

  it('every entry has a visitor function', () => {
    for (const entry of GRAMMAR_REGISTRY) {
      expect(typeof entry.visitor).toBe('function');
    }
  });

  it('no duplicate language keys', () => {
    const langs = GRAMMAR_REGISTRY.map((e) => e.language);
    expect(new Set(langs).size).toBe(langs.length);
  });

  it('no overlapping extensions across entries', () => {
    const seen = new Map<string, string>();
    for (const entry of GRAMMAR_REGISTRY) {
      for (const ext of entry.extensions) {
        if (seen.has(ext)) {
          throw new Error(
            `Extension ${ext} claimed by both ${seen.get(ext)} and ${entry.language}`,
          );
        }
        seen.set(ext, entry.language);
      }
    }
  });
});

describe('Phase 2 language visitors with empty source', () => {
  const emptyRoot = {
    type: 'source_file',
    text: '',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    children: [],
    namedChildren: [],
    childForFieldName: () => null,
  } as any;

  it('python visitor returns empty results for empty source', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'python')!;
    const result = entry.visitor(emptyRoot, '');
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it('rust visitor returns empty results for empty source', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'rust')!;
    const result = entry.visitor(emptyRoot, '');
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it('go visitor returns empty results for empty source', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'go')!;
    const result = entry.visitor(emptyRoot, '');
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it('java visitor returns empty results for empty source', () => {
    const entry = GRAMMAR_REGISTRY.find((e) => e.language === 'java')!;
    const result = entry.visitor(emptyRoot, '');
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});
