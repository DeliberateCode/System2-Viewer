/**
 * ReferenceResolver: resolves user-facing references to stored model entities.
 *
 * Strategies (tried in order):
 *   1. Raw id - exact match on node/claim id
 *   2. Path - file path exists as a node in the model
 *   3. Symbol - FTS search on symbol names
 *   4. Claim prefix - id prefix match on claims
 *   5. Subsystem label - match subsystem display_name
 *   6. Intent - FTS search fallback
 *
 * Returns: resolved (single match) | ambiguous (multiple) | not_found
 *
 * Side-effect-free: dispatches NO downstream operations, writes nothing.
 */

import type { ReferenceKind, ResolveResult } from './types.js';

/** Structural read handle for the resolver (satisfied by the real ReadHandle or UnionHandle). */
export interface ResolverReadHandle {
  getNode(id: string): Record<string, unknown> | null;
  getClaim(id: string): { id: string; claimType: string; statement: string } | null;
  ftsSearch(q: string): Array<{ objectId: string; objectType: string; text: string; path: string | null; rank: number }>;
  claimsByPrefix?(prefix: string, limit?: number): Array<{ id: string; claimType: string; statement: string }>;
}

/** Resolved node shape. */
interface ResolvedNode {
  id: string;
  displayName: string;
  kind: ReferenceKind;
}

/**
 * ReferenceResolver resolves user-facing text references to stored model entities.
 *
 * Completely side-effect-free: all strategies are read-only queries against the handle.
 */
export class ReferenceResolver {
  private readonly handle: ResolverReadHandle;

  constructor(handle: ResolverReadHandle) {
    this.handle = handle;
  }

  /**
   * Resolve an input string to a model entity.
   *
   * @param input - User-provided reference text
   * @param hint - Optional hint about the expected kind of reference
   */
  resolve(input: string, hint?: ReferenceKind): ResolveResult {
    if (!input || input.trim() === '') {
      return { status: 'not_found', input };
    }

    const trimmed = input.trim();

    // Strategy 1: Raw id (exact node or claim match)
    if (!hint || hint === 'raw-id') {
      const result = this.tryRawId(trimmed);
      if (result) return result;
    }

    // Strategy 2: Path (file node by path)
    if (!hint || hint === 'path') {
      const result = this.tryPath(trimmed);
      if (result) return result;
    }

    // Strategy 3: Claim prefix match
    if (!hint || hint === 'claim') {
      const result = this.tryClaimPrefix(trimmed);
      if (result) return result;
    }

    // Strategy 4: Symbol (FTS search on symbol names)
    if (!hint || hint === 'symbol') {
      const result = this.trySymbol(trimmed);
      if (result) return result;
    }

    // Strategy 5: Subsystem label
    if (!hint || hint === 'subsystem') {
      // When hint is 'subsystem', also try raw ID lookup since the input
      // may be the subsystem node ID directly
      if (hint === 'subsystem') {
        const node = this.handle.getNode(trimmed);
        if (node && node['kind'] === 'subsystem') {
          return {
            status: 'resolved',
            id: trimmed,
            kind: 'subsystem',
            displayName: (node['display_name'] as string) ?? trimmed,
          };
        }
      }
      const result = this.trySubsystem(trimmed);
      if (result) return result;
    }

    // Strategy 6: Intent (broad FTS search)
    if (!hint || hint === 'intent') {
      const result = this.tryIntent(trimmed);
      if (result) return result;
    }

    return { status: 'not_found', input };
  }

  private tryRawId(input: string): ResolveResult | null {
    // Try as a node id
    const node = this.handle.getNode(input);
    if (node) {
      return {
        status: 'resolved',
        id: input,
        kind: 'raw-id',
        displayName: (node['display_name'] as string) ?? (node['path'] as string) ?? input,
      };
    }

    // Try as a claim id
    const claim = this.handle.getClaim(input);
    if (claim) {
      return {
        status: 'resolved',
        id: input,
        kind: 'claim',
        displayName: claim.statement.slice(0, 80),
      };
    }

    return null;
  }

