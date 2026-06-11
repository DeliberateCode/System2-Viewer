import { basename } from 'node:path';

/** A candidate rename pairing an old and new path with a confidence score. */
export interface RenameCandidate {
  oldPath: string;
  newPath: string;
  confidence: number;
}

/**
 * Computes the normalized Levenshtein distance between two strings.
 * Returns a value in [0, 1] where 0 means identical and 1 means completely different.
 */
export function pathSimilarity(a: string, b: string): number {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return 1;
  if (lenB === 0) return 1;

  // Standard DP Levenshtein with single-row optimization
  let prev = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);

  for (let j = 0; j <= lenB; j++) prev[j] = j;

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lenB] / Math.max(lenA, lenB);
}

/**
 * Detects likely renames by matching removed files to added files
 * using content hashes. When a removed file's hash matches exactly
 * one added file, it is a high-confidence rename. When multiple
 * added files share the same hash, basename similarity breaks ties.
 *
 * Heuristics:
 *   1. Exact hash match with a single candidate -> confidence 1.0 (definite rename).
 *   2. Exact hash match with multiple candidates -> pick the one whose
 *      basename is most similar (lowest normalized Levenshtein distance).
 *      Confidence is max(similarityThreshold, 1.0 - distance).
 *   3. Candidates whose tiebreaker confidence would fall below
 *      `similarityThreshold` are still emitted at the threshold floor,
 *      since the content hash already guarantees identical file contents.
 *
 * @param removed   Relative paths of files no longer present
 * @param added     Relative paths of newly discovered files
 * @param fileHashes  Map from relative path to content hash (must cover both removed and added)
 * @param similarityThreshold  Minimum confidence for tiebreaker matches (default 0.5, range [0,1])
 */
export function detectRenames(
  removed: string[],
  added: string[],
  fileHashes: Map<string, string>,
  similarityThreshold = 0.5,
): RenameCandidate[] {
  if (removed.length === 0 || added.length === 0) return [];

  // Build reverse index: hash -> list of added paths with that hash
  const addedByHash = new Map<string, string[]>();
  for (const path of added) {
    const hash = fileHashes.get(path);
    if (!hash) continue;
    const list = addedByHash.get(hash);
    if (list) {
      list.push(path);
    } else {
      addedByHash.set(hash, [path]);
    }
  }

  const candidates: RenameCandidate[] = [];
  const claimedAdded = new Set<string>();

  for (const oldPath of removed) {
    const hash = fileHashes.get(oldPath);
    if (!hash) continue;

    const matches = addedByHash.get(hash);
    if (!matches || matches.length === 0) continue;

    // Filter out already-claimed additions
    const available = matches.filter(p => !claimedAdded.has(p));
    if (available.length === 0) continue;

    if (available.length === 1) {
      // Exact unique match: high confidence
      const newPath = available[0];
      claimedAdded.add(newPath);
      candidates.push({ oldPath, newPath, confidence: 1.0 });
    } else {
      // Multiple matches: use basename similarity as tiebreaker
      const oldBase = basename(oldPath);
      let best: string | undefined;
      let bestScore = Infinity;
      for (const p of available) {
        const score = pathSimilarity(oldBase, basename(p));
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (best !== undefined) {
        claimedAdded.add(best);
        // Confidence scaled by how similar the basenames are,
        // floored at the caller-provided similarity threshold.
        const confidence = Math.max(similarityThreshold, 1.0 - bestScore);
        candidates.push({ oldPath, newPath: best, confidence });
      }
    }
  }

  return candidates;
}
