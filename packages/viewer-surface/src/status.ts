/**
 * Status report: model revision, readiness state, data directory path.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { StatusReport } from './types.js';

/**
 * Builds a StatusReport from the current data directory state.
 *
 * Checks:
 *   - Whether the model database exists
 *   - Whether SQLite binding is available
 *   - Whether grammar packages are resolvable
 *   - The latest revision in the model (if any)
 */
export function buildStatusReport(dataDir: string): StatusReport {
  const modelPath = join(dataDir, 'model.sqlite');
  const modelExists = existsSync(modelPath);

  if (!modelExists) {
    return {
      modelRevision: '',
      readinessState: 'no-model',
      hasPartiality: false,
    };
  }

  // Check SQLite binding
  let sqliteOk = false;
  try {
    const require = createRequire(import.meta.url);
    require.resolve('better-sqlite3');
    sqliteOk = true;
  } catch {
    // not available
  }

  if (!sqliteOk) {
    return {
      modelRevision: '',
      readinessState: 'sqlite-unavailable',
      hasPartiality: false,
    };
  }

  // Read the latest revision and check partiality
  let modelRevision = '';
  let hasPartiality = false;
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DatabaseMod = require('better-sqlite3') as { new(path: string, opts?: { readonly?: boolean }): { pragma(s: string): unknown; prepare(sql: string): { get(params?: Record<string, unknown>): unknown }; close(): void } };
    const db = new DatabaseMod(modelPath, { readonly: true });
    try {
      db.pragma('journal_mode = WAL');
      const row = db
        .prepare('SELECT id FROM revisions ORDER BY rowid DESC LIMIT 1')
        .get() as { id: string } | undefined;
      modelRevision = row?.id ?? '';

      // Check if any partiality rows exist
      try {
        const partialityRow = db
          .prepare('SELECT COUNT(*) as cnt FROM partiality')
          .get() as { cnt: number } | undefined;
        hasPartiality = (partialityRow?.cnt ?? 0) > 0;
      } catch {
        // partiality table may not exist yet
      }
    } finally {
      db.close();
    }
  } catch {
    return {
      modelRevision: '',
      readinessState: 'model-corrupt',
      hasPartiality: false,
    };
  }

  if (modelRevision === '') {
    return {
      modelRevision: '',
      readinessState: 'empty-model',
      hasPartiality: false,
    };
  }

  // Check grammars
  let grammarsOk = false;
  try {
    const require = createRequire(import.meta.url);
    require.resolve('tree-sitter-typescript');
    require.resolve('tree-sitter-json');
    grammarsOk = true;
  } catch {
    // partial readiness
  }

  return {
    modelRevision,
    readinessState: grammarsOk ? 'ready' : 'ready-no-grammars',
    hasPartiality,
  };
}
