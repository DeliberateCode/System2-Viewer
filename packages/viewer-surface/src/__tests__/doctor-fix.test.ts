/**
 * Tests for doctor --fix auto-remediation.
 *
 */
import { describe, it, expect, vi } from 'vitest';
import { runDoctorFix } from '../doctor-fix.js';
import type { DoctorSuggestion, DoctorFixResult } from '../types.js';

// ---------------------------------------------------------------------------
// runDoctorFix -- no suggestions
// ---------------------------------------------------------------------------

describe('runDoctorFix with no suggestions', () => {
  it('returns 0 attempted when suggestions array is empty', async () => {
    const result = await runDoctorFix([], { yes: true });
    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runDoctorFix -- with --yes flag and mock command execution
// ---------------------------------------------------------------------------

describe('runDoctorFix with --yes flag', () => {
  it('attempts safe commands when --yes is set', async () => {
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'sqlite_binding_missing',
        command: 'npm rebuild better-sqlite3',
        severity: 'error',
      },
    ];

    const result = await runDoctorFix(suggestions, {
      yes: true,
      exec: vi.fn(async () => ({ exitCode: 0 })),
    });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('calls exec with the correct command', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'sqlite_binding_missing',
        command: 'npm rebuild better-sqlite3',
        severity: 'error',
      },
    ];

    await runDoctorFix(suggestions, { yes: true, exec });

    expect(exec).toHaveBeenCalledWith('npm rebuild better-sqlite3');
  });

  it('reports failed when exec returns non-zero exit code', async () => {
    const exec = vi.fn(async () => ({ exitCode: 1 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'sqlite_binding_missing',
        command: 'npm rebuild better-sqlite3',
        severity: 'error',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('handles multiple suggestions', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'sqlite_binding_missing',
        command: 'npm rebuild better-sqlite3',
        severity: 'error',
      },
      {
        issue: 'grammar_not_installed',
        command: 'npm install tree-sitter-python',
        severity: 'warning',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('skips unsafe commands not on the allowlist', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'model_not_indexed',
        command: 'viewer index .',
        severity: 'warning',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('skips onnxruntime-node install (never install new packages)', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'onnx_not_installed',
        command: 'npm install onnxruntime-node',
        severity: 'info',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runDoctorFix -- interactive mode (no --yes)
// ---------------------------------------------------------------------------

describe('runDoctorFix interactive mode (no --yes)', () => {
  it('does not execute commands without --yes flag', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const output: string[] = [];
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'sqlite_binding_missing',
        command: 'npm rebuild better-sqlite3',
        severity: 'error',
      },
    ];

    const result = await runDoctorFix(suggestions, {
      exec,
      out: (line: string) => output.push(line),
    });

    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(exec).not.toHaveBeenCalled();
    expect(output.some(l => l.includes('Would run:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runDoctorFix -- grammar rebuild allowlist
// ---------------------------------------------------------------------------

describe('runDoctorFix grammar commands', () => {
  it('allows npm rebuild for grammar packages (checksum mismatch)', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'checksum_mismatch',
        command: 'npm rebuild tree-sitter-rust',
        severity: 'error',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(exec).toHaveBeenCalledWith('npm rebuild tree-sitter-rust');
  });

  it('allows npm install for known grammar packages', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'grammar_not_installed',
        command: 'npm install tree-sitter-typescript',
        severity: 'warning',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('rejects npm install for unknown packages', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    const suggestions: DoctorSuggestion[] = [
      {
        issue: 'grammar_not_installed',
        command: 'npm install malicious-package',
        severity: 'warning',
      },
    ];

    const result = await runDoctorFix(suggestions, { yes: true, exec });

    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DoctorFixResult type shape
// ---------------------------------------------------------------------------

describe('DoctorFixResult shape', () => {
  it('has all required numeric fields', async () => {
    const result: DoctorFixResult = await runDoctorFix([]);
    expect(typeof result.attempted).toBe('number');
    expect(typeof result.succeeded).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(typeof result.skipped).toBe('number');
  });
});
