/**
 * Tests for claim-create CLI command and createCustomClaim operation.
 *
 * Verifies that custom claim types can be created via the CLI
 * and that the operation produces valid claims.
 */
import { describe, it, expect, vi } from 'vitest';
import { COMMAND_MAP } from '../cli-commands.js';
import { runCli } from '../cli.js';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

function makeEnvelope(op: string, data: unknown = {}): ResultEnvelope<unknown> {
  return {
    query: { op, args: {} },
    data,
    evidence: [],
    uncertainties: [],
    suggestedNextCalls: [],
    modelRevision: 'test-rev',
  };
}

function createMockOps(): CliOps {
  const resolveResult: ResolveResult = {
    status: 'resolved',
    id: 'node-123',
    kind: 'path',
    displayName: 'test/file.ts',
  };

  return {
    getRepositoryOverview: vi.fn(() => makeEnvelope('getRepositoryOverview')),
    findEntrypoints: vi.fn(() => makeEnvelope('findEntrypoints')),
    traceFlow: vi.fn(() => makeEnvelope('traceFlow')),
    explainSubsystem: vi.fn(() => makeEnvelope('explainSubsystem')),
    estimateBlastRadius: vi.fn(() => makeEnvelope('estimateBlastRadius')),
    listClaims: vi.fn(() => makeEnvelope('listClaims', [])),
    listUncertainties: vi.fn(() => makeEnvelope('listUncertainties', [])),
    checkInvariants: vi.fn(() => makeEnvelope('checkInvariants')),
    verifyClaim: vi.fn(() => makeEnvelope('verifyClaim')),
    buildClaimPayload: vi.fn(() => makeEnvelope('buildClaimPayload')),
    sampleEvidenceAgreement: vi.fn(() => makeEnvelope('sampleEvidenceAgreement')),
    feedback: {
      confirmClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: null })),
      rejectClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: null })),
      annotateClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: null })),
      confirmSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: null })),
      rejectSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: null })),
      annotateSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: null })),
    },
    index: vi.fn(async () => makeEnvelope('index')),
    resolveRef: vi.fn(() => makeEnvelope('resolveReference', resolveResult) as ResultEnvelope<ResolveResult>),
    getClaimHistory: vi.fn(() => makeEnvelope('getClaimHistory')),
    compareRevisions: vi.fn(() => makeEnvelope('compareRevisions', { revA: 'a', revB: 'b', changedFiles: [], renames: [] })),
    createCustomClaim: vi.fn(() => makeEnvelope('createCustomClaim', { claimId: 'claim::custom::test-123' })),
    doctor: vi.fn(async () => makeEnvelope('doctor')),
    status: vi.fn(() => makeEnvelope('status')),
    initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
    mcpConfig: vi.fn(() => ({ targetPath: '/tmp/.mcp.json', created: true })),
  } as unknown as CliOps;
}

describe('claim-create command', () => {
  it('is registered in the command map', () => {
    expect(COMMAND_MAP.has('claim-create')).toBe(true);
    expect(COMMAND_MAP.get('claim-create')!.opKey).toBe('createCustomClaim');
  });

  it('dispatches to createCustomClaim with correct args', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    const code = await runCli(
      ['claim-create', '--type', 'perf-budget', '--statement', 'API latency under 100ms', '--actor', 'test-user'],
      ops,
      (line) => lines.push(line),
    );

    expect(code).toBe(0);
    expect(ops.createCustomClaim).toHaveBeenCalledWith({
      claimType: 'perf-budget',
      statement: 'API latency under 100ms',
      scope: {},
      actor: 'test-user',
    });
  });

  it('parses --scope as JSON', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    const code = await runCli(
      ['claim-create', '--type', 'sla', '--statement', 'test', '--scope', '{"path":"src/api"}'],
      ops,
      (line) => lines.push(line),
    );

    expect(code).toBe(0);
    expect(ops.createCustomClaim).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { path: 'src/api' } }),
    );
  });

  it('returns exit code 2 when --type is missing', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    const code = await runCli(
      ['claim-create', '--statement', 'test'],
      ops,
      (line) => lines.push(line),
    );

    expect(code).toBe(2);
    expect(lines.some(l => l.includes('--type'))).toBe(true);
  });

  it('returns exit code 2 when --statement is missing', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    const code = await runCli(
      ['claim-create', '--type', 'test'],
      ops,
      (line) => lines.push(line),
    );

    expect(code).toBe(2);
    expect(lines.some(l => l.includes('--statement'))).toBe(true);
  });

  it('returns exit code 2 for invalid --scope JSON', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    const code = await runCli(
      ['claim-create', '--type', 'test', '--statement', 'test', '--scope', '{bad}'],
      ops,
      (line) => lines.push(line),
    );

    expect(code).toBe(2);
    expect(lines.some(l => l.includes('--scope'))).toBe(true);
  });

  it('defaults actor to cli-user when not provided', async () => {
    const ops = createMockOps();
    const lines: string[] = [];

    await runCli(
      ['claim-create', '--type', 'test', '--statement', 'test statement'],
      ops,
      (line) => lines.push(line),
    );

    expect(ops.createCustomClaim).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'cli-user' }),
    );
  });
});
