import type Database from 'better-sqlite3';
import type { Migration } from '../migration-runner.js';

export const migration005: Migration = {
  version: 5,
  name: 'add-query-indexes',
  up(db: Database.Database): void {
    // Composite indexes for common query patterns
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_repo_kind ON nodes(repository_id, kind, valid_to_revision)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_type_status ON claims(claim_type, status, valid_to_revision)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evidence_kind_repo ON evidence(kind, repository_id)`);

    // Rebuild FTS5 table with UNINDEXED on retrieval-only columns.
    // object_id and object_type are never searched via MATCH, only returned in results.
    // Marking them UNINDEXED reduces the FTS index size and speeds up writes.
    const ftsExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='fts_text'`,
    ).get() as { name: string } | undefined;

    if (ftsExists) {
      const hasData = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM fts_text`,
      ).get() as { cnt: number }).cnt > 0;

      if (hasData) {
        // Preserve existing data through the rebuild
        db.exec(`CREATE TABLE _fts_backup (object_id TEXT, object_type TEXT, text TEXT, path TEXT)`);
        db.exec(`INSERT INTO _fts_backup SELECT object_id, object_type, text, path FROM fts_text`);
        db.exec(`DROP TABLE fts_text`);
        db.exec(`CREATE VIRTUAL TABLE fts_text USING fts5(
          object_id UNINDEXED, object_type UNINDEXED, text, path,
          tokenize='unicode61'
        )`);
        db.exec(`INSERT INTO fts_text SELECT object_id, object_type, text, path FROM _fts_backup`);
        db.exec(`DROP TABLE _fts_backup`);
      } else {
        db.exec(`DROP TABLE fts_text`);
        db.exec(`CREATE VIRTUAL TABLE fts_text USING fts5(
          object_id UNINDEXED, object_type UNINDEXED, text, path,
          tokenize='unicode61'
        )`);
      }
    } else {
      // Table does not exist yet (e.g. legacy v1 database without FTS)
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_text USING fts5(
        object_id UNINDEXED, object_type UNINDEXED, text, path,
        tokenize='unicode61'
      )`);
    }
  },
};
