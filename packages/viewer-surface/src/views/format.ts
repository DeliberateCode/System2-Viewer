/**
 * Formats a DerivedView into tagged output text.
 *
 * Every line carries exactly one tag:
 *   [claim:<id>]    [evidence:<id>]    [hypothesis]    [trivial]
 *
 * Output format:
 *   # <kind> :: <op> @ <modelRevision>
 *   [tag] line text
 */

import type { DerivedView, ViewLine } from '../types.js';

export function formatView(view: DerivedView): string {
  const header = `# ${view.kind} :: ${view.op} @ ${view.modelRevision}`;
  const taggedLines = view.lines.map(line => {
    const tag = lineTag(line);
    return `${tag} ${line.text}`;
  });
  return [header, ...taggedLines].join('\n');
}

function lineTag(line: ViewLine): string {
  switch (line.backing.type) {
    case 'evidence':
      return `[evidence:${line.backing.evidenceId}]`;
    case 'claim':
      return `[claim:${line.backing.claimId}]`;
    case 'hypothesis':
      return '[hypothesis]';
    case 'trivial':
      return '[trivial]';
  }
}
