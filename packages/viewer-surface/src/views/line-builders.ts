/**
 * Line builder helpers for constructing ViewLine instances with typed backing.
 */

import type { ViewLine } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

export function trivialLine(text: string): ViewLine {
  return { text, backing: { type: 'trivial' } };
}

export function claimLine(text: string, claimId: string): ViewLine {
  return { text, backing: { type: 'claim', claimId } };
}

export function evidenceLine(text: string, evidenceId: string): ViewLine {
  return { text, backing: { type: 'evidence', evidenceId } };
}

export function hypothesisLine(text: string): ViewLine {
  return { text, backing: { type: 'hypothesis' } };
}

export function appendPartialityNotice(
  lines: ViewLine[],
  envelope: ResultEnvelope<unknown>,
): void {
  if (envelope.partiality) {
    lines.push(hypothesisLine(
      `Partiality: result may be incomplete (${envelope.partiality.scopes.length} partial scope(s))`,
    ));
  }
}
