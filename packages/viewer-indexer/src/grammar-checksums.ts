/**
 * Grammar WASM checksum manifest.
 *
 * Maps grammar WASM filenames to expected SHA-256 hex digests.
 * Populated from installed packages; verified by `buildDoctorReport`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Expected SHA-256 checksums for each grammar WASM file.
 * Updated when grammar packages are bumped.
 */
export const GRAMMAR_CHECKSUMS: Record<string, string> = {
  'tree-sitter-typescript.wasm':
    '778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d',
  'tree-sitter-json.wasm':
    'd2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405',
  'tree-sitter-python.wasm': '',
  'tree-sitter-rust.wasm': '',
  'tree-sitter-go.wasm': '',
};

/** Map WASM filenames back to their npm package. */
const WASM_TO_PACKAGE: Record<string, string> = {
  'tree-sitter-typescript.wasm': 'tree-sitter-typescript',
  'tree-sitter-json.wasm': 'tree-sitter-json',
  'tree-sitter-python.wasm': 'tree-sitter-python',
  'tree-sitter-rust.wasm': 'tree-sitter-rust',
  'tree-sitter-go.wasm': 'tree-sitter-go',
};

export interface GrammarChecksumResult {
  valid: boolean;
  expected?: string;
  actual?: string;
}

/**
 * Resolve the filesystem path to a grammar's WASM file.
 * Returns undefined if the package is not installed.
 */
function resolveWasmPath(wasmFileName: string): string | undefined {
  const pkgName = WASM_TO_PACKAGE[wasmFileName];
  if (!pkgName) return undefined;
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    return join(dirname(pkgJsonPath), wasmFileName);
  } catch {
    return undefined;
  }
}

/**
 * Verify a grammar WASM file's SHA-256 checksum against the manifest.
 *
 * Returns `{ valid: true }` when the checksum matches or when there is
 * no expected checksum recorded (empty string). Returns `{ valid: false,
 * expected, actual }` on mismatch.
 */
export function verifyGrammarChecksum(wasmFileName: string): GrammarChecksumResult {
  const expected = GRAMMAR_CHECKSUMS[wasmFileName];
  if (expected === undefined) {
    return { valid: true };
  }

  const wasmPath = resolveWasmPath(wasmFileName);
  if (!wasmPath) {
    return { valid: true };
  }

  let actual: string;
  try {
    const buf = readFileSync(wasmPath);
    actual = createHash('sha256').update(buf).digest('hex');
  } catch {
    return { valid: true };
  }

  if (expected === '' || actual === expected) {
    return { valid: true };
  }

  return { valid: false, expected, actual };
}

/**
 * Returns the npm package name for a given WASM filename.
 */
export function grammarPackageForWasm(wasmFileName: string): string | undefined {
  return WASM_TO_PACKAGE[wasmFileName];
}
