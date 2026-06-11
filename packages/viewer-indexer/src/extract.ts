import { createRequire } from 'node:module';
import type { ExtractionResult, SymbolInfo, ImportInfo } from './types.js';
import {
  detectLanguage,
  GRAMMAR_REGISTRY,
  type TreeSitterNode,
} from './grammar-registry.js';

type TreeSitterParser = {
  parse(input: string): { rootNode: TreeSitterNode };
};

// Per-language grammar cache. A cached `null` means load was attempted and failed.
const grammarCache = new Map<string, TreeSitterParser | null>();

// Tracks whether web-tree-sitter has been initialized.
let treeSitterInit: Promise<any> | null = null;

function resolveWasmPath(packageName: string, wasmFileName: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve(`${packageName}/package.json`);
    const pkgDir = pkgPath.replace(/\/package\.json$/, '');
    return `${pkgDir}/${wasmFileName}`;
  } catch {
    return null;
  }
}

async function ensureTreeSitterInit(): Promise<any> {
  if (treeSitterInit === null) {
    treeSitterInit = import('web-tree-sitter').then(async (mod) => {
      await mod.default.init();
      return mod.default;
    });
  }
  return treeSitterInit;
}

/**
 * Lazy-load a grammar for the given language. Returns a parser on success,
 * or null on failure. Each grammar is loaded in isolation -- one grammar
 * failing does not affect others.
 */
async function loadGrammar(language: string): Promise<TreeSitterParser | null> {
  if (grammarCache.has(language)) return grammarCache.get(language)!;

  const entry = GRAMMAR_REGISTRY.find((e) => e.language === language);
  if (!entry) {
    grammarCache.set(language, null);
    return null;
  }

  try {
    const TreeSitter = await ensureTreeSitterInit();

    const wasmPath = resolveWasmPath(entry.wasmPackage, entry.wasmFileName);
    if (!wasmPath) {
      grammarCache.set(language, null);
      return null;
    }

    const lang = await TreeSitter.Language.load(wasmPath);
    const parser = new TreeSitter();
    parser.setLanguage(lang);
    const typed = parser as unknown as TreeSitterParser;
    grammarCache.set(language, typed);
    return typed;
  } catch {
    grammarCache.set(language, null);
    return null;
  }
}

/**
 * Extract symbols and imports from a source file using tree-sitter WASM.
 *
 * For unsupported languages, records partiality and returns empty results.
 * This function only reads file content -- never writes or modifies files.
 */
export async function extractSymbols(
  filePath: string,
  content: string,
  language?: string,
): Promise<ExtractionResult> {
  const lang = language ?? detectLanguage(filePath);

  if (lang === 'unknown') {
    return {
      symbols: [],
      imports: [],
      language: lang,
      partial: true,
      partialReason: `Unsupported language for file: ${filePath}`,
    };
  }

  const entry = GRAMMAR_REGISTRY.find((e) => e.language === lang);
  if (!entry) {
    return {
      symbols: [],
      imports: [],
      language: lang,
      partial: true,
      partialReason: `No registry entry for language: ${lang}`,
    };
  }

  // JSON uses its own visitor directly on content (no tree-sitter parse needed)
  if (lang === 'json') {
    const result = entry.visitor({} as TreeSitterNode, content);
    const partial = result.symbols.length === 0 && content.trim().length > 0;
    if (partial) {
      // Distinguish parse errors from empty objects
      try {
        JSON.parse(content);
        return { ...result, language: lang, partial: false };
      } catch {
        return {
          symbols: [],
          imports: [],
          language: 'json',
          partial: true,
          partialReason: 'JSON parse error',
        };
      }
    }
    return { ...result, language: lang, partial: false };
  }

  // Try loading the grammar for this language
  const parser = await loadGrammar(lang);

  if (parser) {
    return extractWithParser(parser, entry, content, lang);
  }

  // Fallback: regex-based extraction for TS/JS only
  if (lang === 'typescript' || lang === 'javascript') {
    return extractWithRegex(content, lang);
  }

  // No parser available and no fallback for this language
  return {
    symbols: [],
    imports: [],
    language: lang,
    partial: true,
    partialReason: `Grammar load failed for language: ${lang}`,
  };
}

function extractWithParser(
  parser: TreeSitterParser,
  entry: { visitor: (rootNode: TreeSitterNode, content: string) => { symbols: SymbolInfo[]; imports: ImportInfo[] } },
  content: string,
  language: string,
): ExtractionResult {
  try {
    const tree = parser.parse(content);
    const result = entry.visitor(tree.rootNode, content);
    return { ...result, language, partial: false };
  } catch {
    return {
      symbols: [],
      imports: [],
      language,
      partial: true,
      partialReason: 'Tree-sitter parse error',
    };
  }
}

function extractWithRegex(content: string, language: string): ExtractionResult {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    const exportFn = /^export\s+(async\s+)?function\s+(\w+)/;
    const exportClass = /^export\s+class\s+(\w+)/;
    const exportInterface = /^export\s+interface\s+(\w+)/;
    const exportType = /^export\s+type\s+(\w+)\s*=/;
    const exportEnum = /^export\s+enum\s+(\w+)/;
    const exportConst = /^export\s+(?:const|let|var)\s+(\w+)/;
    const plainFn = /^(?:async\s+)?function\s+(\w+)/;
    const plainClass = /^class\s+(\w+)/;

    let m: RegExpMatchArray | null;

    if ((m = line.match(exportFn))) {
      symbols.push({ name: m[2]!, kind: 'function', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(exportClass))) {
      symbols.push({ name: m[1]!, kind: 'class', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(exportInterface))) {
      symbols.push({ name: m[1]!, kind: 'interface', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(exportType))) {
      symbols.push({ name: m[1]!, kind: 'type', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(exportEnum))) {
      symbols.push({ name: m[1]!, kind: 'enum', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(exportConst))) {
      symbols.push({ name: m[1]!, kind: 'variable', exported: true, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(plainFn))) {
      symbols.push({ name: m[1]!, kind: 'function', exported: false, startLine: lineNum, endLine: lineNum });
    } else if ((m = line.match(plainClass))) {
      symbols.push({ name: m[1]!, kind: 'class', exported: false, startLine: lineNum, endLine: lineNum });
    }

    const importMatch = line.match(/^import\s+(?:type\s+)?(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:{[^}]*}|\*\s+as\s+\w+))?\s*from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const specifier = importMatch[1]!;
      const isTypeOnly = /^import\s+type\s/.test(line);
      const namesMatch = line.match(/{([^}]*)}/);
      const names: string[] = [];
      if (namesMatch) {
        for (const n of namesMatch[1]!.split(',')) {
          const trimmed = n.trim().split(/\s+as\s+/)[0]!.trim();
          if (trimmed) names.push(trimmed);
        }
      }
      imports.push({ specifier, names, isTypeOnly, line: lineNum });
    }
  }

  return {
    symbols,
    imports,
    language,
    partial: true,
    partialReason: 'Regex-based extraction (tree-sitter unavailable)',
  };
}
