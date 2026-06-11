import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Derives a stable, unique repository ID from the absolute path.
 *
 * Format: `repo::<hash12>::<basename>`
 *   - hash12: first 12 hex chars of SHA-256 of the resolved absolute path
 *   - basename: last path segment (or 'unknown' if empty)
 *
 * If a configName is provided (e.g., from viewer.config.json repository.name),
 * it is used as the suffix instead of the path basename for readability.
 */
export function deriveRepositoryId(repoRoot: string, configName?: string): string {
  const absPath = resolve(repoRoot);
  const hash = createHash('sha256').update(absPath).digest('hex').slice(0, 12);
  const suffix = configName || basename(absPath) || 'unknown';
  return `repo::${hash}::${suffix}`;
}
