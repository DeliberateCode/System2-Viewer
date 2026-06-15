import type Database from 'better-sqlite3';
import type { Migration } from '../migration-runner.js';

export const migration006: Migration = {
  version: 6,
  name: 'expand-edges-epistemic-declared',
  up(db: Database.Database): void {
    // Idempotency: check if 'declared' is already in the edges CHECK constraint
    const tableInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='edges'",
    ).get() as { sql: string } | undefined;

    if (!tableInfo) {
      // edges table doesn't exist yet (fresh database handled by migration 001)
      return;
    }

    if (tableInfo.sql.includes("'declared'")) {
      // Already has 'declared' in the constraint; nothing to do
      return;
    }

    // SQLite does not support ALTER TABLE to modify CHECK constraints.
    // Recreate the table with the expanded constraint.
    // No triggers or views reference `edges` (verified in schema.ts + all migrations).
    // foreign_keys=OFF is required by SQLite's documented safe table-rebuild pattern so
    // that the DROP does not cascade through any FK references that may exist in the future.
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`
      CREATE TABLE edges_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL REFERENCES kind_registry(kind),
        epistemic TEXT NOT NULL CHECK(epistemic IN ('static','inferred','observed','declared')),
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        confidence_band TEXT NOT NULL CHECK(confidence_band IN ('none','low','medium','high')),
        provenance_method TEXT NOT NULL,
        extractor TEXT NOT NULL,
        evidence_ids_json TEXT,
        metadata_json TEXT,
        valid_from_revision TEXT NOT NULL,
        valid_to_revision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    db.exec(`INSERT INTO edges_new (id, kind, epistemic, from_node_id, to_node_id, repository_id, confidence_band, provenance_method, extractor, evidence_ids_json, metadata_json, valid_from_revision, valid_to_revision, created_at, updated_at) SELECT id, kind, epistemic, from_node_id, to_node_id, repository_id, confidence_band, provenance_method, extractor, evidence_ids_json, metadata_json, valid_from_revision, valid_to_revision, created_at, updated_at FROM edges`);
    db.exec(`DROP TABLE edges`);
    db.exec(`ALTER TABLE edges_new RENAME TO edges`);
    db.exec(`PRAGMA foreign_keys = ON`);

    // Recreate indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id, kind, valid_to_revision)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id, kind, valid_to_revision)`);

    // Seed new kind_registry entries
    db.exec(`
      INSERT OR IGNORE INTO kind_registry (kind, category, mvp_emitted) VALUES
        ('event-flow', 'edge', 0),
        ('boundary-violation', 'claim_type', 0)
    `);
  },
  // No `down`: dropping 'declared' from the CHECK constraint would silently discard
  // any event-flow/boundary-violation edges written after this migration ran.
  // Rollback must be handled by restoring from a database backup.
};
