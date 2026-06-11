import type Database from 'better-sqlite3';
import type { Migration } from '../migration-runner.js';

const FILE_HASHES_DDL = `
CREATE TABLE IF NOT EXISTS file_hashes (
  path TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (path, repository_id)
);
`;

export const migration003: Migration = {
  version: 3,
  name: 'add-file-hashes-table',
  up(db: Database.Database): void {
    db.exec(FILE_HASHES_DDL);
  },
};
