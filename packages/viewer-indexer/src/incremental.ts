import { createHash } from 'node:crypto';

/** Result of comparing current file hashes against stored hashes. */
export interface IncrementalDiff {
  unchanged: string[];
  changed: string[];
  added: string[];
  removed: string[];
}

/** Stat fingerprint used for fast dirty checking without reading file content. */
export interface StatFingerprint {
  mtimeMs: number;
  size: number;
}

/** Returns the SHA-256 hex digest of the given content string. */
export function hashFileContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Compares current file hashes against stored hashes and classifies
 * each file as unchanged, changed, added, or removed.
 *
 * @param currentFiles  Map of relativePath -> sha256 hash for walked files
 * @param storedHashes  Map of relativePath -> sha256 hash from the store
 */
export function computeIncrementalDiff(
  currentFiles: Map<string, string>,
  storedHashes: Map<string, string>,
): IncrementalDiff {
  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];

  for (const [path, hash] of currentFiles) {
    const stored = storedHashes.get(path);
    if (stored === undefined) {
      added.push(path);
    } else if (stored === hash) {
      unchanged.push(path);
    } else {
      changed.push(path);
    }
  }

  const removed: string[] = [];
  for (const path of storedHashes.keys()) {
    if (!currentFiles.has(path)) {
      removed.push(path);
    }
  }

  return { unchanged, changed, added, removed };
}

/**
 * Fast stat-based diff that avoids reading file content during the walk phase.
 * Compares mtime+size against stored values. Files whose stat matches the
 * stored fingerprint are considered unchanged; all others are marked as
 * potentially changed and will be hash-verified during extraction.
 *
 * @param currentStats  Map of relativePath -> StatFingerprint from the walk
 * @param storedStats   Map of relativePath -> StatFingerprint|null from the store
 *                      (null fingerprint means the store has no stat for that file)
 * @param storedPaths   Set of all paths known in the store (for removed detection)
 */
export function computeStatDiff(
  currentStats: Map<string, StatFingerprint>,
  storedStats: Map<string, StatFingerprint | null>,
  storedPaths: Set<string>,
): IncrementalDiff {
  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];

  for (const [path, stat] of currentStats) {
    const stored = storedStats.get(path);
    if (stored === undefined) {
      added.push(path);
    } else if (stored === null) {
      // No stat stored (pre-migration data) -- treat as changed
      changed.push(path);
    } else if (stored.mtimeMs === stat.mtimeMs && stored.size === stat.size) {
      unchanged.push(path);
    } else {
      changed.push(path);
    }
  }

  const removed: string[] = [];
  for (const path of storedPaths) {
    if (!currentStats.has(path)) {
      removed.push(path);
    }
  }

  return { unchanged, changed, added, removed };
}
