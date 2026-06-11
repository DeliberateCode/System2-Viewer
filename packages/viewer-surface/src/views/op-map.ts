/**
 * Maps operation names to ViewKind for routing to the correct renderer.
 */

import type { ViewKind } from '../types.js';

const OP_TO_VIEW_KIND: Record<string, ViewKind> = {
  doctor: 'doctor',
  status: 'status',
  init: 'init',
  initConfig: 'init',
  mcpConfig: 'mcp-config',
  index: 'index',
  getRepositoryOverview: 'overview',
  findEntrypoints: 'entrypoints',
  traceFlow: 'trace',
  estimateBlastRadius: 'blast',
  explainSubsystem: 'subsystem',
  resolveReference: 'resolve',
  resolveRef: 'resolve',
  listClaims: 'claims',
  listUncertainties: 'uncertainties',
  verifyClaim: 'verify',
  getClaimHistory: 'history',
  compareRevisions: 'compare',
  checkInvariants: 'invariants',
  confirmClaim: 'feedback',
  rejectClaim: 'feedback',
  annotateClaim: 'feedback',
};

/** Returns the ViewKind for a given operation name. */
export function viewKindForOp(op: string): ViewKind {
  return OP_TO_VIEW_KIND[op] ?? 'generic';
}
