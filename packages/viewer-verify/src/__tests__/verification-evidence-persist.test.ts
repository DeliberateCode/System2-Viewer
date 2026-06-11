/**
 * Tests that VerificationEngine.verifyClaim persists synthetic evidence rows.
 *
 * Validates that:
 *   - appendEvidence is called for each piece of recipe evidence
 *   - Evidence IDs match those referenced in the successor claim's supportingEvidenceIdsJson
 *   - Evidence rows contain correct fields (kind, epistemic, extractor, revision)
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { VerificationEngine } from '../verification-engine.js';
import type {
  VerificationModelHandle,
  VerificationWriteTxn,
  VerificationClaimRow,
} from '../types.js';

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
    repositoryId: 'repo::abc123::myrepo',
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

function mkWriteTxn(): VerificationWriteTxn & {
  appendEvidence: ReturnType<typeof vi.fn>;
  versionClaim: ReturnType<typeof vi.fn>;
} {
  return {
    appendEvidence: vi.fn(),
    appendVerificationHistory: vi.fn(),
    versionClaim: vi.fn(),
    closeInterval: vi.fn(),
    commit: vi.fn(),
    abort: vi.fn(),
  };
}

describe('VerificationEngine evidence persistence', () => {
  it('calls appendEvidence for each recipe evidence item', () => {
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

    engine.verifyClaim('claim-1', handle, txn, { revision: 'rev-42' });

    // The symbol_exists_check recipe produces evidence when the symbol is found
    expect(txn.appendEvidence).toHaveBeenCalled();

    // Each call should have the correct structure
    const calls = txn.appendEvidence.mock.calls;
    for (const [row] of calls) {
      expect(row.id).toMatch(/^verify-claim-1-/);
      expect(row.epistemic).toBe('static');
      expect(row.extractor).toBe('verification-engine');
      expect(row.revision).toBe('rev-42');
      expect(row.repositoryId).toBe('repo::abc123::myrepo');
      expect(row.derivationLocality).toBe('local');
      expect(typeof row.kind).toBe('string');
      expect(typeof row.createdAt).toBe('string');
    }
  });

  it('evidence IDs in successor claim match persisted evidence rows', () => {
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

    engine.verifyClaim('claim-1', handle, txn, { revision: 'rev-42' });

    // Collect evidence IDs that were persisted
    const persistedEvidenceIds = txn.appendEvidence.mock.calls.map(
      (call) => (call[0] as { id: string }).id,
    );

    // The successor claim's supportingEvidenceIdsJson should reference these IDs
    expect(txn.versionClaim).toHaveBeenCalledTimes(1);
    const successorClaim = txn.versionClaim.mock.calls[0]![0] as {
      supportingEvidenceIdsJson: string;
    };
    const supportingIds: string[] = JSON.parse(
      successorClaim.supportingEvidenceIdsJson,
    );

    // All persisted evidence IDs should appear in the successor claim
    for (const evId of persistedEvidenceIds) {
      expect(supportingIds).toContain(evId);
    }
  });

  it('persists contradiction evidence rows for failed recipes that produce evidence', () => {
    const engine = new VerificationEngine();
    // Use a source_span_check recipe that will fail (out-of-range span)
    // so it produces evidence with passed=false
    const claimRow = mkClaimRow({
      verificationRecipesJson: JSON.stringify([
        {
          recipeType: 'source_span_check',
          description: 'Check span exists',
          sourceSpan: { path: 'src/foo.ts', startLine: 1, endLine: 999 },
        },
      ]),
    });

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
      readFileContent: vi.fn().mockReturnValue('line1\nline2\n'),
    });
    const txn = mkWriteTxn();

    engine.verifyClaim('claim-1', handle, txn, { revision: 'rev-42' });

    // The recipe should fail (span out of range) and produce evidence
    // Both supporting (verify-*) and contradiction (contradict-*) rows should be persisted
    const allEvidenceCalls = txn.appendEvidence.mock.calls;
    const contradictRows = allEvidenceCalls
      .map((call) => call[0] as { id: string; kind: string })
      .filter((row) => row.id.startsWith('contradict-'));

    expect(contradictRows.length).toBeGreaterThan(0);
    for (const row of contradictRows) {
      expect(row.id).toMatch(/^contradict-claim-1-/);
    }

    // The successor claim's contradictingEvidenceIdsJson should reference persisted IDs
    expect(txn.versionClaim).toHaveBeenCalledTimes(1);
    const successor = txn.versionClaim.mock.calls[0]![0] as {
      contradictingEvidenceIdsJson: string | null;
    };
    expect(successor.contradictingEvidenceIdsJson).not.toBeNull();
    const contradictIds: string[] = JSON.parse(
      successor.contradictingEvidenceIdsJson!,
    );
    const persistedContradictIds = contradictRows.map((r) => r.id);
    for (const id of contradictIds) {
      expect(persistedContradictIds).toContain(id);
    }
  });

  it('does not call appendEvidence when claim has no recipes', () => {
    const engine = new VerificationEngine();
    const claimRow = mkClaimRow({ verificationRecipesJson: '[]' });

    const handle = mkModelHandle({
      getClaim: vi.fn().mockReturnValue(claimRow),
    });
    const txn = mkWriteTxn();

    engine.verifyClaim('claim-1', handle, txn);

    expect(txn.appendEvidence).not.toHaveBeenCalled();
  });

  it('does not call appendEvidence when claim is not found', () => {
    const engine = new VerificationEngine();
    const handle = mkModelHandle(); // getClaim returns null
    const txn = mkWriteTxn();

    engine.verifyClaim('nonexistent', handle, txn);

    expect(txn.appendEvidence).not.toHaveBeenCalled();
  });
});
