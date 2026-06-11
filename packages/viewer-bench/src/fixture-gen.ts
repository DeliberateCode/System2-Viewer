/**
 * Synthetic fixture generator for viewer-bench.
 *
 * Generates a temporary directory tree with realistic source files in
 * TypeScript, Python, Rust, and Go for benchmarking indexing throughput.
 *
 * Output is deterministic given the same FixtureConfig (seeded PRNG).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureConfig } from './types.js';

// --- Seeded PRNG (mulberry32) for deterministic output ---

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RNG {
  next(): number;
  intRange(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
}

function createRNG(seed: number): RNG {
  const gen = mulberry32(seed);
  return {
    next: gen,
    intRange(min: number, max: number): number {
      return min + Math.floor(gen() * (max - min + 1));
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(gen() * arr.length)];
    },
  };
}

function nonEmptyCount(lines: string[]): number {
  let count = 0;
  for (const l of lines) {
    if (l.trim().length > 0) count++;
  }
  return count;
}

// --- Directory name pools ---

const DIR_NAMES_TS = ['src', 'lib', 'utils', 'services', 'models', 'helpers', 'core', 'api'] as const;
const DIR_NAMES_PY = ['src', 'lib', 'utils', 'services', 'models', 'helpers', 'core', 'handlers'] as const;
const DIR_NAMES_RS = ['src', 'lib', 'utils', 'handlers', 'models', 'core', 'types', 'config'] as const;
const DIR_NAMES_GO = ['pkg', 'internal', 'cmd', 'handlers', 'models', 'service', 'config', 'util'] as const;

const LANG_DIRS: Record<string, readonly string[]> = {
  typescript: DIR_NAMES_TS,
  python: DIR_NAMES_PY,
  rust: DIR_NAMES_RS,
  go: DIR_NAMES_GO,
};

const LANG_EXT: Record<string, string> = {
  typescript: '.ts',
  python: '.py',
  rust: '.rs',
  go: '.go',
};

// --- Name generators ---

const TS_CLASS_NAMES = [
  'UserService', 'DataManager', 'EventBus', 'ConfigLoader', 'CacheStore',
  'Logger', 'Router', 'Validator', 'Formatter', 'Transformer',
  'Repository', 'Controller', 'Middleware', 'Serializer', 'Pipeline',
] as const;

const TS_FUNC_NAMES = [
  'processData', 'validateInput', 'transformOutput', 'handleRequest', 'parseConfig',
  'formatResult', 'computeHash', 'mergeObjects', 'filterItems', 'sortEntries',
  'loadModule', 'initSystem', 'shutdownGracefully', 'retryOperation', 'batchProcess',
] as const;

const PY_CLASS_NAMES = [
  'DataProcessor', 'EventHandler', 'ConfigManager', 'CacheLayer', 'TaskRunner',
  'ModelBuilder', 'Pipeline', 'Validator', 'Serializer', 'Registry',
  'Scheduler', 'Dispatcher', 'Aggregator', 'Transformer', 'Monitor',
] as const;

const PY_FUNC_NAMES = [
  'process_data', 'validate_input', 'transform_output', 'handle_request', 'parse_config',
  'format_result', 'compute_hash', 'merge_dicts', 'filter_items', 'sort_entries',
  'load_module', 'init_system', 'shutdown_gracefully', 'retry_operation', 'batch_process',
] as const;

const RS_STRUCT_NAMES = [
  'Config', 'AppState', 'Request', 'Response', 'Handler',
  'Builder', 'Parser', 'Cache', 'Registry', 'Pipeline',
  'Metrics', 'Context', 'Error', 'Result', 'Entry',
] as const;

const RS_FUNC_NAMES = [
  'parse_config', 'handle_request', 'process_data', 'validate_input', 'transform',
  'serialize', 'deserialize', 'compute_hash', 'build_index', 'run_pipeline',
  'init_logger', 'load_state', 'save_state', 'merge_results', 'format_output',
] as const;

const GO_TYPE_NAMES = [
  'Server', 'Client', 'Handler', 'Config', 'Store',
  'Cache', 'Router', 'Middleware', 'Logger', 'Validator',
  'Pipeline', 'Worker', 'Registry', 'Dispatcher', 'Monitor',
] as const;

const GO_FUNC_NAMES = [
  'NewServer', 'HandleRequest', 'ProcessData', 'ValidateInput', 'ParseConfig',
  'FormatOutput', 'ComputeHash', 'LoadState', 'SaveState', 'RunPipeline',
  'newClient', 'handleError', 'processItem', 'validateConfig', 'parseInput',
] as const;

// --- File content generators ---

function generateTsFile(rng: RNG, targetLoc: number, fileIndex: number, siblingNames: string[]): string {
  const lines: string[] = [];
  const className = `${TS_CLASS_NAMES[fileIndex % TS_CLASS_NAMES.length]}${fileIndex}`;
  const funcName = `${TS_FUNC_NAMES[fileIndex % TS_FUNC_NAMES.length]}${fileIndex}`;
  const interfaceName = `I${className}`;

  // Imports
  if (siblingNames.length > 0) {
    const importTarget = rng.pick(siblingNames);
    lines.push(`import { type ${importTarget} } from './${importTarget}.js';`);
  }
  lines.push('');

  // Interface
  lines.push(`export interface ${interfaceName} {`);
  lines.push(`  id: string;`);
  lines.push(`  name: string;`);
  lines.push(`  value: number;`);
  lines.push(`}`);
  lines.push('');

  // Class
  lines.push(`export class ${className} implements ${interfaceName} {`);
  lines.push(`  id: string;`);
  lines.push(`  name: string;`);
  lines.push(`  value: number;`);
  lines.push('');
  lines.push(`  constructor(id: string, name: string, value: number) {`);
  lines.push(`    this.id = id;`);
  lines.push(`    this.name = name;`);
  lines.push(`    this.value = value;`);
  lines.push(`  }`);
  lines.push('');
  lines.push(`  toString(): string {`);
  lines.push(`    return \`\${this.name}(\${this.id})\`;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  // Exported function
  lines.push(`export function ${funcName}(input: ${interfaceName}): ${interfaceName} {`);
  lines.push(`  const result = { ...input, value: input.value + 1 };`);
  lines.push(`  return result;`);
  lines.push(`}`);
  lines.push('');

  // Pad to targetLoc non-empty lines with helper functions
  let padIdx = 0;
  while (nonEmptyCount(lines) < targetLoc) {
    lines.push(`function helper${fileIndex}_${padIdx}(x: number): number {`);
    lines.push(`  return x * ${rng.intRange(2, 100)};`);
    lines.push(`}`);
    lines.push('');
    padIdx++;
  }

  return lines.join('\n') + '\n';
}

function generatePyFile(rng: RNG, targetLoc: number, fileIndex: number, siblingNames: string[]): string {
  const lines: string[] = [];
  const className = `${PY_CLASS_NAMES[fileIndex % PY_CLASS_NAMES.length]}${fileIndex}`;
  const funcName = `${PY_FUNC_NAMES[fileIndex % PY_FUNC_NAMES.length]}${fileIndex}`;

  // Imports
  lines.push('from typing import List, Optional, Dict');
  if (siblingNames.length > 0) {
    const importTarget = rng.pick(siblingNames);
    lines.push(`from . import ${importTarget}`);
  }
  lines.push('');

  // Global variable
  lines.push(`MAX_RETRIES: int = ${rng.intRange(3, 10)}`);
  lines.push('');

  // Class
  lines.push(`class ${className}:`);
  lines.push(`    """${className} handles data operations."""`);
  lines.push('');
  lines.push(`    def __init__(self, name: str, value: int = 0) -> None:`);
  lines.push(`        self.name = name`);
  lines.push(`        self.value = value`);
  lines.push('');
  lines.push(`    def process(self) -> Dict[str, int]:`);
  lines.push(`        return {"name": hash(self.name), "value": self.value}`);
  lines.push('');
  lines.push(`    def __repr__(self) -> str:`);
  lines.push(`        return f"${className}({self.name!r})"`);
  lines.push('');

  // Function
  lines.push(`def ${funcName}(data: List[int]) -> List[int]:`);
  lines.push(`    """Process the given data list."""`);
  lines.push(`    return [x * ${rng.intRange(2, 10)} for x in data]`);
  lines.push('');

  // __all__
  lines.push(`__all__ = ["${className}", "${funcName}"]`);
  lines.push('');

  // Pad
  let padIdx = 0;
  while (nonEmptyCount(lines) < targetLoc) {
    lines.push(`def _helper_${fileIndex}_${padIdx}(x: int) -> int:`);
    lines.push(`    return x + ${rng.intRange(1, 1000)}`);
    lines.push('');
    padIdx++;
  }

  return lines.join('\n') + '\n';
}

function generateRsFile(rng: RNG, targetLoc: number, fileIndex: number, siblingNames: string[]): string {
  const lines: string[] = [];
  const structName = `${RS_STRUCT_NAMES[fileIndex % RS_STRUCT_NAMES.length]}${fileIndex}`;
  const funcName = `${RS_FUNC_NAMES[fileIndex % RS_FUNC_NAMES.length]}${fileIndex}`;

  // Use declarations
  lines.push('use std::collections::HashMap;');
  if (siblingNames.length > 0) {
    const importTarget = rng.pick(siblingNames);
    lines.push(`use crate::${importTarget};`);
  }
  lines.push('');

  // Struct
  lines.push(`pub struct ${structName} {`);
  lines.push(`    pub name: String,`);
  lines.push(`    pub value: i64,`);
  lines.push(`    data: HashMap<String, String>,`);
  lines.push(`}`);
  lines.push('');

  // Impl
  lines.push(`impl ${structName} {`);
  lines.push(`    pub fn new(name: String) -> Self {`);
  lines.push(`        ${structName} {`);
  lines.push(`            name,`);
  lines.push(`            value: 0,`);
  lines.push(`            data: HashMap::new(),`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push('');
  lines.push(`    pub fn process(&self) -> i64 {`);
  lines.push(`        self.value * ${rng.intRange(2, 100)}`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push('');

  // Public function
  lines.push(`pub fn ${funcName}(input: &str) -> Result<${structName}, String> {`);
  lines.push(`    let result = ${structName}::new(input.to_string());`);
  lines.push(`    Ok(result)`);
  lines.push(`}`);
  lines.push('');

  // Private function
  lines.push(`fn validate_${fileIndex}(data: &str) -> bool {`);
  lines.push(`    !data.is_empty()`);
  lines.push(`}`);
  lines.push('');

  // Pad
  let padIdx = 0;
  while (nonEmptyCount(lines) < targetLoc) {
    lines.push(`fn helper_${fileIndex}_${padIdx}(x: i64) -> i64 {`);
    lines.push(`    x + ${rng.intRange(1, 1000)}`);
    lines.push(`}`);
    lines.push('');
    padIdx++;
  }

  return lines.join('\n') + '\n';
}

function generateGoFile(rng: RNG, targetLoc: number, fileIndex: number, siblingNames: string[], pkgName: string): string {
  const lines: string[] = [];
  const typeName = `${GO_TYPE_NAMES[fileIndex % GO_TYPE_NAMES.length]}${fileIndex}`;
  const funcName = `${GO_FUNC_NAMES[fileIndex % GO_FUNC_NAMES.length]}${fileIndex}`;

  // Package declaration
  lines.push(`package ${pkgName}`);
  lines.push('');

  // Imports
  lines.push('import (');
  lines.push('\t"fmt"');
  lines.push('\t"strings"');
  if (siblingNames.length > 0) {
    // Go cross-file imports are within the same package; no explicit import needed
  }
  lines.push(')');
  lines.push('');

  // Exported const
  lines.push(`const Default${typeName}Name = "default"`);
  lines.push('');

  // Exported type
  lines.push(`type ${typeName} struct {`);
  lines.push(`\tName  string`);
  lines.push(`\tValue int`);
  lines.push(`}`);
  lines.push('');

  // Exported function (constructor)
  lines.push(`func ${funcName}(name string) *${typeName} {`);
  lines.push(`\treturn &${typeName}{`);
  lines.push(`\t\tName:  name,`);
  lines.push(`\t\tValue: ${rng.intRange(0, 100)},`);
  lines.push(`\t}`);
  lines.push(`}`);
  lines.push('');

  // Method
  lines.push(`func (s *${typeName}) String() string {`);
  lines.push(`\treturn fmt.Sprintf("%s(%d)", s.Name, s.Value)`);
  lines.push(`}`);
  lines.push('');

  // Unexported function
  lines.push(`func validate${fileIndex}(input string) bool {`);
  lines.push(`\treturn strings.TrimSpace(input) != ""`);
  lines.push(`}`);
  lines.push('');

  // Pad
  let padIdx = 0;
  while (nonEmptyCount(lines) < targetLoc) {
    lines.push(`func helper${fileIndex}x${padIdx}(x int) int {`);
    lines.push(`\treturn x + ${rng.intRange(1, 1000)}`);
    lines.push(`}`);
    lines.push('');
    padIdx++;
  }

  return lines.join('\n') + '\n';
}

// --- Path generation ---

function assignDirectory(rng: RNG, lang: string, nestingDepth: number, fileIndex: number): string {
  const dirs = LANG_DIRS[lang] ?? DIR_NAMES_TS;
  const depth = rng.intRange(1, nestingDepth);
  const parts: string[] = [];
  for (let d = 0; d < depth; d++) {
    parts.push(dirs[(fileIndex + d) % dirs.length]);
  }
  return parts.join('/');
}

function generateFileName(lang: string, fileIndex: number): string {
  const ext = LANG_EXT[lang] ?? '.ts';
  const baseName = `module_${fileIndex}`;
  return `${baseName}${ext}`;
}

// --- Main entry ---

export function generateFixture(config: FixtureConfig): string {
  const { languages, locRange, nestingDepth, outputDir } = config;
  const languageTotal = Object.values(languages).reduce((sum, count) => sum + count, 0);
  if (config.totalFiles !== undefined && config.totalFiles !== languageTotal) {
    throw new Error(
      `FixtureConfig.totalFiles (${config.totalFiles}) must equal the sum of language file counts (${languageTotal})`,
    );
  }
  const rng = createRNG(42);

  mkdirSync(outputDir, { recursive: true });

  // Write root package.json workspace marker
  const pkgJson = {
    name: 'bench-fixture',
    version: '0.0.0',
    private: true,
  };
  writeFileSync(join(outputDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');

  // Build file assignments: expand language distribution into an ordered list
  const fileAssignments: Array<{ lang: string; index: number }> = [];
  let globalIndex = 0;
  for (const [lang, count] of Object.entries(languages)) {
    for (let i = 0; i < count; i++) {
      fileAssignments.push({ lang, index: globalIndex });
      globalIndex++;
    }
  }

  // Track sibling files per directory for cross-file imports
  const dirFiles: Record<string, string[]> = {};

  // First pass: determine paths
  const filePaths: Array<{ lang: string; index: number; dir: string; name: string; fullDir: string }> = [];
  for (const { lang, index } of fileAssignments) {
    const relDir = assignDirectory(rng, lang, nestingDepth, index);
    const fileName = generateFileName(lang, index);
    const fullDir = join(outputDir, relDir);
    const baseName = fileName.replace(LANG_EXT[lang] ?? '.ts', '');

    if (!dirFiles[relDir]) dirFiles[relDir] = [];
    dirFiles[relDir].push(baseName);

    filePaths.push({ lang, index, dir: relDir, name: fileName, fullDir });
  }

  // Second pass: generate files with cross-references
  for (const { lang, index, dir, name, fullDir } of filePaths) {
    mkdirSync(fullDir, { recursive: true });

    const baseName = name.replace(LANG_EXT[lang] ?? '.ts', '');
    const siblings = (dirFiles[dir] ?? []).filter((n) => n !== baseName);
    const targetLoc = rng.intRange(locRange[0], locRange[1]);

    let content: string;
    switch (lang) {
      case 'typescript':
        content = generateTsFile(rng, targetLoc, index, siblings);
        break;
      case 'python':
        content = generatePyFile(rng, targetLoc, index, siblings);
        break;
      case 'rust':
        content = generateRsFile(rng, targetLoc, index, siblings);
        break;
      case 'go': {
        // Derive Go package name from innermost directory
        const parts = dir.split('/');
        const pkgName = parts[parts.length - 1].replace(/[^a-z]/g, '') || 'main';
        content = generateGoFile(rng, targetLoc, index, siblings, pkgName);
        break;
      }
      default:
        content = `// unsupported language: ${lang}\n`;
    }

    writeFileSync(join(fullDir, name), content);
  }

  return outputDir;
}
