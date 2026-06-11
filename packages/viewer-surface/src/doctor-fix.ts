/**
 * Doctor --fix auto-remediation.
 *
 * Executes safe, non-destructive fix actions for doctor suggestions.
 * Only commands on an explicit allowlist are executed; unknown commands
 * are skipped. Interactive mode (default) prints what would run;
 * --yes mode executes immediately.
 */

import { spawnSync } from 'node:child_process';
import type { DoctorSuggestion, DoctorFixResult } from './types.js';

/**
 * Allowlist of safe commands that doctor --fix may execute.
 *
 * Grammar packages that may be reinstalled (npm install) or rebuilt
 * (npm rebuild). These are existing dependencies, not new installs.
 */
const SAFE_GRAMMAR_PACKAGES = new Set([
  'tree-sitter-typescript',
  'tree-sitter-json',
  'tree-sitter-python',
  'tree-sitter-rust',
  'tree-sitter-go',
]);

/** Options for exec injection (testing) and output. */
export interface DoctorFixOpts {
  yes?: boolean;
  exec?: (command: string) => Promise<{ exitCode: number }>;
  out?: (line: string) => void;
}

/**
 * Returns true if the command is on the safe allowlist.
 *
 * Allowed patterns:
 *   - `npm rebuild better-sqlite3`
 *   - `npm rebuild <grammar-package>` (known grammar packages only)
 *   - `npm install <grammar-package>` (known grammar packages only, reinstall)
 */
function isSafeCommand(command: string): boolean {
  if (command === 'npm rebuild better-sqlite3') return true;

  const rebuildMatch = command.match(/^npm rebuild (.+)$/);
  if (rebuildMatch && SAFE_GRAMMAR_PACKAGES.has(rebuildMatch[1]!)) return true;

  const installMatch = command.match(/^npm install (.+)$/);
  if (installMatch && SAFE_GRAMMAR_PACKAGES.has(installMatch[1]!)) return true;

  return false;
}

/** Default exec implementation using spawnSync. */
function defaultExec(command: string): Promise<{ exitCode: number }> {
  const parts = command.split(' ');
  const result = spawnSync(parts[0]!, parts.slice(1), {
    encoding: 'utf-8',
    timeout: 60_000,
    stdio: 'pipe',
  });
  return Promise.resolve({ exitCode: result.status ?? 1 });
}

/**
 * Run doctor fix auto-remediation on a list of suggestions.
 *
 * For each suggestion with a command field:
 *   - If the command is not on the safe allowlist, skip it.
 *   - If --yes: execute immediately via exec.
 *   - If interactive (default): print "Would run: <command>" and skip.
 */
export async function runDoctorFix(
  suggestions: DoctorSuggestion[],
  opts?: DoctorFixOpts,
): Promise<DoctorFixResult> {
  const yes = opts?.yes ?? false;
  const exec = opts?.exec ?? defaultExec;
  const out = opts?.out ?? (() => {});

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const suggestion of suggestions) {
    if (!isSafeCommand(suggestion.command)) {
      skipped++;
      continue;
    }

    if (!yes) {
      out(`Would run: ${suggestion.command}`);
      skipped++;
      continue;
    }

    attempted++;
    try {
      const result = await exec(suggestion.command);
      if (result.exitCode === 0) {
        succeeded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { attempted, succeeded, failed, skipped };
}
