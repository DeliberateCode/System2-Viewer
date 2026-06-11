/**
 * Write transaction adapter.
 *
 * Wraps SnapshotTxn for verify/feedback consumers, providing a
 * narrower structural interface that satisfies both VerificationWriteTxn
 * and FeedbackWriteTxn from their respective packages.
 */

import type { SnapshotTxn, EvidenceRow, ClaimRow, VerificationHistoryRow } from '@system2-viewer/viewer-store';
import type { VerificationWriteTxn } from '@system2-viewer/viewer-verify';
import type { FeedbackWriteTxn } from './types.js';

/**
 * Adapts a real SnapshotTxn to satisfy both VerificationWriteTxn and
 * FeedbackWriteTxn structural interfaces.
 *
 * All writes go through the same underlying SnapshotTxn. Abort on any
 * failure ensures no partial state is persisted.
 */
export class WriteTxnAdapter implements VerificationWriteTxn, FeedbackWriteTxn {
  private readonly txn: SnapshotTxn;
  private committed = false;

  constructor(txn: SnapshotTxn) {
    this.txn = txn;
  }

  appendEvidence(row: Record<string, unknown>): void {
    this.txn.appendEvidence(row as unknown as EvidenceRow);
  }

  versionClaim(row: Record<string, unknown>): void {
    this.txn.versionClaim(row as unknown as ClaimRow);
  }

  appendVerificationHistory(row: {
    id: string;
    claimId: string;
    recipesJson: string;
    priorConfidence: string | null;
    newConfidence: string | null;
    priorFreshness: string | null;
    newFreshness: string | null;
    priorStatus: string | null;
    newStatus: string | null;
    unresolvedReason: string | null;
    ranAt: string;
  }): void {
    this.txn.appendVerificationHistory(row as VerificationHistoryRow);
  }

  closeInterval(id: string, revision: string): void {
    this.txn.closeInterval(id, revision);
  }

  commit(): void {
    if (!this.committed) {
      this.committed = true;
      this.txn.commit();
    }
  }

  abort(): void {
    if (!this.committed) {
      this.committed = true;
      this.txn.abort();
    }
  }
}
