/**
 * Doctor report: local capability probe.
 *
 * Checks Node.js version, SQLite binding, grammar availability,
 * TS backend support, git availability, model status, effective
 * backend, degradation reason, and backend coverage metrics.
 *
 * Also provides secret-value redaction helpers.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  selectSymbolBackend,
  probeEmbedderStatus,
  getPatternCount,
  resolveWorkerPoolConfig,
  GRAMMAR_CHECKSUMS,
  verifyGrammarChecksum,
  grammarPackageForWasm,
} from '@system2-viewer/viewer-indexer';
import { getMigrationStatus } from '@system2-viewer/viewer-store';
import { loadConfig } from '@system2-viewer/viewer-config';
import type { DoctorReport, DoctorOpts, DoctorSuggestion, GrammarStatus } from './types.js';

/** Sentinel value replacing secret-shaped config values. */
export const REDACTED = '[REDACTED]' as const;

/**
 * Returns true when `value` looks like an API key, token, or password.
 *
 * Heuristic: length > 12 AND at least one of:
 *   - starts with a known secret prefix (sk-, ghp-, gho-, Bearer, etc.)
 *   - matches a hex-like pattern (>= 16 hex chars)
 *   - matches a base64-like pattern (>= 16 alphanumeric+/= chars)
 */
export function looksLikeSecretValue(value: string): boolean {
  if (value.length <= 12) return false;

  // Known secret prefixes
  if (
    value.startsWith('sk-') ||
    value.startsWith('ghp_') ||
    value.startsWith('gho_') ||
    value.startsWith('ghs_') ||
    value.startsWith('ghr_') ||
    value.startsWith('Bearer ') ||
    value.startsWith('token-') ||
    value.startsWith('key-') ||
    value.startsWith('api-') ||
    value.startsWith('xox') ||
    value.startsWith('AKIA')
  ) {
    return true;
  }

  // Key/token/password/secret in variable-name style followed by = or :
  if (/(?:key|token|password|secret|credential|auth)[=:]/i.test(value)) {
    return true;
  }

  // Hex-like: at least 24 consecutive hex characters
  if (/^[0-9a-fA-F]{24,}$/.test(value)) {
    return true;
  }

  // Base64-like: at least 20 chars of alphanumeric, +, /, ending with optional =
  if (/^[A-Za-z0-9+/]{20,}={0,3}$/.test(value)) {
    return true;
  }

  return false;
}

/**
 * Deep-scan a config object, replacing any string value that
 * looks like a secret with REDACTED.
 */