  private tryPath(input: string): ResolveResult | null {
    // Search for a node with this path
    const hits = this.handle.ftsSearch(input);
    const pathMatches = hits.filter(
      h => h.objectType === 'file' && h.path === input,
    );

    if (pathMatches.length === 1) {
      return {
        status: 'resolved',
        id: pathMatches[0]!.objectId,
        kind: 'path',
        displayName: input,
      };
    }

    if (pathMatches.length > 1) {
      return {
        status: 'ambiguous',
        candidates: pathMatches.map(h => ({
          id: h.objectId,
          displayName: h.path ?? h.objectId,
        })),
      };
    }

    return null;
  }

  private tryClaimPrefix(input: string): ResolveResult | null {
    // Try exact claim id first
    const exact = this.handle.getClaim(input);
    if (exact) {
      return {
        status: 'resolved',
        id: exact.id,
        kind: 'claim',
        displayName: exact.statement.slice(0, 80),
      };
    }

    // Try prefix match via direct claims table query (FTS does not index claims)
    if (this.handle.claimsByPrefix) {
      const matches = this.handle.claimsByPrefix(input, 10);

      if (matches.length === 1) {
        return {
          status: 'resolved',
          id: matches[0]!.id,
          kind: 'claim',
          displayName: matches[0]!.statement.slice(0, 80),
        };
      }

      if (matches.length > 1) {
        return {
          status: 'ambiguous',
          candidates: matches.map(m => ({
            id: m.id,
            displayName: m.statement.slice(0, 80),
          })),
        };
      }
    }

    return null;
  }

  private trySymbol(input: string): ResolveResult | null {
    const hits = this.handle.ftsSearch(input);
    const symbolHits = hits.filter(h => h.objectType === 'symbol');

    if (symbolHits.length === 0) return null;

    // Prefer exact text matches
    const exact = symbolHits.filter(
      h => h.text.toLowerCase() === input.toLowerCase(),
    );

    if (exact.length === 1) {
      return {
        status: 'resolved',
        id: exact[0]!.objectId,
        kind: 'symbol',
        displayName: exact[0]!.text,
      };
    }

    if (exact.length > 1) {
      return {
        status: 'ambiguous',
        candidates: exact.map(h => ({
          id: h.objectId,
          displayName: h.text,
        })),
      };
    }

    // Take top result
    if (symbolHits.length === 1) {
      return {
        status: 'resolved',
        id: symbolHits[0]!.objectId,
        kind: 'symbol',
        displayName: symbolHits[0]!.text,
      };
    }

    return {
      status: 'ambiguous',
      candidates: symbolHits.slice(0, 10).map(h => ({
        id: h.objectId,
        displayName: h.text,
      })),
    };
  }

  private trySubsystem(input: string): ResolveResult | null {
    const hits = this.handle.ftsSearch(input);
    const subsystemHits = hits.filter(h => {
      if (h.objectType !== 'node' && h.objectType !== 'subsystem') return false;
      // Check if this node is a subsystem by looking it up
      const node = this.handle.getNode(h.objectId);
      return node !== null && node['kind'] === 'subsystem';
    });

    if (subsystemHits.length === 1) {
      return {
        status: 'resolved',
        id: subsystemHits[0]!.objectId,
        kind: 'subsystem',
        displayName: subsystemHits[0]!.text,
      };
    }

    if (subsystemHits.length > 1) {
      return {
        status: 'ambiguous',
        candidates: subsystemHits.map(h => ({
          id: h.objectId,
          displayName: h.text,
        })),
      };
    }

    return null;
  }

  private tryIntent(input: string): ResolveResult | null {
    const hits = this.handle.ftsSearch(input);
    if (hits.length === 0) return null;

    if (hits.length === 1) {
      return {
        status: 'resolved',
        id: hits[0]!.objectId,
        kind: 'intent',
        displayName: hits[0]!.text,
      };
    }

    return {
      status: 'ambiguous',
      candidates: hits.slice(0, 10).map(h => ({
        id: h.objectId,
        displayName: h.text,
      })),
    };
  }
}

