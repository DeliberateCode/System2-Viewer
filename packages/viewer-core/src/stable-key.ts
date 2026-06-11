import type { NodeKind } from './types.js';

/**
 * Produces a deterministic, stable string key for a node.
 * The key is composed of kind, repositoryId, and any number of path segments,
 * joined by '::'.
 */
export function stableKey(
  kind: NodeKind,
  repositoryId: string,
  ...segments: string[]
): string {
  return [kind, repositoryId, ...segments].join('::');
}
