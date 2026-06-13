/**
 * All 20 CLI command definitions (19 standard + 1 subcommand router).
 *
 * Each command specifies:
 *   - name: the command string users type
 *   - opKey: key on CliOps to call (or special dispatch)
 *   - preDispatch: whether to run reference resolution before dispatch,
 *     and if so, which argument and hint type
 *   - args: builder that converts (rest positionals, flags) into
 *     the operation's argument record. Throws on invalid input.
 *   - viewKind: view kind for rendering
 */

import type { ReferenceKind, ViewKind } from './types.js';

/** Pre-dispatch resolution configuration for a command. */
export interface PreDispatchConfig {
  argName: string;
  hint: ReferenceKind;
  /** If true, a secondary argument also gets resolved. */
  secondary?: { argName: string; hint: ReferenceKind };
}

/** A single CLI command definition. */
export interface CommandDef {
  name: string;
  opKey: string;
  preDispatch: PreDispatchConfig | null;
  args: (rest: string[], flags: Record<string, string>) => Record<string, unknown>;
  viewKind: ViewKind;
}

function requirePositional(rest: string[], index: number, label: string): string {
  const val = rest[index];
  if (val === undefined || val === '') {
    throw new Error(`Missing required argument: <${label}>`);
  }
  return val;
}

function parseOptionalInt(flags: Record<string, string>, key: string): number | undefined {
  const raw = flags[key];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`Invalid value for --${key}: expected non-negative integer, got "${raw}"`);
  }
  return n;
}

function validateWorkspaceMode(value: string | undefined): 'auto' | 'force' | 'off' | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'force' || value === 'off') return value;
  throw new Error(`Invalid value for --workspace: expected auto|force|off, got "${value}"`);
}

