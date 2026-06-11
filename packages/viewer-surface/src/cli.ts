/**
 * CLI command dispatcher.
 *
 * runCli(argv, ops, out):
 *   1. Parse argv into { command, rest, flags } (positionals + --key value pairs)
 *   2. Extract global --data-dir before command dispatch
 *   3. Look up command in COMMANDS table; unknown/missing -> exit 2
 *   4. Build args via command's args(rest, flags) builder; invalid -> exit 2
 *   5. Pre-dispatch resolution for applicable commands
 *   6. Call operation
 *   7. Handle --verbose/--evidence flag
 *   8. renderView + formatView -> tagged output
 *   9. Return exit code (0 success, 1 runtime error, 2 usage error)
 */

import { COMMAND_MAP } from './cli-commands.js';
import type { CommandDef, PreDispatchConfig } from './cli-commands.js';
import { renderView, formatView } from './cli-views.js';
import type { CliOps, ViewKind, ResolveResult } from './types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import { StderrProgressReporter, JsonProgressReporter } from '@system2-viewer/viewer-indexer';
import {
  addRule,
  listRules,
  removeRule,
  testRule,
  enableRule,
  disableRule,
  exportRules,
  importRules,
} from './rule-authoring.js';
import { runDoctorFix } from './doctor-fix.js';

/** Parsed argv structure. */
interface ParsedArgv {
  command: string | undefined;
  rest: string[];
  flags: Record<string, string>;
  dataDir: string | undefined;
  verbose: boolean;
  json: boolean;
}

/**
 * Parses raw argv (excluding node and script path) into structured parts.
 * Global flags (--data-dir, --verbose, --evidence) are extracted first.
 */
function parseArgv(argv: string[]): ParsedArgv {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  let dataDir: string | undefined;
  let verbose = false;
  let json = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === '--data-dir') {
      i++;
      dataDir = argv[i];
      i++;
      continue;
    }

    if (arg === '--verbose' || arg === '--evidence') {
      verbose = true;
      i++;
      continue;
    }

    if (arg === '--json') {
      json = true;
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Boolean flags: --force, --deep, --include-symbol-facts, --public-api
      const booleanFlags = new Set([
        'force', 'deep', 'include-symbol-facts', 'public-api', 'skip-embed', 'full',
        'fix', 'yes', 'no-gitignore',
      ]);
      if (booleanFlags.has(key)) {
        flags[key] = 'true';
        i++;
      } else if (key === 'progress') {
        // --progress json
        i++;
        const val = argv[i] ?? '';
        if (val === 'json') json = true;
        flags[key] = val;
        i++;
      } else {
        // Key-value flag: --key value
        i++;
        flags[key] = argv[i] ?? '';
        i++;
      }
      continue;
    }

    positionals.push(arg);
    i++;
  }

  const command = positionals[0];
  const rest = positionals.slice(1);

  return { command, rest, flags, dataDir, verbose, json };
}

/**
 * Pre-dispatch reference resolution.
 *
 * For commands with preDispatch config, resolves the primary positional
 * argument (and optionally a secondary) via ops.resolveRef.
 *
 * Returns:
 *   - null if resolution succeeded (args updated in place)
 *   - a ResultEnvelope if resolution returned ambiguous/not_found
 *     (the caller should render this and return)
 */
