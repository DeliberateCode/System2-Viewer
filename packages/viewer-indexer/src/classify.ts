import { basename, extname } from 'node:path';
import type { FileClass, RootMarker } from './types.js';

const TEST_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /__tests__\//,
  /\/test\//,
  /\/tests\//,
];

const CONFIG_PATTERNS = [
  /^tsconfig.*\.json$/,
  /^\.eslintrc/,
  /^\.prettierrc/,
  /^jest\.config/,
  /^vitest\.config/,
  /^webpack\.config/,
  /^rollup\.config/,
  /^vite\.config/,
  /^babel\.config/,
  /^\.babelrc/,
  /^package\.json$/,
  /^viewer\.config\.json$/,
  /^\.editorconfig$/,
  /^\.gitignore$/,
  /^\.npmrc$/,
  /^Makefile$/,
  /^Dockerfile$/,
  /^docker-compose/,
];

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc', '.org']);
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.pdf']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.swift', '.kt']);
const GENERATED_PATTERNS = [
  /\.d\.ts$/,
  /\.min\.[jt]s$/,
  /\/dist\//,
  /\/build\//,
  /\.generated\./,
];

/**
 * Classify a file by path and optionally by content.
 * Returns a FileClass discriminant.
 */
export function classifyFile(filePath: string, _content?: string): FileClass {
  const name = basename(filePath);
  const ext = extname(filePath);

  // Test files
  for (const pat of TEST_PATTERNS) {
    if (pat.test(filePath)) return 'test';
  }

  // Generated files
  for (const pat of GENERATED_PATTERNS) {
    if (pat.test(filePath)) return 'generated';
  }

  // Config files (check basename against patterns)
  for (const pat of CONFIG_PATTERNS) {
    if (pat.test(name)) return 'config';
  }

  // Docs
  if (DOC_EXTENSIONS.has(ext)) return 'doc';

  // Assets
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';

  // Source
  if (SOURCE_EXTENSIONS.has(ext)) return 'source';

  // JSON files are typically config but not always
  if (ext === '.json') return 'config';

  return 'other';
}

const ROOT_MARKERS: Array<{ pattern: RegExp; kind: RootMarker['kind'] }> = [
  { pattern: /^package\.json$/, kind: 'package' },
  { pattern: /^tsconfig\.json$/, kind: 'tsconfig' },
  { pattern: /^\.git$/, kind: 'git' },
  { pattern: /^viewer\.config\.json$/, kind: 'config' },
  { pattern: /^Cargo\.toml$/, kind: 'config' },
  { pattern: /^pyproject\.toml$/, kind: 'config' },
  { pattern: /^go\.mod$/, kind: 'config' },
  { pattern: /^pom\.xml$/, kind: 'config' },
  { pattern: /^build\.gradle$/, kind: 'config' },
  { pattern: /^setup\.py$/, kind: 'config' },
];

/**
 * Detect root markers from a list of directory entries (bare filenames).
 * Returns all matching root markers.
 */
export function detectRootMarker(entries: string[]): RootMarker[] {
  const markers: RootMarker[] = [];
  for (const entry of entries) {
    // Validate: must be bare filename with no path separators
    if (entry.includes('/') || entry.includes('\\')) continue;

    for (const { pattern, kind } of ROOT_MARKERS) {
      if (pattern.test(entry)) {
        markers.push({ marker: entry, kind });
      }
    }
  }
  return markers;
}
