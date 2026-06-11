/**
 * Tests for CLI command dispatch.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../cli.js';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

// ---------------------------------------------------------------------------
// Helpers: mock ops object
// ---------------------------------------------------------------------------

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
    getRepositoryOverview: vi.fn(() => makeEnvelope('getRepositoryOverview', { mainLanguages: ['TypeScript'] })),
    findEntrypoints: vi.fn(() => makeEnvelope('findEntrypoints', { candidates: [] })),
    traceFlow: vi.fn(() => makeEnvelope('traceFlow', { segments: [] })),
    explainSubsystem: vi.fn(() => makeEnvelope('explainSubsystem', { subsystemId: 'sub-1' })),
    estimateBlastRadius: vi.fn(() => makeEnvelope('estimateBlastRadius', { affectedNodes: [] })),
    listClaims: vi.fn(() => makeEnvelope('listClaims', [])),
    listUncertainties: vi.fn(() => makeEnvelope('listUncertainties', [])),
    checkInvariants: vi.fn(() => makeEnvelope('checkInvariants', { violations: [] })),
    verifyClaim: vi.fn(() => makeEnvelope('verifyClaim', { claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed' })),
    buildClaimPayload: vi.fn(() => makeEnvelope('buildClaimPayload', {})),
    sampleEvidenceAgreement: vi.fn(() => makeEnvelope('sampleEvidenceAgreement', {})),
    feedback: {
      confirmClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 'c1-fb' })),
      rejectClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 'c1-fb' })),
      annotateClaim: vi.fn(() => ({ claimId: 'c1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 'c1-fb' })),
      confirmSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'confirmed', evidenceAppended: true, successorId: 's1-fb' })),
      rejectSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'rejected', evidenceAppended: true, successorId: 's1-fb' })),
      annotateSubsystem: vi.fn(() => ({ claimId: 's1', priorStatus: 'hypothesis', newStatus: 'hypothesis', evidenceAppended: true, successorId: 's1-fb' })),
    },
    index: vi.fn(async () => makeEnvelope('index', { revision: 'rev-1', sourceModified: false })),
    resolveRef: vi.fn(() => makeEnvelope('resolveReference', resolveResult) as ResultEnvelope<ResolveResult>),
    getClaimHistory: vi.fn(() => makeEnvelope('getClaimHistory', { claimId: 'c1', verificationHistory: [], annotations: [], successorChain: [] })),
    compareRevisions: vi.fn(() => makeEnvelope('compareRevisions', { revA: 'a', revB: 'b', changedFiles: [], changedSymbols: [], changedEdges: [], changedClaims: [] })),
    doctor: vi.fn(() => makeEnvelope('doctor', {
      nodeVersion: 'v22.0.0',
      sqliteBinding: true,
      grammarAvailability: { typescript: true, json: true },
      tsBackendAvailable: true,
      gitAvailable: true,
      modelStatus: 'indexed',
      effectiveBackend: 'treesitter',
      degradationReason: null,
      backendCoverage: {},
    })),
    status: vi.fn(() => makeEnvelope('status', { modelRevision: 'rev-1', readinessState: 'ready' })),
    initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
    mcpConfig: vi.fn(() => ({ targetPath: '/tmp/.mcp.json', created: true })),
  } as unknown as CliOps;
}

// ---------------------------------------------------------------------------
// CLI dispatch tests
// ---------------------------------------------------------------------------

describe('runCli', () => {
  it('exits 2 for unknown command', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['unknown-cmd'], ops, (line) => output.push(line));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('Unknown command'))).toBe(true);
  });

  it('exits 2 for missing command (empty argv)', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli([], ops, (line) => output.push(line));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('Usage'))).toBe(true);
  });

  it('--data-dir is parsed before dispatch', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    // Pass --data-dir before the command; the command still dispatches
    const exitCode = await runCli(['--data-dir', '/tmp/test', 'doctor'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    // doctor was called
    expect(ops.doctor).toHaveBeenCalled();
  });

  it('doctor command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['doctor'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.doctor).toHaveBeenCalled();
  });

  it('status command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['status'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.status).toHaveBeenCalled();
  });

  it('init command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['init'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.initConfig).toHaveBeenCalled();
  });

  it('init --force passes force flag', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['init', '--force'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.initConfig).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it('overview command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['overview'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.getRepositoryOverview).toHaveBeenCalled();
  });

  it('output contains tagged lines', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    await runCli(['doctor'], ops, (line) => output.push(line));
    // formatView produces output with tags
    const joined = output.join('\n');
    // Output should have at least one tag: [trivial], [hypothesis], etc.
    expect(
      joined.includes('[trivial]') ||
      joined.includes('[hypothesis]') ||
      joined.includes('[evidence:') ||
      joined.includes('[claim:'),
    ).toBe(true);
  });

  it('exits 2 for entrypoints command missing query arg', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['entrypoints'], ops, (line) => output.push(line));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('Missing required'))).toBe(true);
  });

  it('check-invariants command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['check-invariants'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(ops.checkInvariants).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Rule subcommand routing
  // -------------------------------------------------------------------------

  it('rule with no subcommand exits 2 and shows usage', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule'], ops, (line) => output.push(line));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('rule'))).toBe(true);
  });

  it('rule with unknown subcommand exits 2', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'unknown-sub'], ops, (line) => output.push(line));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('Unknown'))).toBe(true);
  });

  it('rule add routes to addRule stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['rule', 'add', '--name', 'no-cycle', '--type', 'dependency', '--from', 'a', '--to', 'b', '--severity', 'error'],
      ops,
      (line) => output.push(line),
    );
    expect(exitCode).toBe(0);
  });

  it('rule list routes to listRules stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'list'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule remove routes to removeRule stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'remove', '--name', 'no-cycle'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule test routes to testRule stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'test', '--name', 'no-cycle'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule enable routes to enableRule stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'enable', '--name', 'no-cycle'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule disable routes to disableRule stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'disable', '--name', 'no-cycle'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule export routes to exportRules stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'export'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  it('rule import routes to importRules stub', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['rule', 'import', '--filePath', '/tmp/rules.json'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Blast command: array arg pre-dispatch resolution (Finding 3 fix)
  // -------------------------------------------------------------------------

  it('blast resolves file path to node ID via resolveRef before calling operation', async () => {
    const ops = createMockOps();
    // resolveRef returns a resolved node ID
    (ops.resolveRef as ReturnType<typeof vi.fn>).mockReturnValue(
      makeEnvelope('resolveReference', {
        status: 'resolved',
        id: 'node-resolved-123',
        kind: 'path',
        displayName: 'src/index.ts',
      }),
    );

    const output: string[] = [];
    const exitCode = await runCli(['blast', 'src/index.ts'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);

    // resolveRef should have been called with the file path
    expect(ops.resolveRef).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'src/index.ts', hint: 'path' }),
    );

    // estimateBlastRadius should have been called with the resolved node ID
    expect(ops.estimateBlastRadius).toHaveBeenCalledWith(
      expect.objectContaining({ changeScope: ['node-resolved-123'] }),
    );
  });

  it('blast passes through raw value when resolveRef returns not_found', async () => {
    const ops = createMockOps();
    (ops.resolveRef as ReturnType<typeof vi.fn>).mockReturnValue(
      makeEnvelope('resolveReference', {
        status: 'not_found',
        input: 'nonexistent.ts',
      }),
    );

    const output: string[] = [];
    const exitCode = await runCli(['blast', 'nonexistent.ts'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);

    // Should fall back to using raw value
    expect(ops.estimateBlastRadius).toHaveBeenCalledWith(
      expect.objectContaining({ changeScope: ['nonexistent.ts'] }),
    );
  });

  // -------------------------------------------------------------------------
  // JSON progress mode
  // -------------------------------------------------------------------------

  it('index with --verbose --json passes JsonProgressReporter', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--verbose', '--json'],
      ops,
      (line) => output.push(line),
    );
    expect(exitCode).toBe(0);
    // Verify the progress arg was set to JsonProgressReporter
    const indexCall = (ops.index as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(indexCall['progress']).toBeDefined();
    expect(indexCall['progress']!.constructor.name).toBe('JsonProgressReporter');
  });

  it('index with --progress json passes JsonProgressReporter', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--verbose', '--progress', 'json'],
      ops,
      (line) => output.push(line),
    );
    expect(exitCode).toBe(0);
    const indexCall = (ops.index as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(indexCall['progress']!.constructor.name).toBe('JsonProgressReporter');
  });

  it('index with --verbose but without --json passes StderrProgressReporter', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--verbose'],
      ops,
      (line) => output.push(line),
    );
    expect(exitCode).toBe(0);
    const indexCall = (ops.index as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(indexCall['progress']!.constructor.name).toBe('StderrProgressReporter');
  });

  // -------------------------------------------------------------------------
  // Doctor --fix integration
  // -------------------------------------------------------------------------

  it('doctor without --fix does not attempt remediation', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['doctor'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(output.join('\n')).not.toContain('Fix summary');
  });

  it('doctor --fix prints fix summary', async () => {
    const ops = createMockOps();
    // Return suggestions in the doctor envelope
    (ops.doctor as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope('doctor', {
        nodeVersion: 'v22.0.0',
        sqliteBinding: true,
        grammarAvailability: {},
        tsBackendAvailable: true,
        gitAvailable: true,
        modelStatus: 'indexed',
        effectiveBackend: 'treesitter',
        degradationReason: null,
        backendCoverage: {},
        suggestions: [],
      }),
    );

    const output: string[] = [];
    const exitCode = await runCli(['doctor', '--fix'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    expect(output.some(l => l.includes('Fix summary'))).toBe(true);
  });

  it('doctor --fix --yes with unsafe command skips it', async () => {
    const ops = createMockOps();
    (ops.doctor as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope('doctor', {
        nodeVersion: 'v22.0.0',
        sqliteBinding: true,
        grammarAvailability: {},
        tsBackendAvailable: true,
        gitAvailable: true,
        modelStatus: 'empty',
        effectiveBackend: 'treesitter',
        degradationReason: null,
        backendCoverage: {},
        suggestions: [
          { issue: 'model_not_indexed', command: 'viewer index .', severity: 'warning' },
        ],
      }),
    );

    const output: string[] = [];
    const exitCode = await runCli(['doctor', '--fix', '--yes'], ops, (line) => output.push(line));
    expect(exitCode).toBe(0);
    const summaryLine = output.find(l => l.includes('Fix summary'));
    expect(summaryLine).toBeDefined();
    // viewer index . is not on the safe allowlist, so it gets skipped
    expect(summaryLine).toContain('0 attempted');
    expect(summaryLine).toContain('1 skipped');
  });
});