/** All 22 CLI commands. */
export const COMMANDS: CommandDef[] = [
  // --- Diagnostic / setup ---
  {
    name: 'doctor',
    opKey: 'doctor',
    preDispatch: null,
    args: () => ({}),
    viewKind: 'doctor',
  },
  {
    name: 'status',
    opKey: 'status',
    preDispatch: null,
    args: () => ({}),
    viewKind: 'status',
  },
  {
    name: 'init',
    opKey: 'initConfig',
    preDispatch: null,
    args: (_rest, flags) => ({
      force: flags['force'] !== undefined,
      noGitignore: flags['no-gitignore'] !== undefined,
    }),
    viewKind: 'init',
  },
  {
    name: 'mcp-config',
    opKey: 'mcpConfig',
    preDispatch: null,
    args: (_rest, flags) => {
      const pkg = flags['package'];
      if (!pkg) throw new Error('Missing required flag: --package <abs>');
      return {
        package: pkg,
        target: flags['target'],
        name: flags['name'],
        force: flags['force'] !== undefined,
      };
    },
    viewKind: 'mcp-config',
  },

  // --- Indexing ---
  {
    name: 'index',
    opKey: 'index',
    preDispatch: null,
    args: (rest, flags) => ({
      repoRoot: rest[0] || '.',
      depth: parseOptionalInt(flags, 'depth'),
      full: flags['full'] !== undefined,
      verbose: flags['verbose'] !== undefined,
      workspace: validateWorkspaceMode(flags['workspace']),
      skipEmbed: flags['skip-embed'] !== undefined,
      workspaceDepth: parseOptionalInt(flags, 'workspace-depth'),
      workspaceMaxRepos: parseOptionalInt(flags, 'workspace-max-repos'),
    }),
    viewKind: 'index',
  },

  // --- Read operations ---
  {
    name: 'overview',
    opKey: 'getRepositoryOverview',
    preDispatch: null,
    args: (rest, flags) => ({
      repo: rest[0],
      revision: flags['revision'],
    }),
    viewKind: 'overview',
  },
  {
    name: 'entrypoints',
    opKey: 'findEntrypoints',
    preDispatch: null,
    args: (rest, flags) => ({
      query: requirePositional(rest, 0, 'query'),
      limit: parseOptionalInt(flags, 'limit'),
    }),
    viewKind: 'entrypoints',
  },
  {
    name: 'trace',
    opKey: 'traceFlow',
    preDispatch: {
      argName: 'start',
      hint: 'path',
      secondary: { argName: 'targetOrIntent', hint: 'path' },
    },
    args: (rest, flags) => ({
      start: requirePositional(rest, 0, 'start'),
      targetOrIntent: requirePositional(rest, 1, 'target'),
      maxDepth: parseOptionalInt(flags, 'max-depth'),
      prefer: flags['prefer'] as 'tests' | 'docs' | undefined,
      edgeKinds: flags['edge-kinds'] ? flags['edge-kinds'].split(',').map(s => s.trim()) : undefined,
    }),
    viewKind: 'trace',
  },
  {
    name: 'blast',
    opKey: 'estimateBlastRadius',
    preDispatch: { argName: 'changeScope', hint: 'path' },
    args: (rest, flags) => ({
      changeScope: [requirePositional(rest, 0, 'ref')],
      maxDepth: parseOptionalInt(flags, 'max-depth'),
    }),
    viewKind: 'blast',
  },
  {
    name: 'subsystem',
    opKey: 'explainSubsystem',
    preDispatch: { argName: 'subsystemId', hint: 'subsystem' },
    args: (rest) => ({
      subsystemId: requirePositional(rest, 0, 'ref'),
    }),
    viewKind: 'subsystem',
  },
  {
    name: 'resolve',
    opKey: 'resolveRef',
    preDispatch: null,
    args: (rest, flags) => ({
      input: requirePositional(rest, 0, 'input'),
      kind: flags['kind'] as ReferenceKind | undefined,
    }),
    viewKind: 'resolve',
  },
  {
    name: 'claims',
    opKey: 'listClaims',
    preDispatch: null,
    args: (_rest, flags) => ({
      claimType: flags['type'],
      status: flags['status'],
      includeLowValue: flags['include-symbol-facts'] !== undefined,
      publicApiOnly: flags['public-api'] !== undefined,
    }),
    viewKind: 'claims',
  },
  {
    name: 'uncertainties',
    opKey: 'listUncertainties',
    preDispatch: null,
    args: (_rest, flags) => ({
      minSeverity: flags['min-severity'],
      includeDiagnostic: flags['deep'] !== undefined,
      scope: flags['scope'] ? { path: flags['scope'] } : undefined,
    }),
    viewKind: 'uncertainties',
  },
  {
    name: 'verify',
    opKey: 'verifyClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
    args: (rest, flags) => ({
      claimId: requirePositional(rest, 0, 'claimId'),
      strategy: flags['strategy'] as 'all' | 'cheapest' | undefined,
    }),
    viewKind: 'verify',
  },
  {
    name: 'history',
    opKey: 'getClaimHistory',
    preDispatch: null, // handled specially in cli.ts for dual-mode
    args: (rest, flags) => {
      // Dual mode: history <claimId> vs history --from R --to R
      if (flags['from'] && flags['to']) {
        return {
          _mode: 'compare',
          revA: flags['from'],
          revB: flags['to'],
        };
      }
      return {
        _mode: 'history',
        claimId: requirePositional(rest, 0, 'claimId'),
      };
    },
    viewKind: 'history',
  },
  {
    name: 'check-invariants',
    opKey: 'checkInvariants',
    preDispatch: null,
    args: () => ({}),
    viewKind: 'invariants',
  },

  // --- Feedback ---
  {
    name: 'confirm',
    opKey: 'confirmClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
    args: (rest, flags) => ({
      claimId: requirePositional(rest, 0, 'claimId'),
      actor: flags['actor'] ?? 'cli-user',
      note: flags['note'],
    }),
    viewKind: 'feedback',
  },
  {
    name: 'reject',
    opKey: 'rejectClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
    args: (rest, flags) => ({
      claimId: requirePositional(rest, 0, 'claimId'),
      actor: flags['actor'] ?? 'cli-user',
      note: flags['note'],
    }),
    viewKind: 'feedback',
  },
  {
    name: 'annotate',
    opKey: 'annotateClaim',
    preDispatch: { argName: 'claimId', hint: 'claim' },
    args: (rest, flags) => ({
      claimId: requirePositional(rest, 0, 'claimId'),
      actor: flags['actor'] ?? 'cli-user',
      annotation: flags['annotation'] ?? '',
    }),
    viewKind: 'feedback',
  },

  // --- Custom claim creation ---
  {
    name: 'claim-create',
    opKey: 'createCustomClaim',
    preDispatch: null,
    args: (_rest, flags) => {
      const claimType = flags['type'];
      if (!claimType) throw new Error('Missing required flag: --type <claimType>');
      const statement = flags['statement'];
      if (!statement) throw new Error('Missing required flag: --statement "..."');
      let scope: Record<string, unknown> = {};
      if (flags['scope']) {
        try {
          scope = JSON.parse(flags['scope']) as Record<string, unknown>;
        } catch {
          throw new Error('Invalid --scope: must be valid JSON');
        }
      }
      return {
        claimType,
        statement,
        scope,
        actor: flags['actor'] ?? 'cli-user',
      };
    },
    viewKind: 'generic',
  },

  // --- Import graph ---
  {
    name: 'import-graph',
    opKey: 'getImportGraph',
    preDispatch: null,
    args: (rest, flags) => ({
      scope: rest[0] ?? '*',
      detectCycles: flags['detect-cycles'] !== undefined,
      transitiveDeps: flags['transitive-deps'] !== undefined,
      maxCycles: parseOptionalInt(flags, 'max-cycles') ?? 100,
    }),
    viewKind: 'generic',
  },

  // --- Rule authoring ---
  {
    name: 'rule',
    opKey: 'rule',
    preDispatch: null,
    args: (rest) => ({ subcommand: rest[0], subRest: rest.slice(1) }),
    viewKind: 'generic',
  },
];

/** Lookup table by command name for O(1) access. */
export const COMMAND_MAP: ReadonlyMap<string, CommandDef> = new Map(
  COMMANDS.map(cmd => [cmd.name, cmd]),
);