function resolvePreDispatch(
  args: Record<string, unknown>,
  config: PreDispatchConfig,
  ops: CliOps,
): ResultEnvelope<unknown> | null {
  // Resolve primary
  const rawPrimary = args[config.argName];
  if (typeof rawPrimary === 'string') {
    const result = ops.resolveRef({ input: rawPrimary, hint: config.hint });
    const resolveData = result.data as ResolveResult;
    if (resolveData.status === 'resolved') {
      args[config.argName] = resolveData.id;
    } else {
      return result as ResultEnvelope<unknown>;
    }
  } else if (Array.isArray(rawPrimary)) {
    // Resolve each element of an array-valued arg (e.g. blast changeScope)
    const resolved: unknown[] = [];
    for (const item of rawPrimary) {
      if (typeof item === 'string') {
        const result = ops.resolveRef({ input: item, hint: config.hint });
        const resolveData = result.data as ResolveResult;
        if (resolveData.status === 'resolved') {
          resolved.push(resolveData.id);
        } else if (resolveData.status === 'ambiguous') {
          return result as ResultEnvelope<unknown>;
        } else {
          // not_found: keep raw value as fallback
          resolved.push(item);
        }
      } else {
        resolved.push(item);
      }
    }
    args[config.argName] = resolved;
  }

  // Resolve secondary if configured
  if (config.secondary) {
    const rawSecondary = args[config.secondary.argName];
    if (typeof rawSecondary === 'string') {
      const result = ops.resolveRef({ input: rawSecondary, hint: config.secondary.hint });
      const resolveData = result.data as ResolveResult;
      if (resolveData.status === 'resolved') {
        args[config.secondary.argName] = resolveData.id;
      } else {
        // Secondary resolution failure is non-blocking for trace
        // (targetOrIntent can be free text)
      }
    }
  }

  return null;
}

/**
 * Dispatches a feedback command (confirm/reject/annotate).
 * Routes to the appropriate feedback operation on ops.feedback.
 */
function dispatchFeedback(
  opKey: string,
  args: Record<string, unknown>,
  ops: CliOps,
): Record<string, unknown> {
  const fb = ops.feedback;
  switch (opKey) {
    case 'confirmClaim':
      return fb.confirmClaim({
        claimId: args['claimId'] as string,
        actor: args['actor'] as string,
        note: args['note'] as string | undefined,
      }) as unknown as Record<string, unknown>;
    case 'rejectClaim':
      return fb.rejectClaim({
        claimId: args['claimId'] as string,
        actor: args['actor'] as string,
        note: args['note'] as string | undefined,
      }) as unknown as Record<string, unknown>;
    case 'annotateClaim':
      return fb.annotateClaim({
        claimId: args['claimId'] as string,
        actor: args['actor'] as string,
        annotation: args['annotation'] as string,
      }) as unknown as Record<string, unknown>;
    default:
      throw new Error(`Unknown feedback operation: ${opKey}`);
  }
}

const RULE_SUBCOMMANDS = new Set([
  'add', 'list', 'remove', 'test', 'enable', 'disable', 'export', 'import',
]);

/**
 * Dispatches `viewer rule <subcommand>` to the matching rule-authoring function.
 *
 * Returns exit code: 0 on success, 1 on runtime error, 2 on usage error.
 */
