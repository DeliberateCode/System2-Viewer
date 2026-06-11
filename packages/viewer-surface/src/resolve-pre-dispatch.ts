/**
 * Pre-dispatch reference resolution for MCP tools.
 *
 * For applicable tools, resolves a user-facing reference (path, symbol,
 * claim prefix, subsystem label, etc.) to a stored id BEFORE dispatching
 * the underlying operation.
 *
 * Resolution outcomes:
 *   - resolved   -> continue with the stored id
 *   - ambiguous  -> return the resolve result envelope; dispatch NOTHING
 *   - not_found  -> return the resolve result envelope; dispatch NOTHING
 *   - skipped    -> pass through unchanged (tool not applicable or arg not a string)
 */

import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import type { ResolveResult, ReferenceKind } from './types.js';

/** The resolve function signature provided by the engine. */
export type ResolveRefFn = (input: {
  input: string;
  hint?: ReferenceKind;
}) => ResultEnvelope<ResolveResult>;

/** Configuration for which arg to resolve and what hint to use. */
export interface PreDispatchConfig {
  argName: string;
  hint: ReferenceKind;
}

/** Outcome of pre-dispatch resolution. */
export type PreDispatchOutcome =
  | { status: 'resolved'; args: Record<string, unknown> }
  | { status: 'early-return'; envelope: ResultEnvelope<ResolveResult> }
  | { status: 'skipped'; args: Record<string, unknown> };

/**
 * Resolves a user-facing reference for applicable tools.
 *
 * @param raw         The raw tool args from MCP
 * @param resolveRef  The engine's resolveRef function
 * @param config      Which arg to resolve and what reference kind hint
 * @returns           An outcome: resolved (continue), early-return (stop), or skipped
 */
export function resolvePreDispatch(
  raw: Record<string, unknown>,
  resolveRef: ResolveRefFn,
  config: PreDispatchConfig,
): PreDispatchOutcome {
  const value = raw[config.argName];

  // Not a string -> skip resolution, pass through unchanged
  if (typeof value !== 'string' || value === '') {
    return { status: 'skipped', args: raw };
  }

  const envelope = resolveRef({ input: value, hint: config.hint });
  const result = envelope.data;

  if (result.status === 'resolved') {
    // Replace the arg with the resolved stored id
    const args = { ...raw, [config.argName]: result.id };
    return { status: 'resolved', args };
  }

  // ambiguous or not_found -> return the resolve result envelope, dispatch nothing
  return { status: 'early-return', envelope };
}
