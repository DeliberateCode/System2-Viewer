import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { WorkspaceDiscoveryResult } from './types.js';
import { detectRootMarker } from './classify.js';

// Local constants matching viewer-config values (avoids forbidden import)
const DEFAULT_WORKSPACE_DEPTH = 8;
const DEFAULT_WORKSPACE_MAX_REPOS = 256;
const MAX_WORKSPACE_DEPTH = 64;
const MAX_WORKSPACE_MAX_REPOS = 4096;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'target', 'vendor',
  '__pycache__', 'venv', '.venv', 'site-packages',
]);

/**
 * Discover workspace repositories based on the configured mode.
 *
 * Modes:
 *   - 'auto': discover sub-repos when target looks like a workspace
 *   - 'force': always use workspace framing
 *   - 'off': disable workspace discovery
 *
 * Depth bounded (default 8, max 64), repo count bounded (default 256, max 4096).
 */
export function discoverWorkspace(
  repoRoot: string,
  mode: 'auto' | 'force' | 'off',
  options?: {
    maxDepth?: number;
    maxRepos?: number;
  },
): WorkspaceDiscoveryResult {
  if (mode === 'off') {
    return {
      mode: 'off',
      repositories: [{ root: repoRoot, name: basename(repoRoot) }],
      bounded: false,
    };
  }

  const maxDepth = Math.min(
    options?.maxDepth ?? DEFAULT_WORKSPACE_DEPTH,
    MAX_WORKSPACE_DEPTH,
  );
  const maxRepos = Math.min(
    options?.maxRepos ?? DEFAULT_WORKSPACE_MAX_REPOS,
    MAX_WORKSPACE_MAX_REPOS,
  );

  if (mode === 'auto') {
    // Check if this looks like a workspace
    if (!looksLikeWorkspace(repoRoot)) {
      return {
        mode: 'auto',
        repositories: [{ root: repoRoot, name: basename(repoRoot) }],
        bounded: false,
      };
    }
  }

  // Discover sub-repositories
  const repos: Array<{ root: string; name: string }> = [];
  let bounded = false;
  let boundReason: string | undefined;

  findRepos(repoRoot, 0, maxDepth, maxRepos, repos);

  if (repos.length >= maxRepos) {
    bounded = true;
    boundReason = `Repository count bounded at ${maxRepos}`;
    repos.length = maxRepos; // Truncate
  }

  // If no sub-repos found, use the root itself
  if (repos.length === 0) {
    repos.push({ root: repoRoot, name: basename(repoRoot) });
  }

  return {
    mode,
    repositories: repos,
    bounded,
    boundReason,
  };
}

function looksLikeWorkspace(dir: string): boolean {
  // npm: package.json with "workspaces" field
  try {
    const pkgJsonPath = join(dir, 'package.json');
    const content = readFileSync(pkgJsonPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'workspaces' in (parsed as Record<string, unknown>)
    ) {
      return true;
    }
  } catch {
    // No package.json or invalid -- check for other indicators
  }

  // Cargo: Cargo.toml with [workspace] section
  try {
    const cargoPath = join(dir, 'Cargo.toml');
    const content = readFileSync(cargoPath, 'utf-8');
    if (/^\[workspace\]/m.test(content)) {
      return true;
    }
  } catch {
    // No Cargo.toml or unreadable -- skip
  }

  // Go: go.work file existence
  try {
    if (existsSync(join(dir, 'go.work'))) {
      return true;
    }
  } catch {
    // Unreadable -- skip
  }

  // Python: pyproject.toml with workspace markers
  try {
    const pyprojectPath = join(dir, 'pyproject.toml');
    const content = readFileSync(pyprojectPath, 'utf-8');
    if (
      /^\[tool\.hatch\.envs\]/m.test(content) ||
      /^\[tool\.poetry\.packages\]/m.test(content) ||
      /^\[tool\.setuptools\.packages\.find\]/m.test(content)
    ) {
      return true;
    }
  } catch {
    // No pyproject.toml or unreadable -- skip
  }

  // npm fallback: multiple package.json in immediate subdirectories
  try {
    const entries = readdirSync(dir);
    let packageJsonCount = 0;
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const entryPath = join(dir, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory()) {
          const subEntries = readdirSync(entryPath);
          if (subEntries.includes('package.json')) {
            packageJsonCount++;
          }
        }
      } catch {
        continue;
      }
    }
    return packageJsonCount >= 2;
  } catch {
    return false;
  }
}

function findRepos(
  dir: string,
  depth: number,
  maxDepth: number,
  maxRepos: number,
  repos: Array<{ root: string; name: string }>,
): void {
  if (depth > maxDepth || repos.length >= maxRepos) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  // Check if this directory is a repository root
  const markers = detectRootMarker(entries);
  const hasRootMarker = markers.some(
    (m) => m.kind === 'package' || m.kind === 'git' || m.kind === 'config',
  );

  if (hasRootMarker && depth > 0) {
    repos.push({ root: dir, name: basename(dir) });
    // Don't recurse into sub-repos
    return;
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
    if (repos.length >= maxRepos) return;

    const entryPath = join(dir, entry);
    try {
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        findRepos(entryPath, depth + 1, maxDepth, maxRepos, repos);
      }
    } catch {
      continue;
    }
  }
}
