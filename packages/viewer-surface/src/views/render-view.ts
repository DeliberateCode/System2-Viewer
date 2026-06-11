/**
 * Main renderView orchestrator: dispatches to per-kind renderers.
 */

import type { DerivedView, ViewLine, ViewKind } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import { trivialLine, evidenceLine, hypothesisLine } from './line-builders.js';
import {
  renderDoctor,
  renderStatus,
  renderInit,
  renderMcpConfig,
  renderIndex,
  renderOverview,
  renderEntrypoints,
  renderTrace,
  renderBlast,
  renderSubsystem,
  renderResolve,
  renderClaims,
  renderUncertainties,
  renderVerify,
  renderHistory,
  renderCompare,
  renderInvariants,
  renderFeedback,
  renderGeneric,
} from './renderers.js';

/**
 * Renders a ResultEnvelope into a DerivedView for a given view kind.
 *
 * Each operation gets a dedicated rendering path that extracts meaningful
 * lines from the structured data. The CLI adds ZERO model semantics --
 * it only formats what the operation returned.
 */
export function renderView(
  kind: ViewKind,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): DerivedView {
  const op = envelope.query.op;
  const rev = envelope.modelRevision;
  const data = envelope.data as Record<string, unknown>;
  const lines: ViewLine[] = [];

  switch (kind) {
    case 'doctor':
      renderDoctor(lines, data);
      break;
    case 'status':
      renderStatus(lines, data);
      break;
    case 'init':
      renderInit(lines, data);
      break;
    case 'mcp-config':
      renderMcpConfig(lines, data);
      break;
    case 'index':
      renderIndex(lines, data);
      break;
    case 'overview':
      renderOverview(lines, data, envelope, verbose);
      break;
    case 'entrypoints':
      renderEntrypoints(lines, data, envelope, verbose);
      break;
    case 'trace':
      renderTrace(lines, data, envelope, verbose);
      break;
    case 'blast':
      renderBlast(lines, data, envelope, verbose);
      break;
    case 'subsystem':
      renderSubsystem(lines, data, envelope, verbose);
      break;
    case 'resolve':
      renderResolve(lines, data);
      break;
    case 'claims':
      renderClaims(lines, data, envelope, verbose);
      break;
    case 'uncertainties':
      renderUncertainties(lines, data, envelope, verbose);
      break;
    case 'verify':
      renderVerify(lines, data, envelope, verbose);
      break;
    case 'history':
      renderHistory(lines, data);
      break;
    case 'compare':
      renderCompare(lines, data);
      break;
    case 'invariants':
      renderInvariants(lines, data, envelope, verbose);
      break;
    case 'feedback':
      renderFeedback(lines, data);
      break;
    default:
      renderGeneric(lines, data);
      break;
  }

  // Append evidence trailers in verbose mode
  if (verbose && envelope.evidence.length > 0) {
    lines.push(trivialLine(''));
    lines.push(trivialLine('--- Evidence ---'));
    for (const ev of envelope.evidence) {
      lines.push(evidenceLine(
        `${ev.kind} [${ev.extractor}] ${ev.path ?? '(no path)'} @ ${ev.revision}`,
        ev.evidenceId,
      ));
    }
  }

  // Append uncertainties in verbose mode
  if (verbose && envelope.uncertainties.length > 0) {
    lines.push(trivialLine(''));
    lines.push(trivialLine('--- Uncertainties ---'));
    for (const u of envelope.uncertainties) {
      lines.push(hypothesisLine(`[${u.severity}] ${u.description}`));
    }
  }

  return { kind, op, modelRevision: rev, lines };
}
