import { readdirSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { WalkEntry } from './types.js';

/** Structural type for exclude matchers. Caller provides the implementation. */
interface ExcludeMatcher {
  isExcluded(path: string): boolean;
}

/**
 * Recursively walk a directory, applying exclude patterns.
 * Returns a flat list of file entries with relative paths.
 *
 * This function is read-only: it never writes or modifies any file.
 */
export function walkFiles(
  repoRoot: string,
  excludeMatcher: ExcludeMatcher,
): WalkEntry[] {
  const results: WalkEntry[] = [];
  walkDir(repoRoot, repoRoot, excludeMatcher, results);
  return results;
}

function walkDir(
  dir: string,
  repoRoot: string,
  excludeMatcher: ExcludeMatcher,
  results: WalkEntry[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory not readable -- skip silently
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(dir, entry);
    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const relativePath = relative(repoRoot, absolutePath).split(sep).join('/');

    // Check exclusion on relative path
    if (excludeMatcher.isExcluded(relativePath)) continue;

    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      // Cannot stat -- skip
      continue;
    }

    // Skip symlinks entirely to avoid escaping the repo boundary
    // and to prevent infinite recursion through symlink cycles.
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      // Skip hidden directories (except .github, etc. which gitignore handles)
      if (entry.startsWith('.') && entry !== '.github') continue;
      walkDir(absolutePath, repoRoot, excludeMatcher, results);
    } else if (stat.isFile()) {
      results.push({ relativePath, absolutePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
}
