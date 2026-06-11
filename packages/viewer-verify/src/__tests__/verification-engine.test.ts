/**
 * Tests for viewer-verify VerificationEngine.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { VerificationEngine } from '../verification-engine.js';
import type {
  VerificationModelHandle,
  VerificationWriteTxn,
  VerificationClaimRow,
} from '../types.js';
import type { NeighborEdge } from '@system2-viewer/viewer-retrieval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkClaimRow(
  overrides: Partial<VerificationClaimRow> = {},
): VerificationClaimRow {
  return {
    id: 'claim-1',
    claimType: 'file-defines-symbol',
    statement: 'File X defines symbol Y',
    status: 'hypothesis',
    confidenceBand: 'low',
    freshnessBand: 'fresh',
    validFromRevision: 'rev-1',
    validToRevision: null,
    scopeJson: '{}',
    supportingEvidenceIds: ['ev-1'],
    repositoryId: 'repo-1',
    verificationRecipesJson: JSON.stringify([
      {
        recipeType: 'symbol_exists_check',
        description: 'Check symbol Y exists',
        symbolName: 'node-symbol-Y',
      },
    ]),
    surfaced: 1,
    ...overrides,
  };
}

function mkModelHandle(
  overrides: Partial<VerificationModelHandle> = {},
): VerificationModelHandle {
  return {
    getClaim: vi.fn().mockReturnValue(null),
    getNode: vi.fn().mockReturnValue(null),
    neighbors: vi.fn().mockReturnValue([]),
    readFileContent: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function mkWriteTxn(
  overrides: Partial<VerificationWriteTxn> = {},
): VerificationWriteTxn {
  return {
    appendEvidence: vi.fn(),
    appendVerificationHistory: vi.fn(),
    versionClaim: vi.fn(),
    closeInterval: vi.fn(),
    commit: vi.fn(),
    abort: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// VerificationEngine.verifyClaim
// ---------------------------------------------------------------------------

describe('VerificationEngine.verifyClaim', () => {
  it('returns unresolved result when claim is not found', () => {
    const engine = new VerificationEngine();
    const handle = mkModelHandle();
    const txn = mkWriteTxn();

    const result = engine.verifyClaim('nonexistent', handle, txn);

    expect(result.claimId).toBe('nonexistent');
    expect(result.unresolvedReason).toContain('not found');
    expect(result.priorStatus).toBe('hypothesis');
    expect(result.newStatus).toBe('hypothesis');
  });

  it('runs recipes and produces a verification result for found claim', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow();

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      getNode: vi.fn().mockImplementation((id: string) => {
        if (id === 'node-symbol-Y') {
          return { id: 'node-symbol-Y', kind: 'symbol', displayName: 'Y' };
        }
        return null;
      }),
    });
    const txn = mkWriteTxn();

    const result = engine.verifyClaim('claim-1', handle, txn);

    expect(result.claimId).toBe('claim-1');
    expect(result.priorStatus).toBe('hypothesis');
    // The recipe found the symbol, so the claim should be confirmed
    // (non-LLM evidence produced by recipe)
    expect(result.recipeOutcomes.length).toBeGreaterThan(0);
    expect(result.recipeOutcomes[0]!.passed).toBe(true);
    expect(result.unresolvedReason).toBeUndefined();
  });

  it('calls write transaction methods on successful verification', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow();

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      getNode: vi.fn().mockReturnValue({ id: 'node-symbol-Y', kind: 'symbol' }),
    });
    const txn = mkWriteTxn();

    engine.verifyClaim('claim-1', handle, txn);

    expect(txn.appendVerificationHistory).toHaveBeenCalledTimes(1);
    expect(txn.closeInterval).toHaveBeenCalledTimes(1);
    expect(txn.versionClaim).toHaveBeenCalledTimes(1);
  });

  it('aborts transaction and returns prior state on write failure', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow();

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      getNode: vi.fn().mockReturnValue({ id: 'node-symbol-Y', kind: 'symbol' }),
    });
    const txn = mkWriteTxn({
      appendVerificationHistory: vi.fn().mockImplementation(() => {
        throw new Error('DB write failed');
      }),
    });

    const result = engine.verifyClaim('claim-1', handle, txn);

    expect(txn.abort).toHaveBeenCalledTimes(1);
    expect(result.unresolvedReason).toBe('Write transaction failed');
    expect(result.newStatus).toBe(result.priorStatus);
    expect(result.newConfidence).toBe(result.priorConfidence);
  });

  it('handles claims with no recipes gracefully', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow({ verificationRecipesJson: '[]' });

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
    });
    const txn = mkWriteTxn();

    const result = engine.verifyClaim('claim-1', handle, txn);

    expect(result.recipeOutcomes).toEqual([]);
    expect(result.claimId).toBe('claim-1');
  });

  it('handles malformed recipe JSON gracefully', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow({ verificationRecipesJson: 'NOT JSON' });

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
    });
    const txn = mkWriteTxn();

    const result = engine.verifyClaim('claim-1', handle, txn);

    // Should not throw, should produce empty recipe outcomes
    expect(result.recipeOutcomes).toEqual([]);
  });

  it('writes actual revision ID instead of literal "latest"', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow();
    const actualRevision = 'rev::1717503600000::abc123';

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      getNode: vi.fn().mockReturnValue({ id: 'node-symbol-Y', kind: 'symbol' }),
    });
    const txn = mkWriteTxn();

    engine.verifyClaim('claim-1', handle, txn, {
      strategy: 'all',
      revision: actualRevision,
    });

    // closeInterval should use the real revision, not 'latest'
    expect(txn.closeInterval).toHaveBeenCalledWith('claim-1', actualRevision);

    // versionClaim successor should use the real revision for validFromRevision
    const versionClaimCall = (txn.versionClaim as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(versionClaimCall.validFromRevision).toBe(actualRevision);
    expect(versionClaimCall.validFromRevision).not.toBe('latest');
  });

  it('uses cheapest strategy to filter to MVP recipes', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow({
      verificationRecipesJson: JSON.stringify([
        {
          recipeType: 'symbol_exists_check',
          description: 'Check symbol',
          symbolName: 'sym-1',
        },
        {
          recipeType: 'custom_expensive_check',
          description: 'Expensive',
        },
      ]),
    });

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      getNode: vi.fn().mockReturnValue({ id: 'sym-1', kind: 'symbol' }),
    });
    const txn = mkWriteTxn();

    const result = engine.verifyClaim('claim-1', handle, txn, {
      strategy: 'cheapest',
    });

    // Should only run the MVP recipe (symbol_exists_check), not custom_expensive_check
    const recipeTypes = result.recipeOutcomes.map((o) => o.recipeType);
    expect(recipeTypes).toContain('symbol_exists_check');
    expect(recipeTypes).not.toContain('custom_expensive_check');
  });
});
