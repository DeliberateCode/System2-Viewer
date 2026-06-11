import picomatch from 'picomatch';
import type { ViewerConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExcludeMatcher {
  isExcluded(path: string): boolean;
}

// ---------------------------------------------------------------------------
// Built-in secret patterns (NON-NEGOTIABLE)
// ---------------------------------------------------------------------------

export const DEFAULT_SECRET_PATTERNS: string[] = [
  '.env',
  '.env.*',
  '*.key',
  '*.pem',
  '*.p12',
  '*.pfx',
  'credentials.*',
  'secret*',
  '.npmrc',
  '.pypirc',
  '*.keystore',
  'id_rsa',
  'id_rsa.*',
  'id_ed25519',
  'id_ed25519.*',
  '*.secrets',
];

// ---------------------------------------------------------------------------
// Shared picomatch options
// ---------------------------------------------------------------------------

const PICO_OPTS: picomatch.PicomatchOptions = { dot: true, windows: true };

// ---------------------------------------------------------------------------
// Pattern compiler (internal)
// ---------------------------------------------------------------------------

type MatcherFn = (test: string) => boolean;

interface CompiledPattern {
  matcher: MatcherFn;
  negated: boolean;
  anchored: boolean;
  directoryOnly: boolean;
  original: string;
}

function compilePattern(raw: string): CompiledPattern | null {
  let pattern = raw.trim();
  if (pattern === '' || pattern.startsWith('#')) return null;

  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);

  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);

  const anchored = pattern.includes('/');
  if (pattern.startsWith('/')) pattern = pattern.slice(1);

  // For non-anchored patterns, match anywhere in the path
  const globPattern = anchored ? pattern : '**/' + pattern;

  const matcher = picomatch(globPattern, PICO_OPTS);

  return { matcher, negated, anchored, directoryOnly, original: raw };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an exclude matcher from config excludes, .gitignore patterns, and
 * built-in secret patterns.
 *
 * Merging order: .gitignore patterns + config excludes + secret patterns.
 * Secret patterns are NON-NEGOTIABLE: .gitignore negation cannot re-include
 * files matching secret patterns.
 */
export function buildExcludeSet(
  config: ViewerConfig,
  gitignorePatterns: string[],
): ExcludeMatcher {
  // Compile secret patterns (always exclude, cannot be negated)
  const secretMatchers: MatcherFn[] = [];
  for (const pat of DEFAULT_SECRET_PATTERNS) {
    const compiled = compilePattern(pat);
    if (compiled) secretMatchers.push(compiled.matcher);
  }

  // Compile gitignore patterns (support negation)
  const gitignoreCompiled: CompiledPattern[] = [];
  for (const pat of gitignorePatterns) {
    const compiled = compilePattern(pat);
    if (compiled) gitignoreCompiled.push(compiled);
  }

  // Compile config exclude patterns (no negation support -- they are additive)
  const configExcludeMatchers: MatcherFn[] = [];
  if (config.repository.exclude) {
    for (const pat of config.repository.exclude) {
      const compiled = compilePattern(pat);
      if (compiled && !compiled.negated) configExcludeMatchers.push(compiled.matcher);
    }
  }

  function matchesSecret(filePath: string): boolean {
    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const base = filePath.split('/').pop() ?? filePath;
    for (const matcher of secretMatchers) {
      if (matcher(filePath) || matcher(base)) return true;
    }
    return false;
  }

  function matchesGitignore(filePath: string): boolean {
    // Process patterns in order; last matching pattern wins
    let excluded = false;
    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const base = filePath.split('/').pop() ?? filePath;
    for (const compiled of gitignoreCompiled) {
      const matches = compiled.matcher(filePath) || (!compiled.anchored && compiled.matcher(base));
      if (matches) {
        excluded = !compiled.negated;
      }
    }
    return excluded;
  }

  function matchesConfigExclude(filePath: string): boolean {
    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const base = filePath.split('/').pop() ?? filePath;
    for (const matcher of configExcludeMatchers) {
      if (matcher(filePath) || matcher(base)) return true;
    }
    return false;
  }

  return {
    isExcluded(filePath: string): boolean {
      // Secret patterns are NON-NEGOTIABLE -- check first, always exclude
      if (matchesSecret(filePath)) return true;

      // Config excludes are additive (non-negotiable relative to gitignore negation)
      if (matchesConfigExclude(filePath)) return true;

      // Gitignore patterns (with negation support, but negation cannot
      // override secret or config patterns)
      if (matchesGitignore(filePath)) return true;

      return false;
    },
  };
}
