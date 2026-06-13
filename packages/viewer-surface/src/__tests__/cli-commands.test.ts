/**
 * Tests for CLI command dispatch -- extended coverage for all 19 commands.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { COMMANDS, COMMAND_MAP } from '../cli-commands.js';
import { runCli } from '../cli.js';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

// ---------------------------------------------------------------------------
// Helpers
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
    compareRevisions: vi.fn(() => makeEnvelope('compareRevisions', { revA: 'a', revB: 'b', changedFiles: [], renames: [] })),
    createCustomClaim: vi.fn(() => makeEnvelope('createCustomClaim', { claimId: 'claim::custom::test' })),
    getImportGraph: vi.fn(() => makeEnvelope('getImportGraph', { adjacencyList: {}, nodes: [], metrics: { totalNodes: 0, totalEdges: 0, maxFanIn: 0, maxFanOut: 0, avgFanOut: 0 } })),
    doctor: vi.fn(() => makeEnvelope('doctor', { nodeVersion: 'v22.0.0', sqliteBinding: true })),
    status: vi.fn(() => makeEnvelope('status', { modelRevision: 'rev-1', readinessState: 'ready' })),
    initConfig: vi.fn(() => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false })),
    mcpConfig: vi.fn(() => ({ targetPath: '/tmp/.mcp.json', created: true })),
  } as unknown as CliOps;
}

// ---------------------------------------------------------------------------
// COMMANDS table
// ---------------------------------------------------------------------------

describe('COMMANDS table', () => {
  const EXPECTED_NAMES = [
    'doctor', 'status', 'init', 'mcp-config', 'index',
    'overview', 'entrypoints', 'trace', 'blast', 'subsystem',
    'resolve', 'claims', 'uncertainties', 'verify', 'history',
    'check-invariants', 'confirm', 'reject', 'annotate',
    'claim-create', 'import-graph', 'rule',
  ];

  it('has exactly 22 commands', () => {
    expect(COMMANDS).toHaveLength(22);
  });

  it('names match stable contract', () => {
    const names = COMMANDS.map(c => c.name).sort();
    const expected = [...EXPECTED_NAMES].sort();
    expect(names).toEqual(expected);
  });

  it('COMMAND_MAP has the same entries as COMMANDS array', () => {
    expect(COMMAND_MAP.size).toBe(COMMANDS.length);
    for (const cmd of COMMANDS) {
      expect(COMMAND_MAP.has(cmd.name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Pre-dispatch resolution
// ---------------------------------------------------------------------------

describe('pre-dispatch resolution', () => {
  it('trace, verify, confirm, reject, annotate, blast, subsystem have pre-dispatch', () => {
    const resolvable = ['trace', 'verify', 'confirm', 'reject', 'annotate', 'blast', 'subsystem'];
    for (const name of resolvable) {
      const cmd = COMMAND_MAP.get(name);
      expect(cmd?.preDispatch, `${name} should be resolvable`).not.toBeNull();
    }
  });

  it('entrypoints does NOT have pre-dispatch (accepts free-text intent)', () => {
    const ep = COMMAND_MAP.get('entrypoints');
    expect(ep!.preDispatch).toBeNull();
  });

  it('doctor, status, init, claims, uncertainties do NOT have pre-dispatch', () => {
    for (const name of ['doctor', 'status', 'init', 'claims', 'uncertainties']) {
      const cmd = COMMAND_MAP.get(name);
      expect(cmd?.preDispatch, `${name} should not be resolvable`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// CLI command dispatch -- extended commands
// ---------------------------------------------------------------------------

describe('runCli -- extended commands', () => {
  it('claims command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['claims'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.listClaims).toHaveBeenCalled();
  });

  it('uncertainties command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['uncertainties'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.listUncertainties).toHaveBeenCalled();
  });

  it('resolve command exits 0 with input', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['resolve', 'src/index.ts'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.resolveRef).toHaveBeenCalled();
  });

  it('resolve command exits 2 without input', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['resolve'], ops, (l) => output.push(l));
    expect(exitCode).toBe(2);
  });

  it('verify command exits 0 with claimId', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['verify', 'c1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.verifyClaim).toHaveBeenCalled();
  });

  it('verify command exits 2 without claimId', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['verify'], ops, (l) => output.push(l));
    expect(exitCode).toBe(2);
  });

  it('trace command exits 0 with start and target', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['trace', 'src/a.ts', 'src/b.ts'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.traceFlow).toHaveBeenCalled();
  });

  it('trace command exits 2 without required args', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['trace'], ops, (l) => output.push(l));
    expect(exitCode).toBe(2);
  });

  it('blast command exits 0 with ref', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['blast', 'src/index.ts'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.estimateBlastRadius).toHaveBeenCalled();
  });

  it('subsystem command exits 0 with ref', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['subsystem', 'sub-1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.explainSubsystem).toHaveBeenCalled();
  });

  it('confirm command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['confirm', 'c1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.feedback.confirmClaim).toHaveBeenCalled();
  });

  it('reject command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['reject', 'c1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.feedback.rejectClaim).toHaveBeenCalled();
  });

  it('annotate command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['annotate', 'c1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.feedback.annotateClaim).toHaveBeenCalled();
  });

  it('index command exits 0', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['index', '.'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.index).toHaveBeenCalled();
  });

  it('entrypoints command exits 0 with query', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['entrypoints', 'main entry point'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.findEntrypoints).toHaveBeenCalled();
  });

  it('mcp-config command exits 0 with --package', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['mcp-config', '--package', '/abs/path'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.mcpConfig).toHaveBeenCalled();
  });

  it('mcp-config command exits 2 without --package', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['mcp-config'], ops, (l) => output.push(l));
    expect(exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// History dual mode
// ---------------------------------------------------------------------------

describe('runCli -- history dual mode', () => {
  it('history <claimId> invokes getClaimHistory', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['history', 'c1'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.getClaimHistory).toHaveBeenCalled();
  });

  it('history --from rev1 --to rev2 invokes compareRevisions', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['history', '--from', 'rev1', '--to', 'rev2'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.compareRevisions).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Workspace mode validation
// ---------------------------------------------------------------------------

describe('runCli -- workspace mode validation', () => {
  it('exits 2 for invalid workspace mode', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['index', '.', '--workspace', 'invalid'], ops, (l) => output.push(l));
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('auto|force|off'))).toBe(true);
  });

  it('accepts valid workspace modes without error', async () => {
    const ops = createMockOps();
    for (const mode of ['auto', 'force', 'off']) {
      const output: string[] = [];
      const exitCode = await runCli(['index', '.', '--workspace', mode], ops, (l) => output.push(l));
      expect(exitCode).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// --skip-embed flag
// ---------------------------------------------------------------------------

describe('runCli -- --skip-embed flag', () => {
  it('index command passes skipEmbed: true when --skip-embed is provided', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['index', '.', '--skip-embed'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.index).toHaveBeenCalledWith(
      expect.objectContaining({ skipEmbed: true }),
    );
  });

  it('index command passes skipEmbed: false when --skip-embed is omitted', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['index', '.'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    expect(ops.index).toHaveBeenCalledWith(
      expect.objectContaining({ skipEmbed: false }),
    );
  });

  it('index command args builder includes skipEmbed in COMMAND_MAP', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    const args = indexCmd!.args(['.'], { 'skip-embed': 'true' });
    expect(args['skipEmbed']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workspace bound args -- --workspace-depth and --workspace-max-repos
// ---------------------------------------------------------------------------

describe('COMMAND_MAP index args builder -- workspace bound args', () => {
  it('parses --workspace-depth and --workspace-max-repos into numeric values', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    const args = indexCmd!.args(['.'], {
      'workspace-depth': '5',
      'workspace-max-repos': '20',
    });
    expect(args['workspaceDepth']).toBe(5);
    expect(args['workspaceMaxRepos']).toBe(20);
  });

  it('absent flags produce undefined (not 0 or NaN)', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    const args = indexCmd!.args(['.'], {});
    expect(args['workspaceDepth']).toBeUndefined();
    expect(args['workspaceMaxRepos']).toBeUndefined();
  });

  it('rejects non-integer values for --workspace-depth', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    expect(() => indexCmd!.args(['.'], { 'workspace-depth': 'abc' })).toThrow(
      /Invalid value for --workspace-depth/,
    );
  });

  it('rejects negative values for --workspace-max-repos', () => {
    const indexCmd = COMMAND_MAP.get('index');
    expect(indexCmd).toBeDefined();
    expect(() => indexCmd!.args(['.'], { 'workspace-max-repos': '-1' })).toThrow(
      /Invalid value for --workspace-max-repos/,
    );
  });
});

describe('runCli -- workspace bound args', () => {
  it('forwards --workspace-depth and --workspace-max-repos to ops.index', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--workspace-depth', '3', '--workspace-max-repos', '10'],
      ops,
      (l) => output.push(l),
    );
    expect(exitCode).toBe(0);
    expect(ops.index).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDepth: 3,
        workspaceMaxRepos: 10,
      }),
    );
  });

  it('absent workspace flags forward as undefined to ops.index', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(['index', '.'], ops, (l) => output.push(l));
    expect(exitCode).toBe(0);
    const call = (ops.index as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.workspaceDepth).toBeUndefined();
    expect(call.workspaceMaxRepos).toBeUndefined();
  });

  it('exits 2 for invalid --workspace-depth value', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--workspace-depth', 'notanumber'],
      ops,
      (l) => output.push(l),
    );
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('workspace-depth'))).toBe(true);
  });

  it('exits 2 for invalid --workspace-max-repos value', async () => {
    const ops = createMockOps();
    const output: string[] = [];
    const exitCode = await runCli(
      ['index', '.', '--workspace-max-repos', '-5'],
      ops,
      (l) => output.push(l),
    );
    expect(exitCode).toBe(2);
    expect(output.some(l => l.includes('workspace-max-repos'))).toBe(true);
  });
});
