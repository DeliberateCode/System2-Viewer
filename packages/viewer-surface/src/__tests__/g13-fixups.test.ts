/**
 * regression tests. *
 * CapabilityClass 'verify' on viewer.verifyClaim tool table entry
 * buildClaimPayload error envelope for nonexistent claim
 * renderHistory reads 'verificationHistory' field correctly
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { TOOL_TABLE } from '../tool-table.js';
import { CAPABILITY_CLASSES } from '../capability.js';
import { renderView, formatView } from '../cli-views.js';
import { createViewerEngine } from '../engine.js';
import { ModelStore } from '@system2-viewer/viewer-store';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'g13-fixups-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// CapabilityClass 'verify' on viewer.verifyClaim
// ---------------------------------------------------------------------------

describe('regression: verifyClaim capabilityClass', () => {
  it('viewer.verifyClaim has capabilityClass "verify" in the tool table', () => {
    const entry = TOOL_TABLE.find(t => t.name === 'viewer.verifyClaim');
    expect(entry).toBeDefined();
    expect(entry!.capabilityClass).toBe('verify');
  });

  it('CapabilityClass has exactly 4 members: read, feedback, verify, index', () => {
    expect(CAPABILITY_CLASSES).toHaveLength(4);
    expect(CAPABILITY_CLASSES).toContain('read');
    expect(CAPABILITY_CLASSES).toContain('feedback');
    expect(CAPABILITY_CLASSES).toContain('verify');
    expect(CAPABILITY_CLASSES).toContain('index');
  });

  it('CapabilityClass does not include source-write', () => {
    expect(CAPABILITY_CLASSES).not.toContain('source-write');
  });
});

// ---------------------------------------------------------------------------
// buildClaimPayload error envelope for nonexistent claim
// ---------------------------------------------------------------------------

describe('regression: buildClaimPayload error envelope', () => {
  it('returns an envelope with data: null and claim_not_found uncertainty for nonexistent claim', () => {
    const dataDir = makeTempDir();

    // Seed the database with a revision row so createViewerEngine finds
    // an existing model. We open a ModelStore first to create the schema,
    // insert a revision, then close before the engine opens its own connections.
    const store = ModelStore.open(dataDir);
    const txn = store.beginSnapshot('seed-rev');
    txn.upsertNode({
      id: 'seed-node',
      kind: 'file',
      stableKey: 'repo1:file:seed',
      displayName: 'seed',
      repositoryId: 'repo1',
      path: 'src/seed.ts',
      language: 'typescript',
      fileClass: 'source',
      provenanceMethod: 'indexer',
      extractor: 'tree-sitter',
      metadataJson: null,
      validFromRevision: 'seed-rev',
      validToRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    txn.commit();

    // Insert a revision row so latestRevision() finds it
    const db = new Database(join(dataDir, 'model.sqlite'));
    db.prepare(
      'INSERT OR IGNORE INTO revisions (id, repository_id, kind, indexed_at) VALUES (?, ?, ?, ?)',
    ).run('seed-rev', 'repo1', 'working_tree', new Date().toISOString());
    db.close();
    store.close();

    // Now create the engine -- it will see the seeded revision
    const engine = createViewerEngine({ dataDir });

    try {
      const result = engine.buildClaimPayload({ claimId: 'nonexistent-claim' });

      // (a) Result is an envelope (has the expected shape)
      expect(result).toBeDefined();
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('uncertainties');
      expect(result).toHaveProperty('suggestedNextCalls');
      expect(result).toHaveProperty('modelRevision');

      // (b) data is null
      expect(result.data).toBeNull();

      // (c) uncertainties contains item with kind 'claim_not_found'
      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      const claimNotFound = result.uncertainties.find(
        (u: { kind: string }) => u.kind === 'claim_not_found',
      );
      expect(claimNotFound).toBeDefined();

      // (d) suggestedNextCalls is non-empty
      expect(result.suggestedNextCalls.length).toBeGreaterThan(0);
    } finally {
      engine.close();
    }
  });
});

// ---------------------------------------------------------------------------
// renderHistory reads 'verificationHistory' field
// ---------------------------------------------------------------------------

describe('regression: renderHistory field name', () => {
  it('renders verification history when verificationHistory is present in data', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'getClaimHistory', args: { claimId: 'test' } },
      data: {
        claimId: 'test',
        verificationHistory: [
          {
            ranAt: '2026-01-01',
            priorStatus: 'hypothesis',
            newStatus: 'confirmed',
          },
        ],
        annotations: [],
        successorChain: [],
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev1',
    };

    const view = renderView('history', envelope);

    // Flatten all line text for assertion
    const allText = view.lines.map(l => l.text).join('\n');

    // The output should include verification history content
    expect(allText).toContain('Verification history: 1');
    expect(allText).toContain('hypothesis');
    expect(allText).toContain('confirmed');
    expect(allText).toContain('2026-01-01');

    // It should NOT contain the "No verification history" fallback
    expect(allText).not.toContain('No verification history');
  });

  it('renders "No verification history" when verificationHistory is absent', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'getClaimHistory', args: { claimId: 'test' } },
      data: {
        claimId: 'test',
        annotations: [],
        successorChain: [],
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev1',
    };

    const view = renderView('history', envelope);
    const allText = view.lines.map(l => l.text).join('\n');

    expect(allText).toContain('No verification history');
  });

  it('renders status transition line with correct format', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'getClaimHistory', args: { claimId: 'test' } },
      data: {
        claimId: 'test',
        verificationHistory: [
          {
            ranAt: '2026-01-01',
            priorStatus: 'hypothesis',
            newStatus: 'confirmed',
          },
        ],
        annotations: [],
        successorChain: [],
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev1',
    };

    const view = renderView('history', envelope);
    const allText = view.lines.map(l => l.text).join('\n');

    // renderHistory outputs: "  ${h['ranAt']}: ${h['priorStatus']} -> ${h['newStatus']}"
    expect(allText).toContain('2026-01-01: hypothesis -> confirmed');
  });

  it('formatted output has correct tags', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'getClaimHistory', args: { claimId: 'test' } },
      data: {
        claimId: 'test',
        verificationHistory: [
          {
            ranAt: '2026-01-01',
            priorStatus: 'hypothesis',
            newStatus: 'confirmed',
          },
        ],
        annotations: [],
        successorChain: [],
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev1',
    };

    const view = renderView('history', envelope);
    const formatted = formatView(view);

    // Should contain [trivial] tags since renderHistory uses trivialLine
    expect(formatted).toContain('[trivial]');
    expect(formatted).toContain('history :: getClaimHistory @ rev1');
  });

  it('status view shows WARNING when hasPartiality is true', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'status', args: {} },
      data: {
        modelRevision: 'rev-123',
        readinessState: 'ready',
        hasPartiality: true,
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev-123',
    };
    const view = renderView('status', envelope);
    const formatted = formatView(view);
    expect(formatted).toContain('WARNING: Model has partial extraction');
    expect(formatted).toContain('[hypothesis]');
  });

  it('status view does not show partiality warning when hasPartiality is false', () => {
    const envelope: ResultEnvelope<unknown> = {
      query: { op: 'status', args: {} },
      data: {
        modelRevision: 'rev-123',
        readinessState: 'ready',
        hasPartiality: false,
      },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev-123',
    };
    const view = renderView('status', envelope);
    const formatted = formatView(view);
    expect(formatted).not.toContain('WARNING: Model has partial extraction');
  });
});