function dispatchRule(
  rest: string[],
  flags: Record<string, string>,
  out: (line: string) => void,
  dataDir?: string,
): number {
  const sub = rest[0];
  if (!sub || !RULE_SUBCOMMANDS.has(sub)) {
    if (sub) {
      out(`Unknown rule subcommand: ${sub}`);
    }
    out('Usage: viewer rule <subcommand>');
    out('');
    out('Subcommands: add, list, remove, test, enable, disable, export, import');
    return 2;
  }

  const resolvedDataDir = dataDir ?? '.system2-viewer';
  const configPath = flags['config'] ?? 'viewer.config.json';

  try {
    let result: unknown;
    switch (sub) {
      case 'add':
        result = addRule({
          name: flags['name'] ?? '',
          type: flags['type'] ?? '',
          from: flags['from'] ?? '',
          to: flags['to'] ?? '',
          severity: flags['severity'] ?? '',
          configPath,
          dataDir: resolvedDataDir,
          actor: flags['actor'],
        });
        break;
      case 'list':
        result = listRules(configPath);
        break;
      case 'remove':
        result = removeRule({
          name: flags['name'] ?? '',
          configPath,
          dataDir: resolvedDataDir,
          actor: flags['actor'],
        });
        break;
      case 'test':
        result = testRule({
          name: flags['name'] ?? '',
          configPath,
          dataDir: resolvedDataDir,
        });
        break;
      case 'enable':
        result = enableRule({ name: flags['name'] ?? '', configPath, dataDir: resolvedDataDir, actor: flags['actor'] });
        break;
      case 'disable':
        result = disableRule({ name: flags['name'] ?? '', configPath, dataDir: resolvedDataDir, actor: flags['actor'] });
        break;
      case 'export':
        result = exportRules({ configPath, outputPath: flags['output'] ?? 'rules-export.json' });
        break;
      case 'import':
        result = importRules({ filePath: flags['filePath'] ?? '', configPath, dataDir: resolvedDataDir, actor: flags['actor'] });
        break;
    }
    out(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    out(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

const FEEDBACK_OPS = new Set(['confirmClaim', 'rejectClaim', 'annotateClaim']);
const NON_ENVELOPE_OPS = new Set(['initConfig', 'mcpConfig']);

/**
 * Main CLI entry point.
 *
 * @param argv - Raw argv (command + args, NOT including node/script paths)
 * @param ops  - CliOps interface providing all operations
 * @param out  - Output function (defaults to console.log)
 * @returns Exit code: 0 success, 1 runtime error, 2 usage error
 */
export async function runCli(
  argv: string[],
  ops: CliOps,
  out: (line: string) => void = console.log,
): Promise<number> {
  // 1. Parse argv
  const parsed = parseArgv(argv);

  // 2. Check for command
  if (!parsed.command) {
    out('Usage: viewer <command> [options]');
    out('');
    out('Commands: doctor, status, init, mcp-config, index, overview, entrypoints,');
    out('  trace, blast, subsystem, resolve, claims, uncertainties, verify,');
    out('  history, check-invariants, confirm, reject, annotate, claim-create, rule');
    return 2;
  }

  // 3. Look up command
  const cmdDef: CommandDef | undefined = COMMAND_MAP.get(parsed.command);
  if (!cmdDef) {
    out(`Unknown command: ${parsed.command}`);
    out('Run "viewer" with no arguments for a list of commands.');
    return 2;
  }

  // 4. Build args
  let args: Record<string, unknown>;
  try {
    args = cmdDef.args(parsed.rest, parsed.flags);
  } catch (err) {
    out(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  // 5. Handle history dual mode
  if (cmdDef.name === 'history') {
    const mode = args['_mode'] as string;
    delete args['_mode'];

    if (mode === 'compare') {
      try {
        const envelope = ops.compareRevisions({
          revA: args['revA'] as string,
          revB: args['revB'] as string,
        });
        const view = renderView('compare', envelope, parsed.verbose);
        out(formatView(view));
        return 0;
      } catch (err) {
        out(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }

    // history <claimId> mode: pre-dispatch resolve
    const claimId = args['claimId'] as string;
    if (typeof claimId === 'string') {
      const resolveResult = ops.resolveRef({ input: claimId, hint: 'claim' });
      const resolveData = resolveResult.data as ResolveResult;
      if (resolveData.status === 'resolved') {
        args['claimId'] = resolveData.id;
      } else if (resolveData.status !== 'not_found') {
        const view = renderView('resolve', resolveResult, parsed.verbose);
        out(formatView(view));
        return 0;
      }
    }

    try {
      const envelope = ops.getClaimHistory({ claimId: args['claimId'] as string });
      const view = renderView('history', envelope, parsed.verbose);
      out(formatView(view));
      return 0;
    } catch (err) {
      out(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // 6. Rule subcommand routing
  if (cmdDef.name === 'rule') {
    return dispatchRule(parsed.rest, parsed.flags, out, parsed.dataDir);
  }

  // 7. Pre-dispatch resolution for applicable commands
  if (cmdDef.preDispatch) {
    const resolveEnvelope = resolvePreDispatch(args, cmdDef.preDispatch, ops);
    if (resolveEnvelope) {
      const view = renderView('resolve', resolveEnvelope, parsed.verbose);
      out(formatView(view));
      return 0;
    }
  }

  // 7. Dispatch operation
  try {
    // Feedback operations
    if (FEEDBACK_OPS.has(cmdDef.opKey)) {
      const feedbackResult = dispatchFeedback(cmdDef.opKey, args, ops);
      // Wrap feedback result in a minimal envelope for rendering
      const fakeEnvelope: ResultEnvelope<unknown> = {
        query: { op: cmdDef.opKey, args },
        data: feedbackResult,
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'feedback',
      };
      const view = renderView(cmdDef.viewKind, fakeEnvelope, parsed.verbose);
      out(formatView(view));
      return 0;
    }

    // Non-envelope operations (init, mcp-config)
    if (NON_ENVELOPE_OPS.has(cmdDef.opKey)) {
      let result: unknown;
      if (cmdDef.opKey === 'initConfig') {
        result = ops.initConfig({
          force: args['force'] as boolean | undefined,
          noGitignore: args['noGitignore'] as boolean | undefined,
        });
      } else if (cmdDef.opKey === 'mcpConfig' && ops.mcpConfig) {
        result = ops.mcpConfig(args);
      } else if (cmdDef.opKey === 'mcpConfig') {
        out('mcp-config command is not available.');
        return 1;
      }
      const fakeEnvelope: ResultEnvelope<unknown> = {
        query: { op: cmdDef.opKey, args },
        data: result as Record<string, unknown>,
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'local',
      };
      const view = renderView(cmdDef.viewKind, fakeEnvelope, parsed.verbose);
      out(formatView(view));
      return 0;
    }

    // Index operation (async)
    if (cmdDef.opKey === 'index') {
      if (parsed.verbose && parsed.json) {
        args['progress'] = new JsonProgressReporter();
      } else if (parsed.verbose) {
        args['progress'] = new StderrProgressReporter();
      }
      const indexResult = await ops.index(args);
      const view = renderView(cmdDef.viewKind, indexResult, parsed.verbose);
      out(formatView(view));
      return 0;
    }

    // Resolve operation (special route)
    if (cmdDef.opKey === 'resolveRef') {
      const envelope = ops.resolveRef({
        input: args['input'] as string,
        hint: args['kind'] as import('./types.js').ReferenceKind | undefined,
      });
      const view = renderView(cmdDef.viewKind, envelope, parsed.verbose);
      out(formatView(view));
      return 0;
    }

    // Doctor (no-arg, with optional --fix)
    if (cmdDef.opKey === 'doctor') {
      const envelope = await ops.doctor();
      const view = renderView(cmdDef.viewKind, envelope, parsed.verbose);
      out(formatView(view));

      if (parsed.flags['fix'] !== undefined) {
        const report = envelope.data as import('./types.js').DoctorReport;
        const fixResult = await runDoctorFix(report.suggestions, {
          yes: parsed.flags['yes'] !== undefined,
          out,
        });
        out(`\nFix summary: ${fixResult.attempted} attempted, ${fixResult.succeeded} succeeded, ${fixResult.failed} failed, ${fixResult.skipped} skipped`);
      }

      return 0;
    }

    // Status (no-arg)
    if (cmdDef.opKey === 'status') {
      const envelope = ops.status();
      const view = renderView(cmdDef.viewKind, envelope, parsed.verbose);
      out(formatView(view));
      return 0;
    }

    // Standard envelope operations
    const opFn = (ops as unknown as Record<string, (a: Record<string, unknown>) => ResultEnvelope<unknown>>)[cmdDef.opKey];
    if (typeof opFn !== 'function') {
      out(`Operation not implemented: ${cmdDef.opKey}`);
      return 1;
    }
    const envelope = opFn.call(ops, args);
    const view = renderView(cmdDef.viewKind, envelope, parsed.verbose);
    out(formatView(view));
    return 0;

  } catch (err) {
    out(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
