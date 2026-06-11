import type Database from 'better-sqlite3';
import { migration001 } from './migrations/001-initial-schema.js';
import { migration002 } from './migrations/002-embeddings.js';
import { migration003 } from './migrations/003-file-hashes.js';
import { migration004 } from './migrations/004-file-hash-stat.js';
import { migration005 } from './migrations/005-query-indexes.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

export interface MigrationStatus {
  current: number;
  latest: number;
  pending: number;
  applied: Array<{ version: number; name: string; applied_at: string }>;
}

const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005];

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export function runMigrations(db: Database.Database, overrideMigrations?: readonly Migration[]): MigrationStatus {
  const migs = overrideMigrations ?? MIGRATIONS;
  db.exec(SCHEMA_MIGRATIONS_DDL);

  const userVersion = db.pragma('user_version', { simple: true }) as number;
  const existingRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const appliedVersions = new Set(existingRows.map(r => r.version));

  if (userVersion >= 1 && appliedVersions.size === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    for (const m of migs) {
      if (m.version <= userVersion) {
        insert.run(m.version, m.name, now);
        appliedVersions.add(m.version);
      }
    }
  }

  const pending = migs.filter(m => !appliedVersions.has(m.version));
  if (pending.length > 0) {
    const applyAll = db.transaction(() => {
      const now = new Date().toISOString();
      for (const m of pending) {
        m.up(db);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(m.version, m.name, now);
      }
      const latestVersion = migs[migs.length - 1].version;
      db.pragma(`user_version = ${latestVersion}`);
    });
    applyAll();
  }

  return getMigrationStatus(db, overrideMigrations);
}

export function getMigrationStatus(db: Database.Database, overrideMigrations?: readonly Migration[]): MigrationStatus {
  const migs = overrideMigrations ?? MIGRATIONS;
  let hasTable = false;
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    ).get() as { name: string } | undefined;
    hasTable = row !== undefined;
  } catch {
    hasTable = false;
  }

  if (!hasTable) {
    return {
      current: 0,
      latest: migs[migs.length - 1].version,
      pending: migs.length,
      applied: [],
    };
  }

  const applied = db.prepare(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
  ).all() as Array<{ version: number; name: string; applied_at: string }>;
  const appliedVersions = new Set(applied.map(r => r.version));
  const latest = migs[migs.length - 1].version;
  const current = applied.length > 0 ? Math.max(...applied.map(r => r.version)) : 0;
  const pendingCount = migs.filter(m => !appliedVersions.has(m.version)).length;

  return { current, latest, pending: pendingCount, applied };
}