export function redactConfigValues(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === 'string') {
      result[key] = looksLikeSecretValue(val) ? REDACTED : val;
    } else if (Array.isArray(val)) {
      result[key] = val.map(item => {
        if (typeof item === 'string') {
          return looksLikeSecretValue(item) ? REDACTED : item;
        }
        if (typeof item === 'object' && item !== null) {
          return redactConfigValues(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactConfigValues(val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Checks whether better-sqlite3 can be loaded.
 */
function checkSqliteBinding(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects how the better-sqlite3 native binding was installed.
 *
 * - 'prebuilt' if prebuild-install marker files exist in the package directory
 * - 'compiled' if build/Release directory exists (compiled from source)
 * - 'unknown' otherwise
 */
function detectNativeBindingType(): 'prebuilt' | 'compiled' | 'unknown' {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('better-sqlite3/package.json');
    const pkgDir = join(pkgPath, '..');
    // prebuild-install leaves a prebuilds directory
    if (existsSync(join(pkgDir, 'prebuilds'))) return 'prebuilt';
    if (existsSync(join(pkgDir, 'build', 'Release'))) return 'compiled';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Checks whether TypeScript package is resolvable.
 */
function checkTsBackend(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('typescript');
    return true;
  } catch {
    return false;
  }
}

/**
 * Language-to-WASM-package mapping for all supported grammars.
 * Mirrors the GRAMMAR_REGISTRY in viewer-indexer without creating
 * a public-API dependency on that internal constant.
 */
const GRAMMAR_PACKAGES: ReadonlyArray<{ language: string; wasmPackage: string; wasmFileName: string }> = [
  { language: 'typescript', wasmPackage: 'tree-sitter-typescript', wasmFileName: 'tree-sitter-typescript.wasm' },
  { language: 'json',       wasmPackage: 'tree-sitter-json',       wasmFileName: 'tree-sitter-json.wasm' },
  { language: 'python',     wasmPackage: 'tree-sitter-python',     wasmFileName: 'tree-sitter-python.wasm' },
  { language: 'rust',       wasmPackage: 'tree-sitter-rust',       wasmFileName: 'tree-sitter-rust.wasm' },
  { language: 'go',         wasmPackage: 'tree-sitter-go',         wasmFileName: 'tree-sitter-go.wasm' },
  { language: 'java',       wasmPackage: 'tree-sitter-java',       wasmFileName: 'tree-sitter-java.wasm' },
];

/**
 * Probes each grammar package and returns a per-language status,
 * including checksum verification for installed grammars.
 */
function checkGrammarsDetailed(): Record<string, GrammarStatus> {
  const require = createRequire(import.meta.url);
  const result: Record<string, GrammarStatus> = {};

  for (const { language, wasmPackage, wasmFileName } of GRAMMAR_PACKAGES) {
    try {
      require.resolve(wasmPackage);
      const checksumResult = verifyGrammarChecksum(wasmFileName);
      result[language] = checksumResult.valid ? 'available' : 'checksum_mismatch';
    } catch {
      result[language] = 'not_installed';
    }
  }

  return result;
}

/**
 * Checks grammar availability by looking for resolvable packages.
 * Returns the legacy boolean map for backward compatibility.
 */
function checkGrammars(detailed: Record<string, GrammarStatus>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [lang, status] of Object.entries(detailed)) {
    result[lang] = status === 'available';
  }
  return result;
}

/**
 * Checks whether git is available in the PATH.
 */
function checkGitAvailable(): boolean {
  try {
    const result = spawnSync('git', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Builds a DoctorReport: local capability probe with no side effects.
 * Works even when no model has been indexed.
 */
export async function buildDoctorReport(opts: DoctorOpts): Promise<DoctorReport> {
  const dataDir = opts.dataDir ?? '.system2-viewer';
  const modelPath = join(dataDir, 'model.sqlite');
  const modelExists = existsSync(modelPath);

  const sqliteBinding = checkSqliteBinding();
  const nativeBinding = sqliteBinding ? detectNativeBindingType() : undefined;
  const grammarsDetailed = checkGrammarsDetailed();
  const grammarAvailability = checkGrammars(grammarsDetailed);
  const tsBackendAvailable = checkTsBackend();
  const gitAvailable = checkGitAvailable();

  // Effective backend
  let configuredBackend = 'treesitter';
  if (opts.repoRoot) {
    try {
      const cfg = loadConfig(opts.repoRoot);
      configuredBackend = cfg.indexing.symbolBackend;
    } catch {
      // Config load failure is non-fatal for doctor; fall back to default.
    }
  }
  const backendResult = selectSymbolBackend(configuredBackend);

  // Backend coverage metrics (only when model exists and SQLite is available)
  let backendCoverage: Record<string, unknown> = {};
  if (modelExists && sqliteBinding) {
    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const DatabaseMod = require('better-sqlite3') as { new(path: string, opts?: { readonly?: boolean }): { pragma(s: string): unknown; prepare(sql: string): { get(params?: Record<string, unknown>): unknown }; close(): void } };
      const db = new DatabaseMod(modelPath, { readonly: true });
      try {
        db.pragma('journal_mode = WAL');

        const totalEdges = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM edges WHERE valid_to_revision IS NULL`,
            )
            .get() as { cnt: number }
        ).cnt;

        const crossFileEdges = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM edges
               WHERE kind IN ('imports', 'references') AND valid_to_revision IS NULL`,
            )
            .get() as { cnt: number }
        ).cnt;

        const bindingResolvedEdges = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM edges
               WHERE provenance_method = 'lsp_binding' AND valid_to_revision IS NULL`,
            )
            .get() as { cnt: number }
        ).cnt;

        // Partiality coverage: count rows with failures or skips
        let partialityTotal = 0;
        let partialityFailed = 0;
        let partialitySkipped = 0;
        try {
          const pTotal = (
            db
              .prepare(
                `SELECT COUNT(*) as cnt FROM partiality`,
              )
              .get() as { cnt: number }
          ).cnt;
          const pFailed = (
            db
              .prepare(
                `SELECT COUNT(*) as cnt FROM partiality WHERE failed_json IS NOT NULL AND failed_json != '[]'`,
              )
              .get() as { cnt: number }
          ).cnt;
          const pSkipped = (
            db
              .prepare(
                `SELECT COUNT(*) as cnt FROM partiality WHERE skipped_json IS NOT NULL AND skipped_json != '[]'`,
              )
              .get() as { cnt: number }
          ).cnt;
          partialityTotal = pTotal;
          partialityFailed = pFailed;
          partialitySkipped = pSkipped;
        } catch {
          // partiality table may not exist yet
        }

        backendCoverage = {
          totalEdges,
          crossFileReferenceEdges: crossFileEdges,
          bindingResolvedSubset: bindingResolvedEdges,
          partialityEntries: partialityTotal,
          partialityFailed,
          partialitySkipped,
        };
      } finally {
        db.close();
      }
    } catch {
      backendCoverage = { error: 'Could not read model database' };
    }
  }

  // Active SQLite PRAGMA values (only when model exists and SQLite is available)
  let sqlitePragmas: DoctorReport['sqlitePragmas'] | undefined;
  if (modelExists && sqliteBinding) {
    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const DatabaseMod = require('better-sqlite3') as { new(path: string, opts?: { readonly?: boolean }): { pragma(s: string, opts?: { simple: boolean }): unknown; close(): void } };
      const db = new DatabaseMod(modelPath, { readonly: true });
      try {
        const pageSize = db.pragma('page_size', { simple: true }) as number;
        const cacheSize = db.pragma('cache_size', { simple: true }) as number;
        const mmapSize = db.pragma('mmap_size', { simple: true }) as number;
        const busyTimeout = db.pragma('busy_timeout', { simple: true }) as number;
        sqlitePragmas = { pageSize, cacheSize, mmapSize, busyTimeout };
      } finally {
        db.close();
      }
    } catch {
      // Non-fatal: pragma query failed
    }
  }

  // Worker pool config probe
  let workerPoolConfig: { configured: number; effective: number; available: number } | undefined;
  {
    const { availableParallelism } = await import('node:os');
    const available = availableParallelism();
    let configuredCount: number | undefined;
    if (opts.repoRoot) {
      try {
        const cfg = loadConfig(opts.repoRoot);
        configuredCount = (cfg.indexing as Record<string, unknown>)['workerCount'] as number | undefined;
      } catch {
        // Non-fatal
      }
    }
    const resolved = resolveWorkerPoolConfig({
      workerCount: configuredCount,
    });
    workerPoolConfig = {
      configured: configuredCount ?? resolved.workerCount,
      effective: resolved.workerCount,
      available,
    };
  }

  // Embedding model probe
  const embedderStatus = await probeEmbedderStatus();
  const embeddingModel: DoctorReport['embeddingModel'] = {
    status: embedderStatus.status,
    ...(embedderStatus.modelName !== undefined && { modelName: embedderStatus.modelName }),
    ...(embedderStatus.dimension !== undefined && { dimension: embedderStatus.dimension }),
  };

  // Build suggestions based on diagnostics
  const suggestions: DoctorSuggestion[] = buildSuggestions(
    sqliteBinding,
    grammarsDetailed,
    modelExists,
    embedderStatus.status,
  );

  // Legacy absolute-path detection (only when model exists and SQLite is available)
  let absolutePathsDetected: boolean | undefined;
  if (modelExists && sqliteBinding) {
    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const DatabaseMod = require('better-sqlite3') as { new(path: string, opts?: { readonly?: boolean }): { pragma(s: string): unknown; prepare(sql: string): { get(): unknown }; close(): void } };
      const db = new DatabaseMod(modelPath, { readonly: true });
      try {
        const row = db.prepare(
          `SELECT json_extract(metadata_json, '$.repoRoot') as val
           FROM nodes WHERE kind = 'repository' AND metadata_json IS NOT NULL
           LIMIT 1`,
        ).get() as { val: unknown } | undefined;
        if (row && row.val != null) {
          absolutePathsDetected = true;
          suggestions.push({
            issue: 'absolute_paths_detected',
            command: 'viewer index --full .',
            severity: 'warning',
          });
        }
      } finally {
        db.close();
      }
    } catch {
      // Non-fatal: query failed (table may not exist yet)
    }
  }

  // Schema migration status (only when model exists and SQLite is available)
  let schemaMigration: DoctorReport['schemaMigration'] | undefined;
  if (modelExists && sqliteBinding) {
    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const DatabaseMod = require('better-sqlite3') as { new(path: string, opts?: { readonly?: boolean }): { pragma(s: string): unknown; prepare(sql: string): { all(): unknown[]; get(): unknown }; close(): void } };
      const db = new DatabaseMod(modelPath, { readonly: true });
      try {
        const migStatus = getMigrationStatus(db as never);
        schemaMigration = {
          currentVersion: migStatus.current,
          latestVersion: migStatus.latest,
          pendingMigrations: migStatus.pending,
          appliedMigrations: migStatus.applied.map(a => ({
            version: a.version,
            name: a.name,
            appliedAt: a.applied_at,
          })),
        };
        if (migStatus.pending > 0) {
          suggestions.push({
            issue: 'schema_pending',
            command: 'viewer index .  # migrations applied automatically on next index',
            severity: 'warning',
          });
        }
      } finally {
        db.close();
      }
    } catch {
      // Non-fatal: migration status query failed
    }
  }

  const patternCount = getPatternCount();

  return {
    nodeVersion: process.version,
    sqliteBinding,
    ...(nativeBinding != null ? { nativeBinding } : {}),
    grammarAvailability,
    grammars: grammarsDetailed,
    tsBackendAvailable,
    gitAvailable,
    modelStatus: modelExists ? 'indexed' : 'empty',
    configuredBackend,
    effectiveBackend: backendResult.backend,
    degradationReason: backendResult.degraded ? (backendResult.reason ?? null) : null,
    backendCoverage,
    embeddingModel,
    ...(sqlitePragmas != null ? { sqlitePragmas } : {}),
    ...(absolutePathsDetected != null ? { absolutePathsDetected } : {}),
    secretPatternCount: patternCount,
    secretScrubbing: {
      coverage: modelExists ? 'full' as const : 'none' as const,
      patternCount,
    },
    ...(workerPoolConfig != null ? { workerPool: workerPoolConfig } : {}),
    suggestions,
    ...(schemaMigration != null ? { schemaMigration } : {}),
  };
}

/**
 * Build actionable suggestions based on diagnostic results.
 */
function buildSuggestions(
  sqliteBinding: boolean,
  grammars: Record<string, GrammarStatus>,
  modelExists: boolean,
  embedderStatus: string,
): DoctorSuggestion[] {
  const suggestions: DoctorSuggestion[] = [];

  if (!sqliteBinding) {
    suggestions.push({
      issue: 'sqlite_binding_missing',
      command: 'npm rebuild better-sqlite3',
      severity: 'error',
    });
  }

  for (const { language, wasmPackage, wasmFileName } of GRAMMAR_PACKAGES) {
    const status = grammars[language];
    if (status === 'not_installed') {
      suggestions.push({
        issue: 'grammar_not_installed',
        command: `npm install ${wasmPackage}`,
        severity: 'warning',
      });
    } else if (status === 'checksum_mismatch') {
      suggestions.push({
        issue: 'checksum_mismatch',
        command: `npm rebuild ${wasmPackage}`,
        severity: 'error',
      });
    }
  }

  if (!modelExists) {
    suggestions.push({
      issue: 'model_not_indexed',
      command: 'viewer index .',
      severity: 'warning',
    });
  }

  if (embedderStatus === 'not_installed') {
    suggestions.push({
      issue: 'onnx_not_installed',
      command: 'npm install onnxruntime-node',
      severity: 'info',
    });
  }

  return suggestions;
}
